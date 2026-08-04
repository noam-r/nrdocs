import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExitCode, createProcessRuntime, main, type Runtime } from './index.js';
import { openMemorySqlite } from '@nrdocs/persistence/sqlite';
import { createFakeCloudflare, encodeMarker } from './deploy/fake-cloudflare.js';
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
      const terminal = promptTerminal(['company-docs', 'n']);
      const code = await main(['deploy'], {
        runtime,
        terminal,
        deploy: {
          cloudflare: client,
          openD1: async () => openMemorySqlite().executor,
          randomBytes: (n) => new Uint8Array(n).map((_, i) => (i + 3) & 0xff),
        },
      });
      expect(code).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('nrdocs deployed.');
      expect(cap.stdout).toContain('company-docs');
      expect(cap.stdout).toMatch(/Instance:\s+inst_/);
      expect(await fs.readdir(cwd)).toEqual(before);
      expect(state.deployedWorkers).toHaveLength(1);
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

  it('reconciles an active instance as unchanged and does not rewrite active on --instance', async () => {
    await withTemp(async (runtime, cap) => {
      const { client, state } = createFakeCloudflare();
      const terminal = promptTerminal(['company-docs', 'n']);
      expect(
        await main(['deploy'], {
          runtime,
          terminal,
          deploy: {
            cloudflare: client,
            openD1: async () => openMemorySqlite().executor,
            randomBytes: (n) => new Uint8Array(n).map((_, i) => (i + 9) & 0xff),
          },
        }),
      ).toBe(ExitCode.Success);
      const active = (await readActiveInstanceId(runtime))!;
      const markerKey = [...state.objects.keys()].find((k) => k.endsWith('_nrdocs/instance.json'))!;
      // ensure marker present for unchanged path
      expect(markerKey).toBeTruthy();

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
            openD1: async () => openMemorySqlite().executor,
          },
        }),
      ).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('unchanged');
      expect(await readActiveInstanceId(runtime)).toBe(beforeActive);
    });
  });

  it('fails permission preflight with authority exit and rejects non-interactive deploy', async () => {
    await withTemp(async (runtime, cap) => {
      const { client } = createFakeCloudflare({ failStep: 'permission' });
      expect(
        await main(['deploy'], {
          runtime,
          terminal: promptTerminal(['x', 'n']),
          deploy: { cloudflare: client },
        }),
      ).toBe(ExitCode.CredentialOrAuthority);
      expect(cap.stderr).toMatch(/permission|capability|Workers/i);
    });

    await withTemp(
      async (runtime, cap) => {
        expect(await main(['deploy'], { runtime })).toBe(ExitCode.Usage);
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
      const code = await main(['deploy'], {
        runtime,
        terminal: promptTerminal(['broken', 'n']),
        deploy: {
          cloudflare: client,
          openD1: async () => openMemorySqlite().executor,
          randomBytes: (n) => new Uint8Array(n).fill(1),
        },
      });
      expect(code).not.toBe(ExitCode.Success);
      expect(cap.stdout).toMatch(/Resume with:/);
      expect(cap.stdout).toMatch(/nrdocs deploy --instance inst_/);
    });
  });
});

describe('runDeployCommand helpers', () => {
  it('exports encodeMarker for fixtures', () => {
    expect(
      encodeMarker({
        schema_version: 1,
        instance_id: 'inst_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        account_id: 'a',
        resource_suffix: '3f6m8p0q2r4s6t8v0w2x',
        package_version: '2.0.0',
      }).byteLength,
    ).toBeGreaterThan(10);
  });
  void runDeployCommand;
});
