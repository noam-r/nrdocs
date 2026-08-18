import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyMigrations, insertInstanceMetadata } from '@nrdocs/persistence';
import { openMemorySqlite } from '@nrdocs/persistence/sqlite';
import type { InstanceDescriptor, InstanceId } from '@nrdocs/contracts';
import { ExitCode, createProcessRuntime, main, type Runtime } from '../index.js';
import {
  listInstanceDescriptors,
  readActiveInstanceId,
  writeActiveInstanceId,
  writeInstanceDescriptor,
} from '../instance-store.js';
import { createRejectingTerminal, type Terminal } from '../terminal.js';
import { createFakeCloudflare, encodeMarker } from '../deploy/fake-cloudflare.js';

const INST = 'inst_01ARZ3NDEKTSV4RRFFQ69G5FAV' as InstanceId;
const OTHER = 'inst_01ARZ3NDEKTSV4RRFFQ69G5FB0' as InstanceId;

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

function scriptedTerminal(phrases: boolean[]): Terminal {
  const queue = [...phrases];
  const base = createRejectingTerminal();
  return {
    ...base,
    async confirmPhrase() {
      const v = queue.shift();
      if (v === undefined) throw new Error('unexpected confirmPhrase');
      return v;
    },
  };
}

function baseDescriptor(overrides: Partial<InstanceDescriptor> = {}): InstanceDescriptor {
  return {
    instance_id: INST,
    display_name: 'manual-test',
    canonical_origin: 'https://nrdocs-test.example.workers.dev',
    custom_hostname: null,
    account_id: 'acct12345678xxxx',
    resource_suffix: '3f6m8p0q2r4s6t8v0w2x',
    database_id: 'd1-manual',
    bucket_name: 'bucket-manual',
    worker_name: 'worker-manual',
    status: 'active',
    deployed_version: '2.0.0',
    reconciliation: null,
    ...overrides,
  };
}

async function withTemp(
  fn: (runtime: Runtime, cap: ReturnType<typeof captureIo>) => Promise<void>,
): Promise<void> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-idel-'));
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-idel-cwd-'));
  const cap = captureIo();
  const runtime = createProcessRuntime({
    homeDir: home,
    cwd,
    platform: 'linux',
    stdoutIsTTY: true,
    stderrIsTTY: true,
    stdinIsTTY: true,
    env: { HOME: home },
    io: cap.io,
  });
  try {
    await fn(runtime, cap);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

describe('nrdocs instance delete', () => {
  it('cancels when confirmation phrase is declined', async () => {
    await withTemp(async (runtime, cap) => {
      const desc = baseDescriptor();
      await writeInstanceDescriptor(runtime, desc);
      await writeActiveInstanceId(runtime, INST);
      const { client, state } = createFakeCloudflare({
        r2: [desc.bucket_name],
        d1: [{ uuid: desc.database_id, name: 'n' }],
        workers: new Set([desc.worker_name]),
      });

      const code = await main(['instance', 'delete', INST], {
        runtime,
        terminal: scriptedTerminal([false]),
        instanceDelete: { cloudflare: client },
      });
      expect(code).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('Cancelled.');
      expect(state.workers.has(desc.worker_name)).toBe(true);
      expect(await readActiveInstanceId(runtime)).toBe(INST);
    });
  });

  it('deletes worker, R2, D1, and local descriptor after ownership checks', async () => {
    await withTemp(async (runtime, cap) => {
      const desc = baseDescriptor();
      await writeInstanceDescriptor(runtime, desc);
      await writeActiveInstanceId(runtime, INST);

      const mem = openMemorySqlite();
      await applyMigrations(mem.executor);
      await insertInstanceMetadata(mem.executor, {
        id: INST,
        display_name: desc.display_name,
        account_id: desc.account_id,
        resource_suffix: desc.resource_suffix,
        canonical_origin: desc.canonical_origin,
        deployed_version: '2.0.0',
      });

      const { client, state } = createFakeCloudflare({
        r2: [desc.bucket_name],
        d1: [{ uuid: desc.database_id, name: 'n' }],
        workers: new Set([desc.worker_name]),
      });
      await client.putR2Object(
        desc.account_id,
        desc.bucket_name,
        '_nrdocs/instance.json',
        encodeMarker({
          schema_version: 1,
          instance_id: INST,
          account_id: desc.account_id,
          resource_suffix: desc.resource_suffix,
          package_version: '2.0.0',
        }),
      );
      await client.putR2Object(
        desc.account_id,
        desc.bucket_name,
        'sites/x/a.txt',
        new Uint8Array([1]),
      );

      const code = await main(['instance', 'delete', INST], {
        runtime,
        terminal: scriptedTerminal([true]),
        instanceDelete: {
          cloudflare: client,
          openDb: async () => mem.executor,
        },
      });
      expect(code).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('Instance deleted.');
      expect(cap.stdout).toContain('Cleared active-instance pointer');
      expect(state.workers.has(desc.worker_name)).toBe(false);
      expect(state.r2).not.toContain(desc.bucket_name);
      expect(state.d1.find((d) => d.uuid === desc.database_id)).toBeUndefined();
      expect(await listInstanceDescriptors(runtime)).toEqual([]);
      expect(await readActiveInstanceId(runtime)).toBeNull();
    });
  });

  it('refuses when R2 ownership marker mismatches', async () => {
    await withTemp(async (runtime, cap) => {
      const desc = baseDescriptor();
      await writeInstanceDescriptor(runtime, desc);
      const { client, state } = createFakeCloudflare({
        r2: [desc.bucket_name],
        d1: [{ uuid: desc.database_id, name: 'n' }],
        workers: new Set([desc.worker_name]),
      });
      await client.putR2Object(
        desc.account_id,
        desc.bucket_name,
        '_nrdocs/instance.json',
        encodeMarker({
          schema_version: 1,
          instance_id: OTHER,
          account_id: desc.account_id,
          resource_suffix: desc.resource_suffix,
          package_version: '2.0.0',
        }),
      );

      const code = await main(['instance', 'delete', INST], {
        runtime,
        terminal: scriptedTerminal([true]),
        instanceDelete: { cloudflare: client },
      });
      expect(code).toBe(ExitCode.CredentialOrAuthority);
      expect(cap.stderr).toMatch(/mismatch|Refusing/i);
      expect(state.workers.has(desc.worker_name)).toBe(true);
      expect(await listInstanceDescriptors(runtime)).toHaveLength(1);
    });
  });

  it('skips missing worker and still removes R2, D1, and local state', async () => {
    await withTemp(async (runtime, cap) => {
      const desc = baseDescriptor({ worker_name: 'already-gone' });
      await writeInstanceDescriptor(runtime, desc);

      const mem = openMemorySqlite();
      await applyMigrations(mem.executor);
      await insertInstanceMetadata(mem.executor, {
        id: INST,
        display_name: desc.display_name,
        account_id: desc.account_id,
        resource_suffix: desc.resource_suffix,
        canonical_origin: desc.canonical_origin,
        deployed_version: '2.0.0',
      });

      const { client, state } = createFakeCloudflare({
        r2: [desc.bucket_name],
        d1: [{ uuid: desc.database_id, name: 'n' }],
        workers: new Set(),
      });
      await client.putR2Object(
        desc.account_id,
        desc.bucket_name,
        '_nrdocs/instance.json',
        encodeMarker({
          schema_version: 1,
          instance_id: INST,
          account_id: desc.account_id,
          resource_suffix: desc.resource_suffix,
          package_version: '2.0.0',
        }),
      );

      const code = await main(['instance', 'delete', INST], {
        runtime,
        terminal: scriptedTerminal([true]),
        instanceDelete: {
          cloudflare: client,
          openDb: async () => mem.executor,
        },
      });
      expect(code).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('Instance deleted.');
      expect(state.r2).not.toContain(desc.bucket_name);
      expect(state.d1).toEqual([]);
      expect(await listInstanceDescriptors(runtime)).toEqual([]);
    });
  });

  it('does not clear active pointer when deleting a non-active instance', async () => {
    await withTemp(async (runtime) => {
      const victim = baseDescriptor();
      const keeper = baseDescriptor({
        instance_id: OTHER,
        display_name: 'keeper',
        worker_name: 'worker-keeper',
        database_id: 'd1-keeper',
        bucket_name: 'bucket-keeper',
      });
      await writeInstanceDescriptor(runtime, victim);
      await writeInstanceDescriptor(runtime, keeper);
      await writeActiveInstanceId(runtime, OTHER);

      const mem = openMemorySqlite();
      await applyMigrations(mem.executor);
      await insertInstanceMetadata(mem.executor, {
        id: INST,
        display_name: victim.display_name,
        account_id: victim.account_id,
        resource_suffix: victim.resource_suffix,
        canonical_origin: victim.canonical_origin,
        deployed_version: '2.0.0',
      });

      const { client } = createFakeCloudflare({
        r2: [victim.bucket_name, keeper.bucket_name],
        d1: [
          { uuid: victim.database_id, name: 'v' },
          { uuid: keeper.database_id, name: 'k' },
        ],
        workers: new Set([victim.worker_name, keeper.worker_name]),
      });
      await client.putR2Object(
        victim.account_id,
        victim.bucket_name,
        '_nrdocs/instance.json',
        encodeMarker({
          schema_version: 1,
          instance_id: INST,
          account_id: victim.account_id,
          resource_suffix: victim.resource_suffix,
          package_version: '2.0.0',
        }),
      );

      expect(
        await main(['instance', 'delete', INST], {
          runtime,
          terminal: scriptedTerminal([true]),
          instanceDelete: {
            cloudflare: client,
            openDb: async () => mem.executor,
          },
        }),
      ).toBe(ExitCode.Success);
      expect(await readActiveInstanceId(runtime)).toBe(OTHER);
      expect((await listInstanceDescriptors(runtime)).map((d) => d.instance_id)).toEqual([OTHER]);
    });
  });
});
