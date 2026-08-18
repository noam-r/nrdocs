/**
 * Live Cloudflare control-plane client for deploy and administration.
 * Uses the Cloudflare REST API with a bearer token. Never logs the token.
 */
import dns from 'node:dns';
import type { ArtifactObjectStore } from '@nrdocs/persistence';
import {
  CloudflareApiError,
  createHttpCloudflareControlPlane,
  type CloudflareControlPlane,
  type CloudflareHttp,
  type DeployWorkerInput,
} from './cloudflare.js';

// Prefer IPv4 for workers.dev probes — this host's IPv6 path is unreachable and
// Node's default order can add avoidable connect stalls during smoke waits.
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  /* older Node */
}

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

function rateLimitConfigs(instanceId: string): Array<Record<string, unknown>> {
  return RATE_LIMIT_SPECS.map((spec) => ({
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
  const bindings: Array<Record<string, unknown>> = [
    { type: 'd1', name: 'DB', id: input.databaseId },
    { type: 'r2_bucket', name: 'ARTIFACTS', bucket_name: input.bucketName },
    { type: 'plain_text', name: 'NRDOCS_INSTANCE_ID', text: input.instanceId },
    { type: 'plain_text', name: 'NRDOCS_PACKAGE_VERSION', text: input.packageVersion },
  ];

  // Include the session secret in the same script upload. A separate /secrets PUT
  // redeploys the Worker and races workers.dev routing (flaky HTML 404s).
  if (input.createSessionKey) {
    const keyBytes = input.sessionKeyBytes ?? globalThis.crypto.getRandomValues(new Uint8Array(32));
    bindings.push({
      type: 'secret_text',
      name: 'NRDOCS_SESSION_KEY',
      text: toBase64Url(keyBytes),
    });
  }

  const metadata: Record<string, unknown> = {
    main_module: 'worker.mjs',
    compatibility_date: '2025-01-01',
    bindings,
    // Same shape Wrangler uses (top-level ratelimits), not bindings[].type=ratelimit.
    ratelimits: rateLimitConfigs(input.instanceId),
  };
  if (!input.createSessionKey) {
    // Preserve an existing session secret across upgrades.
    metadata.keep_bindings = ['secret_text'];
  }

  const form = new FormData();
  form.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.set(
    'worker.mjs',
    new Blob([input.script], { type: 'application/javascript+module' }),
    'worker.mjs',
  );
  // Platform CSS/JS/Mermaid are embedded inside worker.mjs by the release bundle.
  // Do not upload them as Worker modules — Cloudflare rejects non-JS module types
  // (e.g. text/css) on the scripts multipart API.

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
    ).then(async (subRes) => {
      if (!subRes.ok) {
        const text = await subRes.text().catch(() => '');
        throw new CloudflareApiError(
          'api_error',
          subRes.status,
          `Failed to enable workers.dev subdomain (${subRes.status}): ${text.slice(0, 200)}`,
        );
      }
    });

    // Confirm the script reports enabled before we hand the URL to smoke tests.
    for (let i = 0; i < 10; i++) {
      const check = await fetchImpl(
        `${API}/accounts/${input.accountId}/workers/scripts/${input.workerName}/subdomain`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      const checkJson = (await check.json()) as {
        success?: boolean;
        result?: { enabled?: boolean };
      };
      if (check.ok && checkJson.success && checkJson.result?.enabled === true) break;
      await new Promise((r) => setTimeout(r, 1000));
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
    }

    // workers.dev host is <worker>.<account-subdomain>.workers.dev — not <worker>.workers.dev.
    const accountSubRes = await fetchImpl(`${API}/accounts/${input.accountId}/workers/subdomain`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const accountSubJson = (await accountSubRes.json()) as {
      success?: boolean;
      result?: { subdomain?: string };
    };
    const accountSubdomain = accountSubJson.result?.subdomain?.trim();
    if (!accountSubRes.ok || accountSubJson.success === false || !accountSubdomain) {
      throw new CloudflareApiError(
        'api_error',
        accountSubRes.status,
        'Failed to resolve account workers.dev subdomain.',
      );
    }
    return {
      workersDevUrl: `https://${input.workerName}.${accountSubdomain}.workers.dev`,
    };
  }

  if (input.customDomain) {
    if (!input.customDomainZoneId || !input.customDomainZoneName) {
      throw new CloudflareApiError(
        'api_error',
        400,
        `Custom domain ${input.customDomain} is missing zone metadata; cannot attach.`,
      );
    }
    const domainRes = await fetchImpl(`${API}/accounts/${input.accountId}/workers/domains`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        hostname: input.customDomain,
        service: input.workerName,
        environment: 'production',
        zone_id: input.customDomainZoneId,
        zone_name: input.customDomainZoneName,
      }),
    });
    const domainJson = (await domainRes.json().catch(() => null)) as {
      success?: boolean;
      errors?: Array<{ message?: string }>;
    } | null;
    if (!domainRes.ok || domainJson?.success === false) {
      const msg =
        domainJson?.errors?.[0]?.message ??
        `Failed to attach custom domain ${input.customDomain} (${domainRes.status})`;
      throw new CloudflareApiError(
        domainRes.status === 403 ? 'permission_denied' : 'api_error',
        domainRes.status,
        msg,
      );
    }
  }

  return { workersDevUrl: null };
}

async function resolveIpv4ViaPublicDns(hostname: string): Promise<string | null> {
  const resolver = new dns.Resolver();
  resolver.setServers(['1.1.1.1', '8.8.8.8']);
  try {
    const addrs = await new Promise<string[]>((resolve, reject) => {
      resolver.resolve4(hostname, (err, addresses) => {
        if (err) reject(err);
        else resolve(addresses);
      });
    });
    return addrs[0] ?? null;
  } catch {
    return null;
  }
}

async function httpsGetToIp(url: URL, address: string): Promise<{ status: number; body: string }> {
  const https = await import('node:https');
  return new Promise((resolve) => {
    const req = https.request(
      {
        protocol: 'https:',
        host: address,
        servername: url.hostname,
        method: 'GET',
        path: `${url.pathname}${url.search}`,
        headers: { host: url.hostname, accept: '*/*' },
        timeout: 15_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, body: '' });
    });
    req.end();
  });
}

async function smokeGet(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ status: number; body: string }> {
  try {
    const res = await fetchImpl(url, { method: 'GET', redirect: 'manual' });
    return { status: res.status, body: await res.text() };
  } catch {
    // Local resolvers (e.g. systemd-resolved) sometimes NXDOMAIN while public
    // DNS already serves the Worker custom domain. Retry via 1.1.1.1 / 8.8.8.8.
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return { status: 0, body: '' };
      const address = await resolveIpv4ViaPublicDns(parsed.hostname);
      if (!address) return { status: 0, body: '' };
      return await httpsGetToIp(parsed, address);
    } catch {
      return { status: 0, body: '' };
    }
  }
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
