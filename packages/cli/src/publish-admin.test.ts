import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  applyMigrations,
  createSiteWithInitialToken,
  insertInstanceMetadata,
  MemoryArtifactStore,
} from '@nrdocs/persistence';
import { openMemorySqlite } from '@nrdocs/persistence/sqlite';
import type { InstanceDescriptor, InstanceId, SiteId, TokenRecordId } from '@nrdocs/contracts';
import { formatId } from '@nrdocs/contracts';
import { ExitCode, createProcessRuntime, main, type Runtime } from './index.js';
import { writeActiveInstanceId, writeInstanceDescriptor } from './instance-store.js';
import { createRejectingTerminal, type Terminal } from './terminal.js';
import { loadNrdocsConfig } from './config.js';
import { listPublisherCredentials } from './credentials-store.js';
import { generatePublishingToken } from './admin/crypto.js';

const INST = 'inst_01ARZ3NDEKTSV4RRFFQ69G5FAV' as InstanceId;
const SITE_A = formatId('site', new Uint8Array(16).fill(2)) as SiteId;
const SITE_B = formatId('site', new Uint8Array(16).fill(3)) as SiteId;
const TOK_A = formatId('tok', new Uint8Array(16).fill(4)) as TokenRecordId;
const TOK_B = formatId('tok', new Uint8Array(16).fill(5)) as TokenRecordId;
const ENV_TOKEN = `nrd_pub_${'a'.repeat(43)}`;

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
}): Terminal {
  const lines = [...(script.lines ?? [])];
  const masked = [...(script.masked ?? [])];
  const confirms = [...(script.confirm ?? [])];
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
  };
}

function descriptor(id: InstanceId = INST): InstanceDescriptor {
  return {
    instance_id: id,
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

async function seedSite(
  executor: ReturnType<typeof openMemorySqlite>['executor'],
  id: SiteId,
  slug: string,
  tokenId: TokenRecordId,
): Promise<void> {
  const { verifier } = await generatePublishingToken();
  await createSiteWithInitialToken(executor, {
    id,
    slug,
    access_mode: 'public',
    initialToken: { id: tokenId, name: 'initial', token_verifier: verifier },
  });
}

async function withAdmin(
  fn: (args: {
    runtime: Runtime;
    cap: ReturnType<typeof captureIo>;
    openDb: () => Promise<ReturnType<typeof openMemorySqlite>['executor']>;
    store: MemoryArtifactStore;
    executor: ReturnType<typeof openMemorySqlite>['executor'];
    docs: string;
  }) => Promise<void>,
) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-pub-admin-'));
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-pub-cwd-'));
  const docs = path.join(cwd, 'docs');
  await fs.mkdir(docs);
  await fs.writeFile(path.join(docs, 'index.md'), '# Home\n\nHello.\n');
  const cap = captureIo();
  const runtime = createProcessRuntime({
    homeDir: home,
    cwd,
    platform: 'linux',
    stdoutIsTTY: true,
    stderrIsTTY: true,
    stdinIsTTY: true,
    env: {
      HOME: home,
      CLOUDFLARE_ACCOUNT_ID: undefined,
      CLOUDFLARE_API_TOKEN: undefined,
      NRDOCS_URL: undefined,
      NRDOCS_TOKEN: undefined,
    },
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
      docs,
    });
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

describe('admin-local publish', () => {
  it('creates a site when the instance has none, writes yml, and publishes without a token', async () => {
    await withAdmin(async ({ runtime, cap, openDb, store, docs }) => {
      const code = await main(['publish', 'docs', '--title', 'Handbook'], {
        runtime,
        terminal: scriptedTerminal({ lines: ['handbook', 'public'] }),
        admin: { openDb, artifactStore: store },
      });
      expect(code).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('Published successfully.');
      expect(cap.stdout).toContain('https://docs.example.com/handbook/');
      expect(cap.stdout).not.toMatch(/nrd_pub_/);
      expect(cap.stdout).not.toContain('Server:');

      const { config } = await loadNrdocsConfig(runtime, docs);
      expect(config.publish?.credential).toMatch(/^site_/);
      expect(config.title).toBe('Handbook');
      expect(await listPublisherCredentials(runtime)).toEqual([]);
      expect(store.objects.size).toBeGreaterThan(0);
    });
  });

  it('binds an unbound directory to the only site without Server or token prompts', async () => {
    await withAdmin(async ({ runtime, cap, openDb, store, executor, docs }) => {
      await seedSite(executor, SITE_A, 'handbook', TOK_A);
      const code = await main(['publish', 'docs', '--title', 'Handbook'], {
        runtime,
        terminal: createRejectingTerminal(),
        admin: { openDb, artifactStore: store },
      });
      expect(code).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('Publishing to:');
      expect(cap.stdout).toContain('handbook');
      expect(cap.stdout).toContain('Published successfully.');
      expect(cap.stdout).toContain('https://docs.example.com/handbook/');
      const { config } = await loadNrdocsConfig(runtime, docs);
      expect(config.publish?.credential).toBe(SITE_A);
      expect(await listPublisherCredentials(runtime)).toEqual([]);
    });
  });

  it('admin connect binds without a publishing token', async () => {
    await withAdmin(async ({ runtime, cap, openDb, store, executor, docs }) => {
      await seedSite(executor, SITE_A, 'handbook', TOK_A);
      const code = await main(['connect', 'docs', '--title', 'Handbook'], {
        runtime,
        terminal: createRejectingTerminal(),
        admin: { openDb, artifactStore: store },
      });
      expect(code).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('Connected directory.');
      expect(cap.stdout).toContain('No publishing token is required on this machine.');
      expect(cap.stdout).toContain('https://docs.example.com/handbook/');
      expect(cap.stdout).not.toContain('Published successfully.');
      const { config } = await loadNrdocsConfig(runtime, docs);
      expect(config.publish?.credential).toBe(SITE_A);
      expect(await listPublisherCredentials(runtime)).toEqual([]);
    });
  });

  it('lets the operator pick among several sites', async () => {
    await withAdmin(async ({ runtime, cap, openDb, store, executor, docs }) => {
      await seedSite(executor, SITE_A, 'alpha', TOK_A);
      await seedSite(executor, SITE_B, 'beta', TOK_B);
      const code = await main(['publish', 'docs', '--title', 'Beta Docs'], {
        runtime,
        terminal: scriptedTerminal({ lines: ['2'] }),
        admin: { openDb, artifactStore: store },
      });
      expect(code).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('Publish to which site?');
      expect(cap.stdout).toContain('https://docs.example.com/beta/');
      const { config } = await loadNrdocsConfig(runtime, docs);
      expect(config.publish?.credential).toBe(SITE_B);
    });
  });

  it('rejects an out-of-range site picker index', async () => {
    await withAdmin(async ({ runtime, cap, openDb, store, executor, docs }) => {
      await seedSite(executor, SITE_A, 'alpha', TOK_A);
      await seedSite(executor, SITE_B, 'beta', TOK_B);
      const code = await main(['publish', 'docs', '--title', 'X'], {
        runtime,
        terminal: scriptedTerminal({ lines: ['9'] }),
        admin: { openDb, artifactStore: store },
      });
      expect(code).toBe(ExitCode.Usage);
      expect(cap.stderr).toMatch(/Choose a site by number/i);
      await expect(fs.access(path.join(docs, 'nrdocs.yml'))).rejects.toThrow();
    });
  });

  it('publishes a bound directory through the admin instance without connect', async () => {
    await withAdmin(async ({ runtime, cap, openDb, store, executor, docs }) => {
      await seedSite(executor, SITE_A, 'handbook', TOK_A);
      await fs.writeFile(
        path.join(docs, 'nrdocs.yml'),
        `publish:\n  credential: ${SITE_A}\n\ntitle: Handbook\nnavigation: auto\n`,
      );
      const code = await main(['publish', 'docs'], {
        runtime,
        terminal: createRejectingTerminal(),
        admin: { openDb, artifactStore: store },
      });
      expect(code).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('Published successfully.');
      expect(await listPublisherCredentials(runtime)).toEqual([]);
      expect(store.objects.size).toBeGreaterThan(0);
    });
  });

  it('repeat admin publish of a bound directory does not require a TTY', async () => {
    await withAdmin(async ({ runtime, cap, openDb, store, executor, docs }) => {
      await seedSite(executor, SITE_A, 'handbook', TOK_A);
      await fs.writeFile(
        path.join(docs, 'nrdocs.yml'),
        `publish:\n  credential: ${SITE_A}\n\ntitle: Handbook\nnavigation: auto\n`,
      );
      const ciRuntime = createProcessRuntime({
        homeDir: runtime.homeDir,
        cwd: runtime.cwd,
        platform: 'linux',
        stdoutIsTTY: false,
        stderrIsTTY: false,
        stdinIsTTY: false,
        env: {
          HOME: runtime.homeDir,
          NRDOCS_URL: undefined,
          NRDOCS_TOKEN: undefined,
        },
        io: cap.io,
      });
      const code = await main(['publish', 'docs'], {
        runtime: ciRuntime,
        admin: { openDb, artifactStore: store },
      });
      expect(code).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('Published successfully.');
    });
  });

  it('tells a non-admin machine to connect when no token file exists', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-pub-none-'));
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-pub-none-cwd-'));
    const docs = path.join(cwd, 'docs');
    await fs.mkdir(docs);
    await fs.writeFile(path.join(docs, 'index.md'), '# Home\n');
    await fs.writeFile(
      path.join(docs, 'nrdocs.yml'),
      `publish:\n  credential: ${SITE_A}\n\ntitle: Handbook\nnavigation: auto\n`,
    );
    const cap = captureIo();
    const runtime = createProcessRuntime({
      homeDir: home,
      cwd,
      platform: 'linux',
      stdoutIsTTY: true,
      stderrIsTTY: true,
      stdinIsTTY: true,
      env: { HOME: home, NRDOCS_URL: undefined, NRDOCS_TOKEN: undefined },
      io: cap.io,
    });
    try {
      const code = await main(['publish', 'docs'], { runtime });
      expect(code).toBe(ExitCode.CredentialOrAuthority);
      expect(cap.stderr).toMatch(/nrdocs connect/i);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('does not fall through to admin bind when NRDOCS_URL and NRDOCS_TOKEN are set', async () => {
    await withAdmin(async ({ runtime, cap, openDb, store, docs }) => {
      const envRuntime = createProcessRuntime({
        homeDir: runtime.homeDir,
        cwd: runtime.cwd,
        platform: 'linux',
        stdoutIsTTY: true,
        stderrIsTTY: true,
        stdinIsTTY: true,
        env: {
          HOME: runtime.homeDir,
          NRDOCS_URL: 'https://docs.example.com',
          NRDOCS_TOKEN: ENV_TOKEN,
        },
        io: cap.io,
      });
      const code = await main(['publish', 'docs', '--title', 'Handbook'], {
        runtime: envRuntime,
        terminal: scriptedTerminal({ lines: ['handbook', 'public'] }),
        admin: { openDb, artifactStore: store },
      });
      expect(code).toBe(ExitCode.CredentialOrAuthority);
      expect(cap.stderr).toMatch(/publish\.credential is required|nrdocs connect/i);
      expect(store.objects.size).toBe(0);
      await expect(fs.access(path.join(docs, 'nrdocs.yml'))).rejects.toThrow();
    });
  });

  it('prefers environment credentials over an admin session for a bound directory', async () => {
    await withAdmin(async ({ runtime, cap, openDb, store, executor, docs }) => {
      await seedSite(executor, SITE_A, 'handbook', TOK_A);
      await fs.writeFile(
        path.join(docs, 'nrdocs.yml'),
        `publish:\n  credential: ${SITE_A}\n\ntitle: Handbook\nnavigation: auto\n`,
      );
      const envRuntime = createProcessRuntime({
        homeDir: runtime.homeDir,
        cwd: runtime.cwd,
        platform: 'linux',
        stdoutIsTTY: true,
        stderrIsTTY: true,
        stdinIsTTY: true,
        env: {
          HOME: runtime.homeDir,
          NRDOCS_URL: 'https://docs.example.com',
          NRDOCS_TOKEN: ENV_TOKEN,
        },
        io: cap.io,
      });
      const code = await main(['publish', 'docs'], {
        runtime: envRuntime,
        admin: { openDb, artifactStore: store },
      });
      expect(code).not.toBe(ExitCode.Success);
      expect(cap.stdout).not.toContain('Published successfully.');
      expect(store.objects.size).toBe(0);
    });
  });
});
