import type { InstanceId } from '@nrdocs/contracts';
import {
  classifyCfError,
  parseAccountsResult,
  parseCfEnvelope,
  parseD1CreateResult,
  parseD1ListResult,
  parseR2ListResult,
  parseZonesResult,
  type CfAccount,
  type CfD1Database,
  type CfZone,
} from './parsers.js';

export type R2InstanceMarker = {
  schema_version: 1;
  instance_id: string;
  account_id: string;
  resource_suffix: string;
  package_version: string;
};

export type CloudflareHttp = {
  request(
    method: string,
    path: string,
    options?: { body?: unknown; query?: Record<string, string> },
  ): Promise<{ status: number; json: unknown }>;
};

export type DeployWorkerInput = {
  accountId: string;
  workerName: string;
  databaseId: string;
  bucketName: string;
  instanceId: InstanceId;
  packageVersion: string;
  script: string;
  platformCss: string;
  platformJs: string;
  /** Existing session secret preservation — omit to create. */
  createSessionKey: boolean;
  sessionKeyBytes?: Uint8Array;
  workersDev: boolean;
  customDomain: string | null;
};

export type CloudflareControlPlane = {
  listAccounts(): Promise<CfAccount[]>;
  preflight(
    accountId: string,
    needsZone: boolean,
  ): Promise<{ ok: true } | { ok: false; missing: string }>;
  listD1(accountId: string): Promise<CfD1Database[]>;
  createD1(accountId: string, name: string): Promise<CfD1Database>;
  d1Batch(
    accountId: string,
    databaseId: string,
    statements: ReadonlyArray<{ sql: string; params: readonly (string | number | null)[] }>,
  ): Promise<void>;
  d1Query(
    accountId: string,
    databaseId: string,
    sql: string,
    params?: readonly (string | number | null)[],
  ): Promise<unknown[]>;
  listR2(accountId: string): Promise<Array<{ name: string }>>;
  createR2(accountId: string, name: string): Promise<void>;
  putR2Object(accountId: string, bucket: string, key: string, body: Uint8Array): Promise<void>;
  getR2Object(accountId: string, bucket: string, key: string): Promise<Uint8Array | null>;
  listZones(accountId: string, name: string): Promise<CfZone[]>;
  deployWorker(input: DeployWorkerInput): Promise<{ workersDevUrl: string | null }>;
  smokeGet(url: string): Promise<{ status: number; body: string }>;
};

export class CloudflareApiError extends Error {
  readonly kind: string;
  readonly status: number;

  constructor(kind: string, status: number, message: string) {
    super(message);
    this.name = 'CloudflareApiError';
    this.kind = kind;
    this.status = status;
  }
}

export function createHttpCloudflareControlPlane(
  http: CloudflareHttp,
  deployWorkerImpl: (input: DeployWorkerInput) => Promise<{ workersDevUrl: string | null }>,
  smokeGetImpl: (url: string) => Promise<{ status: number; body: string }>,
): CloudflareControlPlane {
  async function api<T>(
    method: string,
    path: string,
    map: (result: unknown) => T,
    options?: { body?: unknown; query?: Record<string, string> },
  ): Promise<T> {
    const res = await http.request(method, path, options);
    let envelope;
    try {
      envelope = parseCfEnvelope(res.json, (r) => r);
    } catch {
      throw new CloudflareApiError('malformed', res.status, 'Malformed Cloudflare response.');
    }
    const kind = classifyCfError(res.status, envelope);
    if (kind !== 'ok' || !envelope.success) {
      const msg = envelope.errors[0]?.message ?? `Cloudflare API error (${res.status})`;
      throw new CloudflareApiError(kind, res.status, msg);
    }
    try {
      return map(envelope.result);
    } catch {
      throw new CloudflareApiError('malformed', res.status, 'Malformed Cloudflare result payload.');
    }
  }

  return {
    listAccounts: () => api('GET', '/accounts', parseAccountsResult),
    async preflight(accountId, needsZone) {
      try {
        await api('GET', `/accounts/${accountId}`, (r) => r);
        await api('GET', `/accounts/${accountId}/workers/scripts`, (r) => r ?? []);
        await api('GET', `/accounts/${accountId}/d1/database`, parseD1ListResult);
        await api('GET', `/accounts/${accountId}/r2/buckets`, parseR2ListResult);
        // Capability probe: list empty prefix on a non-existent bucket name pattern is not ideal;
        // listing buckets already exercised R2 read. Write probe is deferred to create/put.
        if (needsZone) {
          await api('GET', `/zones`, parseZonesResult, {
            query: { 'account.id': accountId, per_page: '1' },
          });
        }
        return { ok: true };
      } catch (error) {
        if (error instanceof CloudflareApiError && error.kind === 'permission_denied') {
          return { ok: false, missing: error.message };
        }
        if (error instanceof CloudflareApiError && error.kind === 'rate_limited') {
          return { ok: false, missing: 'rate_limited' };
        }
        throw error;
      }
    },
    listD1: (accountId) => api('GET', `/accounts/${accountId}/d1/database`, parseD1ListResult),
    createD1: (accountId, name) =>
      api('POST', `/accounts/${accountId}/d1/database`, parseD1CreateResult, {
        body: { name },
      }),
    async d1Batch(accountId, databaseId, statements) {
      await api('POST', `/accounts/${accountId}/d1/database/${databaseId}/query`, () => null, {
        body: { batch: statements.map((s) => ({ sql: s.sql, params: [...s.params] })) },
      });
    },
    async d1Query(accountId, databaseId, sql, params = []) {
      return api(
        'POST',
        `/accounts/${accountId}/d1/database/${databaseId}/query`,
        (result) => {
          if (!Array.isArray(result)) return [];
          const first = result[0];
          if (typeof first === 'object' && first !== null && 'results' in first) {
            const results = (first as { results: unknown }).results;
            return Array.isArray(results) ? results : [];
          }
          return [];
        },
        { body: { sql, params: [...params] } },
      );
    },
    listR2: (accountId) => api('GET', `/accounts/${accountId}/r2/buckets`, parseR2ListResult),
    async createR2(accountId, name) {
      await api('POST', `/accounts/${accountId}/r2/buckets`, () => null, { body: { name } });
    },
    async putR2Object(accountId, bucket, key, body) {
      // Object API uses binary responses; http adapter must support raw put via special path.
      await http.request('PUT', `/accounts/${accountId}/r2/buckets/${bucket}/objects/${key}`, {
        body: { __raw: body },
      });
    },
    async getR2Object(accountId, bucket, key) {
      const res = await http.request(
        'GET',
        `/accounts/${accountId}/r2/buckets/${bucket}/objects/${key}`,
      );
      if (res.status === 404) return null;
      if (res.status >= 400) {
        throw new CloudflareApiError('api_error', res.status, 'R2 object get failed.');
      }
      if (typeof res.json === 'object' && res.json !== null && '__raw' in (res.json as object)) {
        return (res.json as { __raw: Uint8Array }).__raw;
      }
      if (typeof res.json === 'string') return new TextEncoder().encode(res.json);
      return new TextEncoder().encode(JSON.stringify(res.json));
    },
    listZones: (accountId, name) =>
      api('GET', `/zones`, parseZonesResult, {
        query: { name, 'account.id': accountId },
      }),
    deployWorker: deployWorkerImpl,
    smokeGet: smokeGetImpl,
  };
}
