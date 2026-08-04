import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  applyMigrations,
  insertInstanceMetadata,
  MemoryArtifactStore,
  openMemorySqlite,
  getSiteBySlug,
  listTokensForSite,
} from '@nrdocs/persistence';
import type { InstanceDescriptor, InstanceId } from '@nrdocs/contracts';
import { ExitCode, createProcessRuntime, main, type Runtime } from './index.js';
import { writeActiveInstanceId, writeInstanceDescriptor } from './instance-store.js';
import { createRejectingTerminal, type Terminal } from './terminal.js';
import { parseTtlDuration, MAX_TTL_SECONDS } from './admin/ttl.js';
import {
  assertReaderPassword,
  generatePublishingToken,
  derivePasswordVerifier,
} from './admin/crypto.js';
import { sitePrefix } from '@nrdocs/persistence';

const INST = 'inst_01ARZ3NDEKTSV4RRFFQ69G5FAV' as InstanceId;
const PASSWORD = 'correct horse battery staple';

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    reset() {
      stdout = '';
      stderr = '';
    },
    io: {
      writeStdout: (t: string) => {
        stdout += t;
      },
      writeStderr: (t: string) => {
        stderr += t;
      },
    },
  };
}

function scriptedTerminal(script: {
  lines?: string[];
  masked?: string[];
  confirm?: boolean[];
  phrases?: boolean[];
}): Terminal {
  const lines = [...(script.lines ?? [])];
  const masked = [...(script.masked ?? [])];
  const confirms = [...(script.confirm ?? [])];
  const phrases = [...(script.phrases ?? [])];
  const base = createRejectingTerminal();
  return {
    ...base,
    async promptLine() {
      const v = lines.shift();
      if (v === undefined) throw new Error('unexpected promptLine');
      return v;
    },
    async promptMasked() {
      const v = masked.shift();
      if (v === undefined) throw new Error('unexpected promptMasked');
      return v;
    },
    async confirm() {
      const v = confirms.shift();
      if (v === undefined) throw new Error('unexpected confirm');
      return v;
    },
    async confirmPhrase() {
      const v = phrases.shift();
      if (v === undefined) throw new Error('unexpected confirmPhrase');
      return v;
    },
  };
}

function descriptor(): InstanceDescriptor {
  return {
    instance_id: INST,
    display_name: 'company-docs',
    canonical_origin: 'https://docs.example.com',
    custom_hostname: 'docs.example.com',
    account_id: 'acct',
    resource_suffix: '3f6m8p0q2r4s6t8v0w2x',
    database_id: 'db',
    bucket_name: 'bucket',
    worker_name: 'worker',
    status: 'active',
    deployed_version: '2.0.0',
    reconciliation: null,
  };
}

async function withAdmin(
  fn: (args: {
    runtime: Runtime;
    cap: ReturnType<typeof captureIo>;
    openDb: () => Promise<ReturnType<typeof openMemorySqlite>['executor']>;
    store: MemoryArtifactStore;
    executor: ReturnType<typeof openMemorySqlite>['executor'];
  }) => Promise<void>,
) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-admin-'));
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-cwd-'));
  const cap = captureIo();
  const runtime = createProcessRuntime({
    homeDir: home,
    cwd,
    platform: 'linux',
    stdoutIsTTY: true,
    stderrIsTTY: true,
    stdinIsTTY: true,
    env: { HOME: home, CLOUDFLARE_ACCOUNT_ID: undefined, CLOUDFLARE_API_TOKEN: undefined },
    io: cap.io,
  });
  const { executor } = openMemorySqlite();
  await applyMigrations(executor);
  await insertInstanceMetadata(executor, {
    id: INST,
    display_name: 'company-docs',
    account_id: 'acct',
    resource_suffix: '3f6m8p0q2r4s6t8v0w2x',
    canonical_origin: 'https://docs.example.com',
    deployed_version: '2.0.0',
  });
  await writeInstanceDescriptor(runtime, descriptor());
  await writeActiveInstanceId(runtime, INST);
  const store = new MemoryArtifactStore();

  try {
    await fn({
      runtime,
      cap,
      openDb: async () => executor,
      store,
      executor,
    });
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

describe('ttl and crypto', () => {
  it('parses ttl grammar and enforces max', () => {
    expect(parseTtlDuration('7d')).toBe(7 * 86400);
    expect(parseTtlDuration('1w')).toBe(604800);
    expect(() => parseTtlDuration('0d')).toThrow();
    expect(() => parseTtlDuration('7D')).toThrow();
    expect(() => parseTtlDuration('366d')).toThrow(/365/);
    expect(MAX_TTL_SECONDS).toBe(31_536_000);
  });

  it('derives password and publishing token verifiers', async () => {
    assertReaderPassword(PASSWORD);
    expect(() => assertReaderPassword('short')).toThrow();
    const verifier = await derivePasswordVerifier(PASSWORD, new Uint8Array(16).fill(1));
    expect(verifier).toMatch(/^pbkdf2-sha256\$600000\$/);
    const token = await generatePublishingToken(new Uint8Array(32).fill(2));
    expect(token.plaintext).toMatch(/^nrd_pub_[A-Za-z0-9_-]{43}$/);
    expect(token.verifier).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('site and token administration', () => {
  it('creates a public site with one-time token and supports list/show json', async () => {
    await withAdmin(async ({ runtime, cap, openDb, store }) => {
      const code = await main(['site', 'create', 'product-handbook'], {
        runtime,
        terminal: scriptedTerminal({ lines: ['public', 'handbook-publisher'] }),
        admin: { openDb, artifactStore: store },
      });
      expect(code).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('Site created.');
      expect(cap.stdout).toMatch(/nrd_pub_[A-Za-z0-9_-]{43}/);
      expect(cap.stdout).toContain('This token will not be displayed again.');
      expect(cap.stdout).not.toMatch(/sha256:|pbkdf2/);

      cap.reset();
      expect(
        await main(['site', 'list', '--json'], {
          runtime,
          admin: { openDb, artifactStore: store },
        }),
      ).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('"slug": "product-handbook"');
      expect(cap.stdout).not.toMatch(/nrd_pub_/);
    });
  });

  it('creates password site, changes access, password, enable/disable, rename, tokens', async () => {
    await withAdmin(async ({ runtime, cap, openDb, store, executor }) => {
      expect(
        await main(['site', 'create', 'investigation'], {
          runtime,
          terminal: scriptedTerminal({
            lines: ['password', 'investigation-publisher'],
            masked: [PASSWORD, PASSWORD],
          }),
          admin: { openDb, artifactStore: store },
        }),
      ).toBe(ExitCode.Success);

      const created = await getSiteBySlug(executor, 'investigation');
      expect(created?.access_mode).toBe('password');
      expect(created?.session_generation).toBe(1);

      expect(
        await main(['site', 'access', 'investigation', 'public'], {
          runtime,
          terminal: scriptedTerminal({ confirm: [true] }),
          admin: { openDb, artifactStore: store },
        }),
      ).toBe(ExitCode.Success);
      expect((await getSiteBySlug(executor, 'investigation'))!.session_generation).toBe(2);

      expect(
        await main(['site', 'access', 'investigation', 'password'], {
          runtime,
          terminal: scriptedTerminal({ masked: [PASSWORD, PASSWORD] }),
          admin: { openDb, artifactStore: store },
        }),
      ).toBe(ExitCode.Success);
      expect((await getSiteBySlug(executor, 'investigation'))!.session_generation).toBe(3);

      expect(
        await main(['site', 'password', 'change', 'investigation'], {
          runtime,
          terminal: scriptedTerminal({ masked: [PASSWORD + 'x', PASSWORD + 'x'] }),
          admin: { openDb, artifactStore: store },
        }),
      ).toBe(ExitCode.Success);
      expect((await getSiteBySlug(executor, 'investigation'))!.session_generation).toBe(4);

      expect(
        await main(['site', 'disable', 'investigation'], {
          runtime,
          terminal: scriptedTerminal({}),
          admin: { openDb, artifactStore: store },
        }),
      ).toBe(ExitCode.Success);
      expect((await getSiteBySlug(executor, 'investigation'))!.enabled).toBe(false);
      expect((await getSiteBySlug(executor, 'investigation'))!.access_mode).toBe('password');

      expect(
        await main(['site', 'enable', 'investigation'], {
          runtime,
          terminal: scriptedTerminal({}),
          admin: { openDb, artifactStore: store },
        }),
      ).toBe(ExitCode.Success);

      expect(
        await main(['site', 'rename', 'investigation', 'case-file'], {
          runtime,
          terminal: scriptedTerminal({ confirm: [true] }),
          admin: { openDb, artifactStore: store },
        }),
      ).toBe(ExitCode.Success);
      expect(await getSiteBySlug(executor, 'investigation')).toBeNull();
      expect(await getSiteBySlug(executor, 'case-file')).toBeTruthy();

      cap.reset();
      expect(
        await main(['token', 'issue', 'case-file', '--name', 'ci', '--ttl', '7d'], {
          runtime,
          terminal: scriptedTerminal({}),
          admin: { openDb, artifactStore: store },
        }),
      ).toBe(ExitCode.Success);
      expect(cap.stdout).toMatch(/nrd_pub_/);
      const tokens = await listTokensForSite(
        executor,
        (await getSiteBySlug(executor, 'case-file'))!.id,
      );
      expect(tokens.some((t) => t.name === 'ci' && t.expires_at)).toBe(true);

      cap.reset();
      expect(
        await main(['token', 'list', 'case-file', '--json'], {
          runtime,
          admin: { openDb, artifactStore: store },
        }),
      ).toBe(ExitCode.Success);
      expect(cap.stdout).not.toMatch(/nrd_pub_/);

      expect(
        await main(['token', 'revoke', 'case-file', 'ci'], {
          runtime,
          terminal: scriptedTerminal({ confirm: [true] }),
          admin: { openDb, artifactStore: store },
        }),
      ).toBe(ExitCode.Success);
    });
  });

  it('deletes a site after slug confirmation and clears R2 prefix', async () => {
    await withAdmin(async ({ runtime, openDb, store, executor }) => {
      expect(
        await main(['site', 'create', 'doomed'], {
          runtime,
          terminal: scriptedTerminal({ lines: ['public', 'initial'] }),
          admin: { openDb, artifactStore: store },
        }),
      ).toBe(ExitCode.Success);
      const site = (await getSiteBySlug(executor, 'doomed'))!;
      await store.put({
        key: `${sitePrefix(site.id)}artifacts/x/nrdocs-manifest.json`,
        body: new TextEncoder().encode('{}'),
      });

      expect(
        await main(['site', 'delete', 'doomed'], {
          runtime,
          terminal: scriptedTerminal({ phrases: [true] }),
          admin: { openDb, artifactStore: store },
        }),
      ).toBe(ExitCode.Success);
      expect(await getSiteBySlug(executor, 'doomed')).toBeNull();
      expect(store.objects.size).toBe(0);
    });
  });

  it('rejects non-interactive mutations and --json on mutating commands', async () => {
    await withAdmin(async ({ runtime, cap, openDb, store }) => {
      const nonTty = createProcessRuntime({
        homeDir: runtime.homeDir,
        cwd: runtime.cwd,
        platform: 'linux',
        stdoutIsTTY: false,
        stderrIsTTY: false,
        stdinIsTTY: false,
        env: { HOME: runtime.homeDir },
        io: cap.io,
      });
      expect(
        await main(['site', 'create', 'x'], {
          runtime: nonTty,
          admin: { openDb, artifactStore: store },
        }),
      ).toBe(ExitCode.Usage);

      expect(
        await main(['site', 'create', 'x', '--json'], {
          runtime,
          terminal: scriptedTerminal({ lines: ['public', 't'] }),
          admin: { openDb, artifactStore: store },
        }),
      ).toBe(ExitCode.Usage);
    });
  });

  it('declining confirmation exits successfully without mutation', async () => {
    await withAdmin(async ({ runtime, openDb, store, executor }) => {
      await main(['site', 'create', 'keep'], {
        runtime,
        terminal: scriptedTerminal({ lines: ['public', 'initial'] }),
        admin: { openDb, artifactStore: store },
      });
      expect(
        await main(['site', 'delete', 'keep'], {
          runtime,
          terminal: scriptedTerminal({ phrases: [false] }),
          admin: { openDb, artifactStore: store },
        }),
      ).toBe(ExitCode.Success);
      expect(await getSiteBySlug(executor, 'keep')).toBeTruthy();
    });
  });
});
