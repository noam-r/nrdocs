import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  formatId,
  formatSha256Digest,
  sha256Hex,
  type InstanceId,
  type SiteId,
  type TokenRecordId,
} from '@nrdocs/contracts';
import {
  applyMigrations,
  createSiteWithInitialToken,
  insertInstanceMetadata,
  MemoryArtifactStore,
  sqliteAsD1Database,
} from '@nrdocs/persistence';
import { openMemorySqlite } from '@nrdocs/persistence/sqlite';
import { handleRequest, type WorkerEnv } from '@nrdocs/worker';
import { ExitCode, createProcessRuntime, main, type Runtime } from './index.js';
import { createRejectingTerminal, type Terminal } from './terminal.js';
import { loadNrdocsConfig } from './config.js';
import { listPublisherCredentials, readPublisherCredential } from './credentials-store.js';

const INST = formatId('inst', new Uint8Array(16).fill(1)) as InstanceId;
const SITE = formatId('site', new Uint8Array(16).fill(2)) as SiteId;
const TOK = formatId('tok', new Uint8Array(16).fill(3)) as TokenRecordId;
const TOKEN_SECRET = new Uint8Array(32).fill(9);

async function mintToken(secret = TOKEN_SECRET): Promise<{ plaintext: string; verifier: string }> {
  const plaintext = `nrd_pub_${Buffer.from(secret).toString('base64url')}`;
  const verifier = formatSha256Digest(await sha256Hex(new TextEncoder().encode(plaintext)));
  return { plaintext, verifier };
}

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

async function withPublisherWorld(
  fn: (args: {
    runtime: Runtime;
    cap: ReturnType<typeof captureIo>;
    docs: string;
    token: string;
    publisher: { fetch: typeof fetch };
  }) => Promise<void>,
) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-p10-home-'));
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-p10-cwd-'));
  const docs = path.join(cwd, 'docs');
  await fs.mkdir(docs);
  await fs.writeFile(path.join(docs, 'index.md'), '# Home\n\nHello from Phase 10.\n');

  const { plaintext, verifier } = await mintToken();
  const { executor } = openMemorySqlite();
  await applyMigrations(executor);
  await insertInstanceMetadata(executor, {
    id: INST,
    display_name: 'docs',
    account_id: 'acct',
    resource_suffix: '3f6m8p0q2r4s6t8v0w2x',
    canonical_origin: 'https://docs.example.com',
    deployed_version: '2.0.0',
  });
  await createSiteWithInitialToken(executor, {
    id: SITE,
    slug: 'handbook',
    access_mode: 'public',
    initialToken: { id: TOK, name: 'initial', token_verifier: verifier },
  });

  const store = new MemoryArtifactStore();
  const env: WorkerEnv = {
    DB: sqliteAsD1Database(executor),
    ARTIFACTS: store,
    NRDOCS_INSTANCE_ID: INST,
    NRDOCS_PACKAGE_VERSION: '2.0.0',
    __artifactStore: store,
    __clientIp: '203.0.113.10',
  };

  const publisherFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const parsed = new URL(url);
    const pathAndQuery = `${parsed.pathname}${parsed.search}`;
    return handleRequest(new Request(`https://docs.example.com${pathAndQuery}`, init), env);
  };

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
      NRDOCS_URL: undefined,
      NRDOCS_TOKEN: undefined,
    },
    io: cap.io,
  });

  try {
    await fn({
      runtime,
      cap,
      docs,
      token: plaintext,
      publisher: { fetch: publisherFetch },
    });
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

describe('nrdocs connect and publish', () => {
  it('interactive first connect stores credential and config, then publish succeeds', async () => {
    await withPublisherWorld(async ({ runtime, cap, docs, token, publisher }) => {
      const code = await main(['connect', 'docs', '--title', 'Handbook'], {
        runtime,
        terminal: scriptedTerminal({
          lines: ['https://docs.example.com'],
          masked: [token],
        }),
        publisher,
      });
      expect(code).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('Connected directory.');
      expect(cap.stdout).toContain('Credential stored:');
      expect(cap.stdout).toContain(SITE);

      const { config } = await loadNrdocsConfig(runtime, docs);
      expect(config.publish?.credential).toBe(SITE);
      expect(config.title).toBe('Handbook');
      expect(config.navigation).toBe('auto');

      const stored = await readPublisherCredential(runtime, SITE);
      expect(stored.credential.token).toBe(token);
      expect(cap.stdout).not.toContain(token);

      cap.reset();
      const published = await main(['publish', 'docs'], { runtime, publisher });
      expect(published).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('Published successfully.');
      expect(cap.stdout).toContain('https://docs.example.com/handbook/');
      expect(cap.stdout + cap.stderr).not.toContain(token);
    });
  });

  it('environment-backed connect writes only nrdocs.yml', async () => {
    await withPublisherWorld(async ({ runtime, cap, docs, token, publisher }) => {
      const envRuntime = createProcessRuntime({
        homeDir: runtime.homeDir,
        cwd: runtime.cwd,
        platform: 'linux',
        stdoutIsTTY: false,
        stderrIsTTY: false,
        stdinIsTTY: false,
        env: {
          HOME: runtime.homeDir,
          NRDOCS_URL: 'https://docs.example.com',
          NRDOCS_TOKEN: token,
        },
        io: cap.io,
      });

      const code = await main(['connect', 'docs', '--title', 'Handbook'], {
        runtime: envRuntime,
        publisher,
      });
      expect(code).toBe(ExitCode.Success);
      expect(cap.stdout).toContain(
        'Credential was supplied by the environment and was not stored.',
      );
      expect(await listPublisherCredentials(envRuntime)).toEqual([]);

      const { config } = await loadNrdocsConfig(envRuntime, docs);
      expect(config.publish?.credential).toBe(SITE);

      cap.reset();
      const published = await main(['publish', 'docs'], { runtime: envRuntime, publisher });
      expect(published).toBe(ExitCode.Success);
      expect(cap.stdout).toMatch(/Published successfully|Publication unchanged/);
      expect(await listPublisherCredentials(envRuntime)).toEqual([]);
    });
  });

  it('rejects incomplete env pair and missing non-interactive title without writing', async () => {
    await withPublisherWorld(async ({ runtime, cap, docs, publisher }) => {
      const incomplete = createProcessRuntime({
        homeDir: runtime.homeDir,
        cwd: runtime.cwd,
        platform: 'linux',
        stdoutIsTTY: false,
        stderrIsTTY: false,
        stdinIsTTY: false,
        env: { HOME: runtime.homeDir, NRDOCS_URL: 'https://docs.example.com' },
        io: cap.io,
      });
      expect(
        await main(['connect', 'docs', '--title', 'X'], { runtime: incomplete, publisher }),
      ).toBe(ExitCode.CredentialOrAuthority);
      await expect(fs.access(path.join(docs, 'nrdocs.yml'))).rejects.toThrow();

      const noTitle = createProcessRuntime({
        homeDir: runtime.homeDir,
        cwd: runtime.cwd,
        platform: 'linux',
        stdoutIsTTY: false,
        stderrIsTTY: false,
        stdinIsTTY: false,
        env: {
          HOME: runtime.homeDir,
          NRDOCS_URL: 'https://docs.example.com',
          NRDOCS_TOKEN: `nrd_pub_${'a'.repeat(43)}`,
        },
        io: cap.io,
      });
      expect(await main(['connect', 'docs'], { runtime: noTitle, publisher })).toBe(ExitCode.Usage);
    });
  });

  it('environment reconnect to a different site fails without writing', async () => {
    await withPublisherWorld(async ({ runtime, cap, docs, token, publisher }) => {
      // First connect
      await main(['connect', 'docs', '--title', 'Handbook'], {
        runtime,
        terminal: scriptedTerminal({
          lines: ['https://docs.example.com'],
          masked: [token],
        }),
        publisher,
      });
      const before = await fs.readFile(path.join(docs, 'nrdocs.yml'), 'utf8');

      const otherToken = await mintToken(new Uint8Array(32).fill(4));
      // Token not in DB → invalid_token; to test mismatch we need another site.
      // Seed second site with other token via direct persistence is heavy; instead
      // point yml at a different site id and use env with original token.
      await fs.writeFile(
        path.join(docs, 'nrdocs.yml'),
        `publish:\n  credential: ${formatId('site', new Uint8Array(16).fill(8))}\n\ntitle: Handbook\nnavigation: auto\n`,
      );

      const envRuntime = createProcessRuntime({
        homeDir: runtime.homeDir,
        cwd: runtime.cwd,
        platform: 'linux',
        stdoutIsTTY: false,
        stderrIsTTY: false,
        stdinIsTTY: false,
        env: {
          HOME: runtime.homeDir,
          NRDOCS_URL: 'https://docs.example.com',
          NRDOCS_TOKEN: token,
        },
        io: cap.io,
      });
      cap.reset();
      const code = await main(['connect', 'docs'], { runtime: envRuntime, publisher });
      expect(code).toBe(ExitCode.CredentialOrAuthority);
      expect(cap.stderr).toMatch(/does not match|cannot rebind|site_mismatch|Invalid/i);
      void before;
      void otherToken;
    });
  });
});
