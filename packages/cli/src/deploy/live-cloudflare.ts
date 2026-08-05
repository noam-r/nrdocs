/**
 * Live Cloudflare control-plane client for deploy and administration.
 * Uses the Cloudflare REST API with a bearer token. Never logs the token.
 */
import type { ArtifactObjectStore } from '@nrdocs/persistence';
import {
  CloudflareApiError,
  createHttpCloudflareControlPlane,
  type CloudflareControlPlane,
  type CloudflareHttp,
  type DeployWorkerInput,
} from './cloudflare.js';

const API = 'https://api.cloudflare.com/client/v4';

const RATE_LIMIT_SPECS = [
  { name: 'PASSWORD_IP_LIMIT', limit: 10, period: 60 },
  { name: 'PASSWORD_SITE_LIMIT', limit: 100, period: 60 },
  { name: 'INVALID_TOKEN_LIMIT', limit: 30, period: 60 },
  { name: 'TOKEN_RESOLVE_LIMIT', limit: 120, period: 60 },
  { name: 'TOKEN_PUBLISH_LIMIT', limit: 10, period: 60 },
  { name: 'INSTANCE_API_LIMIT', limit: 300, period: 60 },
] as const;

/** Derive a positive integer namespace_id unique per instance + binding name. */
export function rateLimitNamespaceId(instanceId: string, name: string): string {
  const input = `${instanceId}\0${name}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return String(((hash >>> 0) % 2147483646) + 1);
}

function rateLimitBindings(instanceId: string): Array<Record<string, unknown>> {
  return RATE_LIMIT_SPECS.map((spec) => ({
    type: 'ratelimit',
    name: spec.name,
    namespace_id: rateLimitNamespaceId(instanceId, spec.name),
    simple: { limit: spec.limit, period: spec.period },
  }));
}

export type LiveCloudflareOptions = {
  token: string;
  fetchImpl?: typeof fetch;
};

function toBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64url');
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function createCloudflareHttp(
  token: string,
  fetchImpl: typeof fetch = fetch,
): CloudflareHttp {
  return {
    async request(method, path, options = {}) {
      const url = new URL(`${API}${path}`);
      if (options.query) {
        for (const [k, v] of Object.entries(options.query)) url.searchParams.set(k, v);
      }
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`,
      };
      const init: RequestInit = { method, headers };
      if (options.body && typeof options.body === 'object' && options.body !== null) {
        const raw = options.body as { __raw?: Uint8Array };
        if (raw.__raw) {
          headers['content-type'] = 'application/octet-stream';
          init.body = Uint8Array.from(raw.__raw);
        } else {
          headers['content-type'] = 'application/json';
          init.body = JSON.stringify(options.body);
        }
      }
      const res = await fetchImpl(url, init);
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json') || contentType.includes('+json')) {
        return { status: res.status, json: await res.json() };
      }
      if (method === 'GET' && path.includes('/objects/')) {
        if (res.status === 404) return { status: 404, json: null };
        const buf = new Uint8Array(await res.arrayBuffer());
        return { status: res.status, json: { __raw: buf } };
      }
      const text = await res.text();
      try {
        return { status: res.status, json: JSON.parse(text) };
      } catch {
        return { status: res.status, json: text };
      }
    },
  };
}

async function deployWorkerScript(
  token: string,
  input: DeployWorkerInput,
  fetchImpl: typeof fetch,
): Promise<{ workersDevUrl: string | null }> {
  const metadata = {
    main_module: 'worker.mjs',
    compatibility_date: '2025-01-01',
    bindings: [
      { type: 'd1', name: 'DB', id: input.databaseId },
      { type: 'r2_bucket', name: 'ARTIFACTS', bucket_name: input.bucketName },
      { type: 'plain_text', name: 'NRDOCS_INSTANCE_ID', text: input.instanceId },
      { type: 'plain_text', name: 'NRDOCS_PACKAGE_VERSION', text: input.packageVersion },
      ...rateLimitBindings(input.instanceId),
    ],
  };

  const form = new FormData();
  form.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.set(
    'worker.mjs',
    new Blob([input.script], { type: 'application/javascript+module' }),
    'worker.mjs',
  );
  form.set('reader.css', new Blob([input.platformCss], { type: 'text/css' }), 'reader.css');
  form.set('reader.js', new Blob([input.platformJs], { type: 'text/javascript' }), 'reader.js');
  form.set(
    'mermaid.js',
    new Blob([input.platformMermaid], { type: 'text/javascript' }),
    'mermaid.js',
  );

  const res = await fetchImpl(
    `${API}/accounts/${input.accountId}/workers/scripts/${input.workerName}`,
    {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    },
  );
  const json = (await res.json()) as { success?: boolean; errors?: Array<{ message?: string }> };
  if (!res.ok || json.success === false) {
    const msg = json.errors?.[0]?.message ?? `Worker deploy failed (${res.status})`;
    throw new CloudflareApiError(
      res.status === 403 ? 'permission_denied' : 'api_error',
      res.status,
      msg,
    );
  }

  if (input.createSessionKey) {
    const keyBytes = input.sessionKeyBytes ?? globalThis.crypto.getRandomValues(new Uint8Array(32));
    const secretRes = await fetchImpl(
      `${API}/accounts/${input.accountId}/workers/scripts/${input.workerName}/secrets`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'NRDOCS_SESSION_KEY',
          text: toBase64Url(keyBytes),
          type: 'secret_text',
        }),
      },
    );
    if (!secretRes.ok) {
      throw new CloudflareApiError(
        'api_error',
        secretRes.status,
        'Failed to set NRDOCS_SESSION_KEY.',
      );
    }
  }

  if (input.workersDev) {
    await fetchImpl(
      `${API}/accounts/${input.accountId}/workers/scripts/${input.workerName}/subdomain`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ enabled: true }),
      },
    );
    return { workersDevUrl: `https://${input.workerName}.workers.dev` };
  }

  if (input.customDomain) {
    await fetchImpl(`${API}/accounts/${input.accountId}/workers/domains`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        hostname: input.customDomain,
        service: input.workerName,
        environment: 'production',
      }),
    });
  }

  return { workersDevUrl: null };
}

async function smokeGet(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ status: number; body: string }> {
  const res = await fetchImpl(url, { method: 'GET', redirect: 'manual' });
  return { status: res.status, body: await res.text() };
}

export function createLiveCloudflareControlPlane(
  options: LiveCloudflareOptions,
): CloudflareControlPlane {
  const fetchImpl = options.fetchImpl ?? fetch;
  const http = createCloudflareHttp(options.token, fetchImpl);
  return createHttpCloudflareControlPlane(
    http,
    (input) => deployWorkerScript(options.token, input, fetchImpl),
    (url) => smokeGet(url, fetchImpl),
  );
}

export function createR2ArtifactStoreFromControlPlane(
  cf: CloudflareControlPlane,
  accountId: string,
  bucketName: string,
): ArtifactObjectStore {
  return {
    async put(object) {
      await cf.putR2Object(accountId, bucketName, object.key, object.body);
    },
    async get(key) {
      return cf.getR2Object(accountId, bucketName, key);
    },
    async delete(key) {
      await cf.deleteR2Object(accountId, bucketName, key);
    },
    async list(prefix, options = {}) {
      // One page when the caller manages pagination; otherwise gather all pages.
      if (options.cursor !== undefined || options.limit !== undefined) {
        return cf.listR2Objects(accountId, bucketName, prefix, {
          ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
        });
      }
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await cf.listR2Objects(accountId, bucketName, prefix, {
          ...(cursor !== undefined ? { cursor } : {}),
          limit: 1000,
        });
        keys.push(...page.keys);
        cursor = page.cursor;
      } while (cursor);
      return { keys };
    },
  };
}
