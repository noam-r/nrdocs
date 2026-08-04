/**
 * Cloudflare Worker for publish and serve.
 * Phase 9: publisher API. Phase 11: reader serving and password access.
 */
import { CONTRACTS_PACKAGE, parseSlug, PublisherApiErrorCode } from '@nrdocs/contracts';
import {
  getSiteBySlug,
  MemoryArtifactStore,
  PERSISTENCE_PACKAGE,
  type ArtifactObjectStore,
} from '@nrdocs/persistence';
import { createD1Executor, type D1DatabaseLike } from './persistence-adapter.js';
import { ApiError, errorResponse, requestIdFromHeaders, versionResponse } from './http.js';
import { handlePublish, handlePublishTarget } from './publish.js';
import { MemoryRateLimiter, type RateLimiter } from './rate-limit.js';
import { r2AsArtifactStore, type R2BucketLike } from './r2-adapter.js';
import { base64UrlToBytes } from './reader/crypto.js';
import { servePlatformAsset } from './reader/platform-assets.js';
import {
  handleAccessGet,
  handleAccessPost,
  handleLogoutPost,
  handleSiteContent,
  type ReaderContext,
} from './reader/serve.js';
import {
  headOf,
  htmlResponse,
  instanceRootPage,
  notFoundPage,
  unavailablePage,
} from './reader/platform-pages.js';

export const WORKER_PACKAGE = '@nrdocs/worker' as const;

export type WorkerEnv = {
  DB: D1DatabaseLike;
  ARTIFACTS: R2BucketLike | ArtifactObjectStore;
  NRDOCS_INSTANCE_ID: string;
  NRDOCS_PACKAGE_VERSION: string;
  /** Base64url-encoded 32-byte HMAC key for reader sessions and CSRF. */
  NRDOCS_SESSION_KEY?: string;
  /** Test injectables */
  __artifactStore?: ArtifactObjectStore;
  __rateLimiter?: RateLimiter;
  __now?: () => Date;
  __clientIp?: string;
  __sessionKey?: Uint8Array;
};

export function workerDependencies(): { contracts: string; persistence: string } {
  return {
    contracts: CONTRACTS_PACKAGE,
    persistence: PERSISTENCE_PACKAGE,
  };
}

/** Bind the Worker D1 database to the shared persistence executor. */
export function workerPersistence(db: D1DatabaseLike) {
  return createD1Executor(db);
}

export { createD1Executor } from './persistence-adapter.js';
export type { D1DatabaseLike, SqlExecutor } from './persistence-adapter.js';
export { validateStoredPage } from './validate-page.js';
export { expandArtifactArchive } from './archive.js';
export { MemoryRateLimiter } from './rate-limit.js';

function resolveStore(env: WorkerEnv): ArtifactObjectStore {
  if (env.__artifactStore) return env.__artifactStore;
  const artifacts = env.ARTIFACTS;
  if (artifacts && typeof artifacts === 'object' && 'put' in artifacts && 'list' in artifacts) {
    if ('objects' in artifacts) return artifacts as ArtifactObjectStore;
    return r2AsArtifactStore(artifacts as R2BucketLike);
  }
  return new MemoryArtifactStore();
}

function clientIp(request: Request, env: WorkerEnv): string {
  if (env.__clientIp) return env.__clientIp;
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '0.0.0.0'
  );
}

export function resolveSessionKey(env: WorkerEnv): Uint8Array | null {
  if (env.__sessionKey) {
    return env.__sessionKey.byteLength === 32 ? env.__sessionKey : null;
  }
  const raw = env.NRDOCS_SESSION_KEY;
  if (!raw) return null;
  const bytes = base64UrlToBytes(raw);
  if (!bytes || bytes.byteLength !== 32) return null;
  return bytes;
}

function buildReaderContext(
  request: Request,
  env: WorkerEnv,
  sessionKey: Uint8Array,
): ReaderContext {
  return {
    db: createD1Executor(env.DB),
    store: resolveStore(env),
    sessionKey,
    rateLimiter: env.__rateLimiter ?? new MemoryRateLimiter(),
    clientIp: clientIp(request, env),
    requestId: requestIdFromHeaders(request.headers),
    now: env.__now ?? (() => new Date()),
    hsts: new URL(request.url).protocol === 'https:',
  };
}

export async function handleRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const requestId = requestIdFromHeaders(request.headers);
  const hsts = url.protocol === 'https:';
  const method = request.method;

  try {
    if (url.pathname === '/_nrdocs/api/version') {
      if (method !== 'GET' && method !== 'HEAD') {
        throw new ApiError(PublisherApiErrorCode.InvalidRequest, 'Method not allowed.');
      }
      return versionResponse(env.NRDOCS_PACKAGE_VERSION);
    }

    if (method === 'GET' || method === 'HEAD') {
      const asset = await servePlatformAsset(url.pathname, request, { hsts });
      if (asset) return asset;
    }

    if (url.pathname === '/_nrdocs/access') {
      const key = resolveSessionKey(env);
      if (!key) return htmlResponse(unavailablePage(requestId), 503, { hsts });
      const ctx = buildReaderContext(request, env, key);
      if (method === 'GET' || method === 'HEAD') {
        const res = await handleAccessGet(request, ctx);
        return method === 'HEAD' ? headOf(res) : res;
      }
      if (method === 'POST') return handleAccessPost(request, ctx);
      return htmlResponse(notFoundPage(), 405, { hsts });
    }

    if (url.pathname === '/_nrdocs/logout') {
      const key = resolveSessionKey(env);
      if (!key) return htmlResponse(unavailablePage(requestId), 503, { hsts });
      const ctx = buildReaderContext(request, env, key);
      if (method === 'POST') return handleLogoutPost(request, ctx);
      return htmlResponse(notFoundPage(), 405, { hsts });
    }

    if (url.pathname === '/' || url.pathname === '') {
      if (method !== 'GET' && method !== 'HEAD') {
        return htmlResponse(notFoundPage(), 405, { hsts });
      }
      const res = htmlResponse(instanceRootPage(), 200, { hsts });
      return method === 'HEAD' ? headOf(res) : res;
    }

    const db = createD1Executor(env.DB);
    const rateLimiter = env.__rateLimiter ?? new MemoryRateLimiter();
    const store = resolveStore(env);
    const ip = clientIp(request, env);

    if (url.pathname === '/_nrdocs/api/v1/publish-target') {
      if (method !== 'GET') {
        throw new ApiError(PublisherApiErrorCode.InvalidRequest, 'Method not allowed.');
      }
      return await handlePublishTarget(request, { db, requestId, rateLimiter, clientIp: ip });
    }

    if (url.pathname === '/_nrdocs/api/v1/publish') {
      if (method !== 'POST') {
        throw new ApiError(PublisherApiErrorCode.InvalidRequest, 'Method not allowed.');
      }
      return await handlePublish(request, {
        db,
        store,
        requestId,
        rateLimiter,
        clientIp: ip,
        ...(env.__now ? { now: env.__now } : {}),
      });
    }

    if (url.pathname.startsWith('/_nrdocs/')) {
      return htmlResponse(notFoundPage(), 404, { hsts });
    }

    const segments = url.pathname.split('/').filter((s) => s.length > 0);
    const slugCandidate = segments[0];
    const slug = slugCandidate ? parseSlug(slugCandidate) : null;

    if (slug && (method === 'GET' || method === 'HEAD')) {
      const key = resolveSessionKey(env);
      if (!key) {
        const site = await getSiteBySlug(db, slug);
        if (site?.access_mode === 'password' && site.enabled && site.current_artifact_id) {
          return htmlResponse(unavailablePage(requestId), 503, { hsts });
        }
      }
      const ctx = buildReaderContext(request, env, key ?? new Uint8Array(32));
      return handleSiteContent(request, ctx, slug, url.pathname);
    }

    if (slugCandidate) {
      if (method !== 'GET' && method !== 'HEAD') {
        return htmlResponse(notFoundPage(), 405, { hsts });
      }
      return htmlResponse(notFoundPage(), 404, { hsts });
    }

    return htmlResponse(notFoundPage(), 404, { hsts });
  } catch (error) {
    if (error instanceof ApiError) {
      return errorResponse(requestId, error);
    }
    return errorResponse(
      requestId,
      new ApiError(PublisherApiErrorCode.TemporarilyUnavailable, 'Temporarily unavailable.'),
    );
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};
