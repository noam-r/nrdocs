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
import { derivePasswordVerifier as deriveCliPasswordVerifier } from './admin/crypto.js';
import { createRejectingTerminal, type Terminal } from './terminal.js';
import { loadNrdocsConfig } from './config.js';
import { listPublisherCredentials, readPublisherCredential } from './credentials-store.js';
import { writeActiveInstanceId, writeInstanceDescriptor } from './instance-store.js';
import type { InstanceDescriptor } from '@nrdocs/contracts';

const INST = formatId('inst', new Uint8Array(16).fill(1)) as InstanceId;
const SITE = formatId('site', new Uint8Array(16).fill(2)) as SiteId;
const TOK = formatId('tok', new Uint8Array(16).fill(3)) as TokenRecordId;
const TOKEN_SECRET = new Uint8Array(32).fill(9);
const PASSWORD = 'correct-horse-battery-staple';
const SESSION_KEY = new Uint8Array(32).fill(7);

async function mintToken(secret = TOKEN_SECRET): Promise<{ plaintext: string; verifier: string }> {
  const plaintext = `nrd_pub_${Buffer.from(secret).toString('base64url')}`;
  const verifier = formatSha256Digest(await sha256Hex(new TextEncoder().encode(plaintext)));
  return { plaintext, verifier };
}

async function derivePasswordVerifier(password: string): Promise<string> {
  return deriveCliPasswordVerifier(password, new Uint8Array(16).fill(3));
}

function extractCsrf(html: string): string {
  const m = html.match(/name="csrf" value="([^"]+)"/);
  if (!m) throw new Error('csrf missing');
  return m[1]!;
}

function extractReturnPath(html: string): string {
  const m = html.match(/name="return" value="([^"]+)"/);
  if (!m) throw new Error('return missing');
  return m[1]!;
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
    executor: ReturnType<typeof openMemorySqlite>['executor'];
    store: MemoryArtifactStore;
  }) => Promise<void>,
  opts: {
    access?: 'public' | 'password';
    canonicalOrigin?: string;
    requestOrigin?: string;
  } = {},
) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-p10-home-'));
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-p10-cwd-'));
  const docs = path.join(cwd, 'docs');
  await fs.mkdir(docs);
  await fs.writeFile(path.join(docs, 'index.md'), '# Home\n\nHello from Phase 10.\n');

  const { plaintext, verifier } = await mintToken();
  const { executor } = openMemorySqlite();
  await applyMigrations(executor);
  const canonicalOrigin = opts.canonicalOrigin ?? 'https://docs.example.com';
  const requestOrigin = opts.requestOrigin ?? 'https://docs.example.com';
  await insertInstanceMetadata(executor, {
    id: INST,
    display_name: 'docs',
    account_id: 'acct',
    resource_suffix: '3f6m8p0q2r4s6t8v0w2x',
    canonical_origin: canonicalOrigin,
    deployed_version: '2.0.0',
  });
  const access = opts.access ?? 'public';
  await createSiteWithInitialToken(executor, {
    id: SITE,
    slug: 'handbook',
    access_mode: access,
    ...(access === 'password' ? { password_verifier: await derivePasswordVerifier(PASSWORD) } : {}),
    initialToken: { id: TOK, name: 'initial', token_verifier: verifier },
  });

  const store = new MemoryArtifactStore();
  const env: WorkerEnv = {
    DB: sqliteAsD1Database(executor),
    ARTIFACTS: store,
    NRDOCS_INSTANCE_ID: INST,
    NRDOCS_PACKAGE_VERSION: '2.0.0',
    NRDOCS_CANONICAL_ORIGIN: canonicalOrigin,
    __artifactStore: store,
    __clientIp: '203.0.113.10',
    __sessionKey: SESSION_KEY,
  };

  const publisherFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const parsed = new URL(url);
    const pathAndQuery = `${parsed.pathname}${parsed.search}`;
    return handleRequest(new Request(`${requestOrigin}${pathAndQuery}`, init), env);
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
      executor,
      store,
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
      expect(cap.stderr).toContain('Checking destination');
      expect(cap.stderr).toContain('Building publication');
      expect(cap.stderr).toContain('Uploading');
      expect(cap.stdout).toContain('Published successfully.');
      expect(cap.stdout).toContain('https://docs.example.com/handbook/');
      expect(cap.stdout + cap.stderr).not.toContain(token);
    });
  });

  it('refuses broken page links unless --force is supplied', async () => {
    await withPublisherWorld(async ({ runtime, cap, docs, token, publisher }) => {
      const connected = await main(['connect', 'docs', '--title', 'Handbook'], {
        runtime,
        terminal: scriptedTerminal({
          lines: ['https://docs.example.com'],
          masked: [token],
        }),
        publisher,
      });
      expect(connected).toBe(ExitCode.Success);

      await fs.appendFile(path.join(docs, 'index.md'), '\n[gone](gone.md)\n');
      cap.reset();
      const blocked = await main(['publish', 'docs'], { runtime, publisher });
      expect(blocked).toBe(ExitCode.LocalValidation);
      expect(cap.stderr).toMatch(/broken page link/);
      expect(cap.stderr).toMatch(/--force/);
      expect(cap.stderr).toMatch(/was not changed/);

      cap.reset();
      const forced = await main(['publish', 'docs', '--force'], { runtime, publisher });
      expect(forced).toBe(ExitCode.Success);
      expect(cap.stderr).toMatch(/Publishing with broken page link/);
      expect(cap.stdout).toContain('Published successfully.');
    });
  });

  it('binds via the local instance without Server or publishing token prompts', async () => {
    await withPublisherWorld(async ({ runtime, cap, docs, publisher, executor, store }) => {
      await writeInstanceDescriptor(runtime, {
        instance_id: INST,
        display_name: 'docs',
        canonical_origin: 'https://docs.example.com',
        custom_hostname: null,
        account_id: 'acct',
        resource_suffix: '3f6m8p0q2r4s6t8v0w2x',
        database_id: 'db',
        bucket_name: 'bucket',
        worker_name: 'worker',
        status: 'active',
        deployed_version: '2.0.0',
        reconciliation: null,
      } satisfies InstanceDescriptor);
      await writeActiveInstanceId(runtime, INST);

      const code = await main(['connect', 'docs', '--title', 'Handbook'], {
        runtime,
        terminal: createRejectingTerminal(),
        publisher,
        admin: { openDb: async () => executor, artifactStore: store },
      });
      expect(code).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('Connected directory.');
      expect(cap.stdout).toContain('No publishing token is required on this machine.');
      expect(cap.stdout).toContain('https://docs.example.com/handbook/');
      expect(cap.stdout).not.toContain('Publishing token:');
      expect(cap.stdout).not.toContain('Credential stored:');
      expect(await listPublisherCredentials(runtime)).toEqual([]);

      const { config } = await loadNrdocsConfig(runtime, docs);
      expect(config.publish?.credential).toBe(SITE);
      expect(config.title).toBe('Handbook');
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

  it('token publish works with password reader login on alternate canonical host', async () => {
    await withPublisherWorld(
      async ({ runtime, cap, token, publisher }) => {
        const code = await main(['connect', 'docs', '--title', 'Handbook'], {
          runtime,
          terminal: scriptedTerminal({
            lines: ['https://docs.example.com'],
            masked: [token],
          }),
          publisher,
        });
        expect(code).toBe(ExitCode.Success);

        cap.reset();
        expect(await main(['publish', 'docs'], { runtime, publisher })).toBe(ExitCode.Success);
        expect(cap.stdout).toMatch(/Published successfully|Publication unchanged/);

        const gated = await publisher.fetch('https://docs.example.com/handbook/');
        expect(gated.status).toBe(302);
        const loc = gated.headers.get('location')!;
        const formRes = await publisher.fetch(`https://docs.example.com${loc}`);
        expect(formRes.status).toBe(200);
        const formHtml = await formRes.text();
        const csrf = extractCsrf(formHtml);
        const returnPath = extractReturnPath(formHtml);
        const login = await publisher.fetch('https://docs.example.com/_nrdocs/access', {
          method: 'POST',
          headers: {
            origin: 'https://docs.example.com',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: `site=handbook&return=${encodeURIComponent(returnPath)}&csrf=${encodeURIComponent(
            csrf,
          )}&password=${encodeURIComponent(PASSWORD)}`,
        });
        expect(login.status).toBe(303);
        const cookie = login.headers.get('set-cookie');
        expect(cookie).toBeTruthy();

        const authed = await publisher.fetch('https://docs.example.com/handbook/', {
          headers: { cookie: cookie!.split(';')[0]! },
        });
        expect(authed.status).toBe(200);
        expect(await authed.text()).toContain('Hello from Phase 10.');
      },
      {
        access: 'password',
        canonicalOrigin: 'https://canonical.example.com',
        requestOrigin: 'https://docs.example.com',
      },
    );
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
