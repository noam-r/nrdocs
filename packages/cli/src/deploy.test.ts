import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExitCode, createProcessRuntime, main, type Runtime } from './index.js';
import { openMemorySqlite } from '@nrdocs/persistence/sqlite';
import { createFakeCloudflare, encodeMarker } from './deploy/fake-cloudflare.js';
import {
  createR2ArtifactStoreFromControlPlane,
  rateLimitNamespaceId,
} from './deploy/live-cloudflare.js';
import { extractWranglerToken } from './deploy/auth.js';
import {
  classifyCfError,
  parseAccountsResult,
  parseCfEnvelope,
  parseD1CreateResult,
} from './deploy/parsers.js';
import { generateResourceSuffix, plannedResourceNames } from './deploy/names.js';
import { createRejectingTerminal, type Terminal } from './terminal.js';
import type { InstanceDescriptor } from '@nrdocs/contracts';
import {
  writeInstanceDescriptor,
  writeActiveInstanceId,
  readActiveInstanceId,
} from './instance-store.js';
import { runDeployCommand } from './deploy.js';
import { encodeR2ObjectKeyPath, parseR2ObjectsList } from './deploy/cloudflare.js';

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

function promptTerminal(answers: string[]): Terminal {
  const queue = [...answers];
  const base = createRejectingTerminal();
  return {
    ...base,
    async promptLine() {
      const next = queue.shift();
      if (next === undefined) throw new Error('unexpected prompt');
      return next;
    },
  };
}

/** Same in-memory D1 across deploy steps (migrations → origin update). */
function stableOpenD1() {
  const mem = openMemorySqlite();
  return async () => mem.executor;
}

async function withTemp(
  fn: (runtime: Runtime, cap: ReturnType<typeof captureIo>, cwd: string) => Promise<void>,
  opts: { tty?: boolean; env?: Record<string, string | undefined> } = {},
) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-cli-'));
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-cwd-'));
  const cap = captureIo();
  const runtime = createProcessRuntime({
    homeDir: home,
    cwd,
    platform: 'linux',
    stdoutIsTTY: opts.tty ?? true,
    stderrIsTTY: opts.tty ?? true,
    stdinIsTTY: opts.tty ?? true,
    env: {
      HOME: home,
      CLOUDFLARE_ACCOUNT_ID: undefined,
      CLOUDFLARE_API_TOKEN: undefined,
      ...opts.env,
    },
    io: cap.io,
  });
  try {
    await fn(runtime, cap, cwd);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

describe('cloudflare parsers', () => {
  it('parses success, already-exists, permission, rate-limit, and malformed envelopes', () => {
    expect(extractWranglerToken({ access_token: 'tok' })).toBe('tok');
    expect(parseAccountsResult([{ id: 'a', name: 'A' }])).toEqual([{ id: 'a', name: 'A' }]);
    expect(() => parseAccountsResult('x')).toThrow(/malformed/);
    const ok = parseCfEnvelope(
      { success: true, errors: [], result: { uuid: 'u', name: 'n' } },
      (r) => parseD1CreateResult(r),
    );
    expect(ok.result.uuid).toBe('u');
    expect(
      classifyCfError(429, { success: false, errors: [{ message: 'rate' }], result: null }),
    ).toBe('rate_limited');
    expect(
      classifyCfError(403, { success: false, errors: [{ message: 'denied' }], result: null }),
    ).toBe('permission_denied');
    expect(
      classifyCfError(409, {
        success: false,
        errors: [{ message: 'already exists' }],
        result: null,
      }),
    ).toBe('already_exists');
  });

  it('parses R2 object lists flexibly and encodes object key paths', () => {
    expect(parseR2ObjectsList([{ key: 'a/b' }, { name: 'c' }])).toEqual({ keys: ['a/b', 'c'] });
    expect(parseR2ObjectsList({ objects: [{ key: 'x' }] }, { cursor: 'next' })).toEqual({
      keys: ['x'],
      cursor: 'next',
    });
    expect(encodeR2ObjectKeyPath('sites/s1/file.txt')).toBe('sites/s1/file.txt');
    expect(encodeR2ObjectKeyPath('a b/c')).toBe('a%20b/c');
    expect(rateLimitNamespaceId('inst_1', 'PASSWORD_IP_LIMIT')).toMatch(/^[1-9][0-9]*$/);
    expect(rateLimitNamespaceId('inst_1', 'PASSWORD_IP_LIMIT')).not.toBe(
      rateLimitNamespaceId('inst_1', 'PASSWORD_SITE_LIMIT'),
    );
  });

  it('derives deterministic resource names', () => {
    const suffix = generateResourceSuffix(new Uint8Array(16).fill(7));
    expect(suffix).toHaveLength(20);
    const names = plannedResourceNames('ABCDEFGHrest', suffix);
    expect(names.worker_name).toBe(`nrdocs-${suffix}`);
    expect(names.database_name).toBe(`nrdocs-${suffix}-d1`);
    expect(names.bucket_name).toBe(`nrdocs-abcdefgh-${suffix}-r2`);
  });
});

describe('nrdocs deploy', () => {
  it('deploys from an empty directory without mutating it and writes a credential-free descriptor', async () => {
    await withTemp(async (runtime, cap, cwd) => {
      const before = await fs.readdir(cwd);
      const { client, state } = createFakeCloudflare();
      const terminal = promptTerminal(['company-docs', '1']);
      const code = await main(['deploy', '--new'], {
        runtime,
        terminal,
        deploy: {
          cloudflare: client,
          openD1: stableOpenD1(),
          randomBytes: (n) => new Uint8Array(n).map((_, i) => (i + 3) & 0xff),
        },
      });
      expect(code).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('nrdocs deployed.');
      expect(cap.stdout).toContain('company-docs');
      expect(cap.stdout).toMatch(/Instance:\s+inst_/);
      expect(await fs.readdir(cwd)).toEqual(before);
      expect(state.deployedWorkers).toHaveLength(1);
      expect(state.deployedWorkers[0]!.createSessionKey).toBe(true);
      expect(state.deployedWorkers[0]!.sessionKeyBytes?.byteLength).toBe(32);
      expect(state.deployedWorkers[0]!.platformMermaid.length).toBeGreaterThan(0);
      expect(state.workers.size).toBe(1);

      const active = await readActiveInstanceId(runtime);
      expect(active).toBeTruthy();
      const text = await fs.readFile(
        path.join(runtime.homeDir, '.nrdocs', 'instances', `${active}.json`),
        'utf8',
      );
      expect(text).not.toMatch(/CLOUDFLARE|api_token|nrd_pub_|session/i);
      const desc = JSON.parse(text) as InstanceDescriptor;
      expect(desc.status).toBe('active');
      expect(desc.display_name).toBe('company-docs');
      expect(desc.custom_hostname).toBeNull();
    });
  });

  it('redeploys an active instance and does not rewrite active on --instance', async () => {
    await withTemp(async (runtime, cap) => {
      const { client, state } = createFakeCloudflare();
      const terminal = promptTerminal(['company-docs', '1']);
      expect(
        await main(['deploy', '--new'], {
          runtime,
          terminal,
          deploy: {
            cloudflare: client,
            openD1: stableOpenD1(),
            randomBytes: (n) => new Uint8Array(n).map((_, i) => (i + 9) & 0xff),
          },
        }),
      ).toBe(ExitCode.Success);
      const active = (await readActiveInstanceId(runtime))!;
      const markerKey = [...state.objects.keys()].find((k) => k.endsWith('_nrdocs/instance.json'))!;
      expect(markerKey).toBeTruthy();
      const deployedBefore = state.deployedWorkers.length;

      // Create a second instance as active to prove --instance does not switch
      const other: InstanceDescriptor = {
        instance_id: active,
        display_name: 'company-docs',
        canonical_origin: 'https://nrdocs-test.example.workers.dev',
        custom_hostname: null,
        account_id: state.accounts[0]!.id,
        resource_suffix: JSON.parse(
          await fs.readFile(
            path.join(runtime.homeDir, '.nrdocs', 'instances', `${active}.json`),
            'utf8',
          ),
        ).resource_suffix,
        database_id: state.d1[0]!.uuid,
        bucket_name: state.r2[0]!,
        worker_name: [...state.workers][0]!,
        status: 'active',
        deployed_version: '2.0.0',
        reconciliation: null,
      };
      await writeInstanceDescriptor(runtime, other);
      await writeActiveInstanceId(runtime, active);

      const beforeActive = await readActiveInstanceId(runtime);
      expect(
        await main(['deploy', '--instance', active], {
          runtime,
          terminal: promptTerminal([]),
          deploy: {
            cloudflare: client,
            openD1: stableOpenD1(),
          },
        }),
      ).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('nrdocs deployed.');
      expect(state.deployedWorkers.length).toBeGreaterThan(deployedBefore);
      expect(
        state.deployedWorkers.slice(deployedBefore).every((w) => w.createSessionKey === false),
      ).toBe(true);
      expect(await readActiveInstanceId(runtime)).toBe(beforeActive);
    });
  });

  it('defaults deploy to the active instance without prompting for a new name', async () => {
    await withTemp(async (runtime, cap) => {
      const { client, state } = createFakeCloudflare();
      expect(
        await main(['deploy', '--new'], {
          runtime,
          terminal: promptTerminal(['company-docs', '1']),
          deploy: {
            cloudflare: client,
            openD1: stableOpenD1(),
            randomBytes: (n) => new Uint8Array(n).map((_, i) => (i + 11) & 0xff),
          },
        }),
      ).toBe(ExitCode.Success);

      const active = await readActiveInstanceId(runtime);
      expect(active).toBeTruthy();

      const deployedBefore = state.deployedWorkers.length;
      const second = await main(['deploy'], {
        runtime,
        terminal: createRejectingTerminal(),
        deploy: {
          cloudflare: client,
          openD1: stableOpenD1(),
        },
      });
      expect(second).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('nrdocs deployed.');
      expect(state.deployedWorkers.length).toBeGreaterThan(deployedBefore);
      expect(state.deployedWorkers[0]!.createSessionKey).toBe(true);
      expect(state.deployedWorkers.at(-1)!.createSessionKey).toBe(false);
      expect(await readActiveInstanceId(runtime)).toBe(active);
    });
  });

  it('refuses to create a new instance without --new', async () => {
    await withTemp(async (runtime, cap) => {
      const { client, state } = createFakeCloudflare();
      expect(
        await main(['deploy'], {
          runtime,
          terminal: promptTerminal(['rogue', '1']),
          deploy: { cloudflare: client, openD1: stableOpenD1() },
        }),
      ).toBe(ExitCode.Usage);
      expect(cap.stderr).toMatch(/pass --new/i);
      expect(state.deployedWorkers).toHaveLength(0);
      expect(state.workers.size).toBe(0);
    });
  });

  it('lists local instances when --new is omitted and none is active', async () => {
    await withTemp(async (runtime, cap) => {
      const { client, state } = createFakeCloudflare();
      expect(
        await main(['deploy', '--new'], {
          runtime,
          terminal: promptTerminal(['company-docs', '1']),
          deploy: {
            cloudflare: client,
            openD1: stableOpenD1(),
            randomBytes: (n) => new Uint8Array(n).map((_, i) => (i + 19) & 0xff),
          },
        }),
      ).toBe(ExitCode.Success);
      const active = (await readActiveInstanceId(runtime))!;
      await fs.unlink(path.join(runtime.homeDir, '.nrdocs', 'active-instance'));
      const deployedBefore = state.deployedWorkers.length;

      expect(
        await main(['deploy'], {
          runtime,
          terminal: promptTerminal(['other', '1']),
          deploy: { cloudflare: client, openD1: stableOpenD1() },
        }),
      ).toBe(ExitCode.Usage);
      expect(cap.stderr).toContain(active);
      expect(cap.stderr).toMatch(/nrdocs deploy --new/);
      expect(state.deployedWorkers).toHaveLength(deployedBefore);
    });
  });

  it('rejects --new combined with --instance and --domain without --new', async () => {
    await withTemp(async (runtime, cap) => {
      const { client } = createFakeCloudflare();
      expect(
        await main(['deploy', '--new'], {
          runtime,
          terminal: promptTerminal(['company-docs', '1']),
          deploy: {
            cloudflare: client,
            openD1: stableOpenD1(),
            randomBytes: (n) => new Uint8Array(n).map((_, i) => (i + 21) & 0xff),
          },
        }),
      ).toBe(ExitCode.Success);
      const active = (await readActiveInstanceId(runtime))!;

      expect(
        await main(['deploy', '--new', '--instance', active], {
          runtime,
          terminal: createRejectingTerminal(),
          deploy: { cloudflare: client },
        }),
      ).toBe(ExitCode.Usage);
      expect(cap.stderr).toMatch(/cannot be combined/i);

      expect(
        await main(['deploy', '--domain', 'docs.example.com'], {
          runtime,
          terminal: createRejectingTerminal(),
          deploy: { cloudflare: client },
        }),
      ).toBe(ExitCode.Usage);
      expect(cap.stderr).toMatch(/--domain is only valid with --new/i);
    });
  });

  it('does not create a second instance when --new is declined', async () => {
    await withTemp(async (runtime, cap) => {
      const { client, state } = createFakeCloudflare();
      expect(
        await main(['deploy', '--new'], {
          runtime,
          terminal: promptTerminal(['company-docs', '1']),
          deploy: {
            cloudflare: client,
            openD1: stableOpenD1(),
            randomBytes: (n) => new Uint8Array(n).map((_, i) => (i + 23) & 0xff),
          },
        }),
      ).toBe(ExitCode.Success);
      const active = await readActiveInstanceId(runtime);
      const deployedBefore = state.deployedWorkers.length;

      expect(
        await main(['deploy', '--new'], {
          runtime,
          terminal: promptTerminal(['n']),
          deploy: { cloudflare: client, openD1: stableOpenD1() },
        }),
      ).toBe(ExitCode.Usage);
      expect(cap.stderr).toMatch(/cancelled/i);
      expect(state.deployedWorkers).toHaveLength(deployedBefore);
      expect(await readActiveInstanceId(runtime)).toBe(active);
    });
  });

  it('redeploys an active instance without re-running D1 batch migrations', async () => {
    await withTemp(async (runtime) => {
      const { client, state } = createFakeCloudflare();
      expect(
        await main(['deploy', '--new'], {
          runtime,
          terminal: promptTerminal(['company-docs', '1']),
          deploy: {
            cloudflare: client,
            randomBytes: (n) => new Uint8Array(n).map((_, i) => (i + 13) & 0xff),
          },
        }),
      ).toBe(ExitCode.Success);

      const firstBatchCalls = state.d1BatchCalls;
      const firstWorkerDeploys = state.deployedWorkers.length;

      expect(
        await main(['deploy'], {
          runtime,
          terminal: createRejectingTerminal(),
          deploy: {
            cloudflare: client,
          },
        }),
      ).toBe(ExitCode.Success);

      expect(state.d1BatchCalls).toBe(firstBatchCalls);
      expect(state.deployedWorkers.length).toBeGreaterThan(firstWorkerDeploys);
      expect(state.deployedWorkers[firstWorkerDeploys]!.createSessionKey).toBe(false);
    });
  });

  it('recovers when migrations were applied but migration step is missing in reconciliation', async () => {
    await withTemp(async (runtime) => {
      const { client } = createFakeCloudflare();
      expect(
        await main(['deploy', '--new'], {
          runtime,
          terminal: promptTerminal(['company-docs', '1']),
          deploy: {
            cloudflare: client,
            randomBytes: (n) => new Uint8Array(n).map((_, i) => (i + 17) & 0xff),
          },
        }),
      ).toBe(ExitCode.Success);

      const active = (await readActiveInstanceId(runtime))!;
      const current = JSON.parse(
        await fs.readFile(
          path.join(runtime.homeDir, '.nrdocs', 'instances', `${active}.json`),
          'utf8',
        ),
      ) as InstanceDescriptor;
      const desc: InstanceDescriptor = {
        ...current,
        status: 'provisioning',
        reconciliation: {
          completed_steps: ['preflight', 'd1', 'r2', 'origin'],
          resume_hint: `nrdocs deploy --instance ${active}`,
        },
      };
      await writeInstanceDescriptor(runtime, desc);

      let d1BatchCalls = 0;
      const baseQuery = client.d1Query.bind(client);
      const baseBatch = client.d1Batch.bind(client);
      client.d1Query = async (accountId, databaseId, sql, params = []) => {
        if (/sqlite_master/i.test(sql) && /schema_migrations/i.test(sql)) {
          return { results: [{ name: 'schema_migrations' }], meta: { changes: 0 } };
        }
        if (/SELECT id FROM instance_metadata/i.test(sql)) {
          return { results: [{ id: active }], meta: { changes: 0 } };
        }
        return baseQuery(accountId, databaseId, sql, params);
      };
      client.d1Batch = async (accountId, databaseId, statements) => {
        d1BatchCalls += 1;
        if (
          statements.some(
            (s) =>
              /CREATE TABLE schema_migrations/i.test(s.sql) ||
              /CREATE TABLE instance_metadata/i.test(s.sql),
          )
        ) {
          throw new Error('baseline migrations should not re-run');
        }
        return baseBatch(accountId, databaseId, statements);
      };

      expect(
        await main(['deploy', '--instance', active], {
          runtime,
          terminal: createRejectingTerminal(),
          deploy: { cloudflare: client },
        }),
      ).toBe(ExitCode.Success);
      expect(d1BatchCalls).toBe(0);
    });
  });

  it('fails permission preflight with authority exit and rejects non-interactive deploy', async () => {
    await withTemp(async (runtime, cap) => {
      const { client } = createFakeCloudflare({ failStep: 'permission' });
      expect(
        await main(['deploy', '--new'], {
          runtime,
          terminal: promptTerminal(['x', '1']),
          deploy: { cloudflare: client },
        }),
      ).toBe(ExitCode.CredentialOrAuthority);
      expect(cap.stderr).toMatch(/permission|capability|Workers/i);
    });

    await withTemp(
      async (runtime, cap) => {
        expect(await main(['deploy', '--new'], { runtime })).toBe(ExitCode.Usage);
        expect(cap.stderr).toMatch(/interactive/i);
      },
      { tty: false },
    );
  });

  it('rejects display-name targeting for instance use', async () => {
    await withTemp(async (runtime, cap) => {
      expect(await main(['instance', 'use', 'company-docs'], { runtime })).toBe(ExitCode.Usage);
      expect(cap.stderr).toMatch(/opaque instance ID/i);
    });
  });

  it('records provisioning and resume hint when a mid-deploy step fails', async () => {
    await withTemp(async (runtime, cap) => {
      const { client } = createFakeCloudflare({ failStep: 'worker' });
      const code = await main(['deploy', '--new'], {
        runtime,
        terminal: promptTerminal(['broken', '1']),
        deploy: {
          cloudflare: client,
          openD1: stableOpenD1(),
          randomBytes: (n) => new Uint8Array(n).fill(1),
        },
      });
      expect(code).not.toBe(ExitCode.Success);
      expect(cap.stdout).toMatch(/Resume with:/);
      expect(cap.stdout).toMatch(/nrdocs deploy --instance inst_/);
      const idMatch = /nrdocs deploy --instance (inst_[A-Z0-9]+)/.exec(cap.stdout);
      expect(idMatch?.[1]).toBeTruthy();
      const desc = JSON.parse(
        await fs.readFile(
          path.join(runtime.homeDir, '.nrdocs', 'instances', `${idMatch![1]}.json`),
          'utf8',
        ),
      ) as InstanceDescriptor;
      expect(desc.database_id).toBeTruthy();
      expect(desc.reconciliation?.completed_steps).toEqual(
        expect.arrayContaining(['preflight', 'd1', 'r2', 'migrations']),
      );
      expect(desc.reconciliation?.completed_steps).not.toContain('worker');
    });
  });

  it('lets the operator pick a Cloudflare zone then enter a hostname under it', async () => {
    await withTemp(async (runtime, cap) => {
      const { client, state } = createFakeCloudflare({
        zones: [{ id: 'zone1', name: 'example.com', status: 'active' }],
      });
      const code = await main(['deploy', '--new'], {
        runtime,
        terminal: promptTerminal(['docs-prod', '2', '1', 'docs.example.com', 'y']),
        deploy: {
          cloudflare: client,
          openD1: stableOpenD1(),
          randomBytes: (n) => new Uint8Array(n).map((_, i) => (i + 5) & 0xff),
        },
      });
      expect(code).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('docs.example.com');
      expect(cap.stdout).toContain('https://docs.example.com/<slug>/');
      expect(state.deployedWorkers[0]!.customDomain).toBe('docs.example.com');
      expect(state.deployedWorkers[0]!.workersDev).toBe(false);

      const active = await readActiveInstanceId(runtime);
      const desc = JSON.parse(
        await fs.readFile(
          path.join(runtime.homeDir, '.nrdocs', 'instances', `${active}.json`),
          'utf8',
        ),
      ) as InstanceDescriptor;
      expect(desc.custom_hostname).toBe('docs.example.com');
      expect(desc.canonical_origin).toBe('https://docs.example.com');
    });
  });

  it('expands a single DNS label to a subdomain of the selected zone', async () => {
    await withTemp(async (runtime, cap) => {
      const { client, state } = createFakeCloudflare({
        zones: [{ id: 'zone1', name: 'quinovi.com', status: 'active' }],
      });
      const code = await main(['deploy', '--new'], {
        runtime,
        terminal: promptTerminal(['nrdocs-v2', '2', '1', 'nrdocs-v2', 'y']),
        deploy: {
          cloudflare: client,
          openD1: stableOpenD1(),
          randomBytes: (n) => new Uint8Array(n).map((_, i) => (i + 7) & 0xff),
        },
      });
      expect(code).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('https://nrdocs-v2.quinovi.com');
      expect(state.deployedWorkers[0]!.customDomain).toBe('nrdocs-v2.quinovi.com');
    });
  });

  it('explains invalid custom hostnames instead of a bare rejection', async () => {
    await withTemp(async (runtime, cap) => {
      const { client } = createFakeCloudflare({
        zones: [{ id: 'zone1', name: 'quinovi.com', status: 'active' }],
      });
      const code = await main(['deploy', '--new'], {
        runtime,
        terminal: promptTerminal(['x', '2', '1', 'not a host!!!']),
        deploy: { cloudflare: client, openD1: stableOpenD1() },
      });
      expect(code).not.toBe(ExitCode.Success);
      expect(cap.stderr).toMatch(/Invalid hostname|Expected a full DNS name/i);
      expect(cap.stderr).toContain('quinovi.com');
    });
  });
});

describe('resolveHostnameUnderZone', () => {
  it('accepts full hostnames and expands single labels', async () => {
    const { resolveHostnameUnderZone } = await import('./deploy.js');
    expect(resolveHostnameUnderZone('docs.quinovi.com', 'quinovi.com')).toBe('docs.quinovi.com');
    expect(resolveHostnameUnderZone('nrdocs-v2', 'quinovi.com')).toBe('nrdocs-v2.quinovi.com');
    expect(resolveHostnameUnderZone('Quinovi.com', 'quinovi.com')).toBe('quinovi.com');
    expect(resolveHostnameUnderZone('https://docs.quinovi.com/path', 'quinovi.com')).toBe(
      'docs.quinovi.com',
    );
  });

  it('rejects hostnames outside the zone with an actionable message', async () => {
    const { resolveHostnameUnderZone } = await import('./deploy.js');
    expect(() => resolveHostnameUnderZone('docs.other.com', 'quinovi.com')).toThrow(
      /must be quinovi\.com or a subdomain/i,
    );
  });
});

describe('findZoneForHostname', () => {
  it('prefers the longest matching active zone', async () => {
    const { findZoneForHostname } = await import('./deploy.js');
    const zone = findZoneForHostname(
      [
        { id: '1', name: 'example.com', status: 'active' },
        { id: '2', name: 'docs.example.com', status: 'active' },
        { id: '3', name: 'other.com', status: 'active' },
      ],
      'api.docs.example.com',
    );
    expect(zone?.name).toBe('docs.example.com');
  });
});
describe('createR2ArtifactStoreFromControlPlane', () => {
  it('lists and deletes objects through the fake control plane', async () => {
    const { client, state } = createFakeCloudflare({ r2: ['bucket-a'] });
    const store = createR2ArtifactStoreFromControlPlane(client, 'acct', 'bucket-a');
    const enc = new TextEncoder();
    await store.put({ key: 'sites/s1/a.txt', body: enc.encode('a') });
    await store.put({ key: 'sites/s1/b.txt', body: enc.encode('b') });
    await store.put({ key: 'sites/s2/c.txt', body: enc.encode('c') });

    const listed = await store.list('sites/s1/');
    expect(listed.keys.sort()).toEqual(['sites/s1/a.txt', 'sites/s1/b.txt']);
    expect(listed.cursor).toBeUndefined();

    await store.delete('sites/s1/a.txt');
    expect(state.objects.has('bucket-a/sites/s1/a.txt')).toBe(false);
    expect((await store.list('sites/s1/')).keys).toEqual(['sites/s1/b.txt']);

    const page = await store.list('sites/', { limit: 1 });
    expect(page.keys).toHaveLength(1);
    expect(page.cursor).toBeTruthy();
  });
});

describe('fake cloudflare cleanup APIs', () => {
  it('deletes workers, d1, buckets, and objects', async () => {
    const { client, state } = createFakeCloudflare({
      r2: ['b1'],
      d1: [{ uuid: 'd1-1', name: 'n' }],
      workers: new Set(['w1']),
    });
    await client.putR2Object('a', 'b1', 'k/x', new Uint8Array([1]));
    await client.deleteR2Object('a', 'b1', 'k/x');
    expect(state.objects.size).toBe(0);
    await client.deleteR2Bucket('a', 'b1');
    expect(state.r2).toEqual([]);
    await client.deleteD1('a', 'd1-1');
    expect(state.d1).toEqual([]);
    await client.deleteWorker('a', 'w1');
    expect(state.workers.size).toBe(0);
  });
});
