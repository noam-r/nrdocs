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
  platformMermaid: string;
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
  deleteD1(accountId: string, databaseId: string): Promise<void>;
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
  deleteR2Bucket(accountId: string, bucket: string): Promise<void>;
  putR2Object(accountId: string, bucket: string, key: string, body: Uint8Array): Promise<void>;
  getR2Object(accountId: string, bucket: string, key: string): Promise<Uint8Array | null>;
  listR2Objects(
    accountId: string,
    bucket: string,
    prefix: string,
    opts?: { cursor?: string; limit?: number },
  ): Promise<{ keys: string[]; cursor?: string }>;
  deleteR2Object(accountId: string, bucket: string, key: string): Promise<void>;
  listZones(accountId: string, name: string): Promise<CfZone[]>;
  /** Account workers.dev label (the middle label in worker.account.workers.dev). */
  getWorkersDevSubdomain(accountId: string): Promise<string>;
  enableWorkersDev(accountId: string, workerName: string): Promise<void>;
  deployWorker(input: DeployWorkerInput): Promise<{ workersDevUrl: string | null }>;
  deleteWorker(accountId: string, workerName: string): Promise<void>;
  smokeGet(url: string): Promise<{ status: number; body: string }>;
};

/** Canonical workers.dev origin: https://<worker>.<account-subdomain>.workers.dev */
export function workersDevOrigin(workerName: string, accountSubdomain: string): string {
  return `https://${workerName}.${accountSubdomain}.workers.dev`;
}

export type OriginSmokeProbe = { status: number; body: string };

export type OriginSmokeResult = {
  version: OriginSmokeProbe;
  root: OriginSmokeProbe;
  attempts: Array<{ attempt: number; version: number; root: number }>;
};

/**
 * Poll version + root until both return 200.
 *
 * New workers.dev hostnames commonly return Cloudflare HTML 404 / error 1042 for
 * 30–90+ seconds after the subdomain API reports `enabled: true`. Callers should
 * budget minutes, not seconds.
 */
export async function waitForOriginSmoke(
  smokeGet: (url: string) => Promise<OriginSmokeProbe>,
  origin: string,
  opts: {
    attempts?: number;
    delayMs?: number;
    /** Invoked before sleeping when the origin is not ready yet. */
    onRetry?: (attempt: number) => Promise<void>;
  } = {},
): Promise<OriginSmokeResult> {
  const attemptsLimit = opts.attempts ?? 60;
  const delayMs = opts.delayMs ?? 3000;
  let version: OriginSmokeProbe = { status: 0, body: '' };
  let root: OriginSmokeProbe = { status: 0, body: '' };
  const attempts: OriginSmokeResult['attempts'] = [];

  for (let attempt = 0; attempt < attemptsLimit; attempt++) {
    version = await smokeGet(`${origin}/_nrdocs/api/version`);
    root = await smokeGet(`${origin}/`);
    attempts.push({ attempt, version: version.status, root: root.status });
    if (version.status === 200 && root.status === 200) {
      return { version, root, attempts };
    }
    // DNS / hard network failure — do not spin the full budget.
    if (version.status === 0 && root.status === 0) break;
    if (opts.onRetry) {
      try {
        await opts.onRetry(attempt);
      } catch {
        /* best-effort */
      }
    }
    if (attempt + 1 < attemptsLimit) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return { version, root, attempts };
}

/** Encode an R2 object key for use in a URL path (keys may contain `/`). */
export function encodeR2ObjectKeyPath(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Flexible parser for Cloudflare R2 object list payloads. */
export function parseR2ObjectsList(
  result: unknown,
  resultInfo?: unknown,
): { keys: string[]; cursor?: string } {
  const rows = Array.isArray(result)
    ? result
    : isObject(result) && Array.isArray(result.objects)
      ? result.objects
      : null;
  if (!rows) throw new Error('malformed R2 objects result');
  const keys: string[] = [];
  for (const row of rows) {
    if (!isObject(row)) continue;
    const key =
      typeof row.key === 'string' ? row.key : typeof row.name === 'string' ? row.name : null;
    if (key !== null) keys.push(key);
  }
  let cursor: string | undefined;
  if (isObject(resultInfo) && typeof resultInfo.cursor === 'string' && resultInfo.cursor) {
    cursor = resultInfo.cursor;
  } else if (isObject(result) && typeof result.cursor === 'string' && result.cursor) {
    cursor = result.cursor;
  }
  return cursor !== undefined ? { keys, cursor } : { keys };
}

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
    async deleteD1(accountId, databaseId) {
      await api('DELETE', `/accounts/${accountId}/d1/database/${databaseId}`, () => null);
    },
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
    async deleteR2Bucket(accountId, bucket) {
      await api('DELETE', `/accounts/${accountId}/r2/buckets/${bucket}`, () => null);
    },
    async putR2Object(accountId, bucket, key, body) {
      // Object API uses binary responses; http adapter must support raw put via special path.
      const encoded = encodeR2ObjectKeyPath(key);
      await http.request('PUT', `/accounts/${accountId}/r2/buckets/${bucket}/objects/${encoded}`, {
        body: { __raw: body },
      });
    },
    async getR2Object(accountId, bucket, key) {
      const encoded = encodeR2ObjectKeyPath(key);
      const res = await http.request(
        'GET',
        `/accounts/${accountId}/r2/buckets/${bucket}/objects/${encoded}`,
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
    async listR2Objects(accountId, bucket, prefix, opts = {}) {
      const query: Record<string, string> = { prefix };
      if (opts.cursor) query.cursor = opts.cursor;
      if (opts.limit !== undefined) query.per_page = String(opts.limit);
      const res = await http.request('GET', `/accounts/${accountId}/r2/buckets/${bucket}/objects`, {
        query,
      });
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
      const resultInfo =
        typeof res.json === 'object' && res.json !== null && 'result_info' in res.json
          ? (res.json as { result_info: unknown }).result_info
          : undefined;
      try {
        return parseR2ObjectsList(envelope.result, resultInfo);
      } catch {
        throw new CloudflareApiError(
          'malformed',
          res.status,
          'Malformed Cloudflare result payload.',
        );
      }
    },
    async deleteR2Object(accountId, bucket, key) {
      const encoded = encodeR2ObjectKeyPath(key);
      await api(
        'DELETE',
        `/accounts/${accountId}/r2/buckets/${bucket}/objects/${encoded}`,
        () => null,
      );
    },
    listZones: (accountId, name) =>
      api('GET', `/zones`, parseZonesResult, {
        query: { name, 'account.id': accountId },
      }),
    getWorkersDevSubdomain: (accountId) =>
      api('GET', `/accounts/${accountId}/workers/subdomain`, (result) => {
        if (!isObject(result) || typeof result.subdomain !== 'string' || !result.subdomain) {
          throw new Error('malformed workers.dev subdomain');
        }
        return result.subdomain;
      }),
    async enableWorkersDev(accountId, workerName) {
      await api(
        'POST',
        `/accounts/${accountId}/workers/scripts/${workerName}/subdomain`,
        () => null,
        {
          body: { enabled: true },
        },
      );
    },
    deployWorker: deployWorkerImpl,
    async deleteWorker(accountId, workerName) {
      await api('DELETE', `/accounts/${accountId}/workers/scripts/${workerName}`, () => null);
    },
    smokeGet: smokeGetImpl,
  };
}
