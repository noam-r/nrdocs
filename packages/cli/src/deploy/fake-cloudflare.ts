import type { InstanceId } from '@nrdocs/contracts';
import type { CloudflareControlPlane, DeployWorkerInput, R2InstanceMarker } from './cloudflare.js';
import { CloudflareApiError } from './cloudflare.js';
import type { CfAccount, CfD1Database, CfZone } from './parsers.js';

export type FakeCloudflareState = {
  accounts: CfAccount[];
  d1: CfD1Database[];
  r2: string[];
  zones: CfZone[];
  objects: Map<string, Uint8Array>;
  workers: Set<string>;
  sessionKeys: Set<string>;
  failPreflight?: string;
  failStep?: 'd1' | 'r2' | 'worker' | 'smoke' | 'rate_limited' | 'permission' | 'malformed';
  workersDevHost?: string;
  smokeOk?: boolean;
  deployedWorkers: DeployWorkerInput[];
};

export function createFakeCloudflare(initial: Partial<FakeCloudflareState> = {}): {
  client: CloudflareControlPlane;
  state: FakeCloudflareState;
} {
  const state: FakeCloudflareState = {
    accounts: initial.accounts ?? [{ id: 'acct12345678xxxx', name: 'Primary' }],
    d1: initial.d1 ?? [],
    r2: initial.r2 ?? [],
    zones: initial.zones ?? [],
    objects: initial.objects ?? new Map(),
    workers: initial.workers ?? new Set(),
    sessionKeys: initial.sessionKeys ?? new Set(),
    workersDevHost: initial.workersDevHost ?? 'nrdocs-test.example.workers.dev',
    smokeOk: initial.smokeOk ?? true,
    deployedWorkers: [],
  };
  if (initial.failPreflight !== undefined) state.failPreflight = initial.failPreflight;
  if (initial.failStep !== undefined) state.failStep = initial.failStep;

  const client: CloudflareControlPlane = {
    async listAccounts() {
      if (state.failStep === 'malformed') throw new CloudflareApiError('malformed', 200, 'bad');
      return state.accounts;
    },
    async preflight() {
      if (state.failPreflight) return { ok: false, missing: state.failPreflight };
      if (state.failStep === 'permission') return { ok: false, missing: 'Workers Scripts Write' };
      if (state.failStep === 'rate_limited') return { ok: false, missing: 'rate_limited' };
      return { ok: true };
    },
    async listD1() {
      return state.d1;
    },
    async createD1(_accountId, name) {
      if (state.failStep === 'd1')
        throw new CloudflareApiError('api_error', 500, 'd1 create failed');
      const existing = state.d1.find((d) => d.name === name);
      if (existing) throw new CloudflareApiError('already_exists', 409, 'already exists');
      const row = { uuid: `d1-${name}`, name };
      state.d1.push(row);
      return row;
    },
    async deleteD1(_accountId, databaseId) {
      state.d1 = state.d1.filter((d) => d.uuid !== databaseId);
    },
    async d1Batch() {
      // no-op success for migrations in fake
    },
    async d1Query(_a, _d, sql) {
      if (/SELECT \* FROM instance_metadata/i.test(sql)) {
        return [];
      }
      return [];
    },
    async listR2() {
      return state.r2.map((name) => ({ name }));
    },
    async createR2(_accountId, name) {
      if (state.failStep === 'r2')
        throw new CloudflareApiError('api_error', 500, 'r2 create failed');
      if (state.r2.includes(name))
        throw new CloudflareApiError('already_exists', 409, 'already exists');
      state.r2.push(name);
    },
    async deleteR2Bucket(_accountId, bucket) {
      state.r2 = state.r2.filter((name) => name !== bucket);
      for (const key of [...state.objects.keys()]) {
        if (key.startsWith(`${bucket}/`)) state.objects.delete(key);
      }
    },
    async putR2Object(_a, bucket, key, body) {
      state.objects.set(`${bucket}/${key}`, body);
    },
    async getR2Object(_a, bucket, key) {
      return state.objects.get(`${bucket}/${key}`) ?? null;
    },
    async listR2Objects(_a, bucket, prefix, opts = {}) {
      const fullPrefix = `${bucket}/${prefix}`;
      const all = [...state.objects.keys()]
        .filter((k) => k.startsWith(fullPrefix))
        .map((k) => k.slice(bucket.length + 1))
        .sort();
      const limit = opts.limit ?? 1000;
      let start = 0;
      if (opts.cursor) {
        const idx = all.indexOf(opts.cursor);
        start = idx >= 0 ? idx + 1 : 0;
      }
      const slice = all.slice(start, start + limit);
      const next = start + limit < all.length ? slice[slice.length - 1] : undefined;
      return next !== undefined ? { keys: slice, cursor: next } : { keys: slice };
    },
    async deleteR2Object(_a, bucket, key) {
      state.objects.delete(`${bucket}/${key}`);
    },
    async listZones(_accountId, name) {
      return state.zones.filter((z) => z.name === name);
    },
    async deployWorker(input) {
      if (state.failStep === 'worker') {
        throw new CloudflareApiError('api_error', 500, 'worker deploy failed');
      }
      state.deployedWorkers.push(input);
      state.workers.add(input.workerName);
      if (input.createSessionKey) state.sessionKeys.add(input.workerName);
      return {
        workersDevUrl: input.workersDev ? `https://${state.workersDevHost}` : null,
      };
    },
    async deleteWorker(_accountId, workerName) {
      state.workers.delete(workerName);
      state.sessionKeys.delete(workerName);
    },
    async smokeGet(url) {
      if (state.failStep === 'smoke' || state.smokeOk === false) {
        return { status: 500, body: 'fail' };
      }
      if (url.includes('/_nrdocs/api/version')) {
        return {
          status: 200,
          body: JSON.stringify({ ok: true, data: { package_version: '2.0.0' } }),
        };
      }
      return { status: 200, body: 'nrdocs' };
    },
  };

  return { client, state };
}

export function encodeMarker(marker: R2InstanceMarker): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(marker)}\n`);
}

export type { InstanceId };
