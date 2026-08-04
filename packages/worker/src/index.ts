/**
 * Cloudflare Worker for publish and serve.
 * Phase 9: publisher API (publish-target + publish) with atomic promotion.
 * Reader serving lands in Phase 11.
 */
import { CONTRACTS_PACKAGE } from '@nrdocs/contracts';
import {
  MemoryArtifactStore,
  PERSISTENCE_PACKAGE,
  type ArtifactObjectStore,
} from '@nrdocs/persistence';
import { createD1Executor, type D1DatabaseLike } from './persistence-adapter.js';
import {
  ApiError,
  errorResponse,
  requestIdFromHeaders,
  textResponse,
  versionResponse,
} from './http.js';
import { handlePublish, handlePublishTarget } from './publish.js';
import { MemoryRateLimiter, type RateLimiter } from './rate-limit.js';
import { r2AsArtifactStore, type R2BucketLike } from './r2-adapter.js';
import { PublisherApiErrorCode } from '@nrdocs/contracts';

export const WORKER_PACKAGE = '@nrdocs/worker' as const;

export type WorkerEnv = {
  DB: D1DatabaseLike;
  ARTIFACTS: R2BucketLike | ArtifactObjectStore;
  NRDOCS_INSTANCE_ID: string;
  NRDOCS_PACKAGE_VERSION: string;
  NRDOCS_SESSION_KEY?: string;
  /** Test injectables */
  __artifactStore?: ArtifactObjectStore;
  __rateLimiter?: RateLimiter;
  __now?: () => Date;
  __clientIp?: string;
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
    // MemoryArtifactStore or R2-like
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

export async function handleRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const requestId = requestIdFromHeaders(request.headers);

  try {
    if (url.pathname === '/_nrdocs/api/version') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        throw new ApiError(PublisherApiErrorCode.InvalidRequest, 'Method not allowed.');
      }
      return versionResponse(env.NRDOCS_PACKAGE_VERSION);
    }

    if (url.pathname === '/' || url.pathname === '') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return textResponse('Method not allowed', 405);
      }
      return textResponse('nrdocs');
    }

    const db = createD1Executor(env.DB);
    const rateLimiter = env.__rateLimiter ?? new MemoryRateLimiter();
    const store = resolveStore(env);
    const ip = clientIp(request, env);

    if (url.pathname === '/_nrdocs/api/v1/publish-target') {
      if (request.method !== 'GET') {
        throw new ApiError(PublisherApiErrorCode.InvalidRequest, 'Method not allowed.');
      }
      return await handlePublishTarget(request, { db, requestId, rateLimiter, clientIp: ip });
    }

    if (url.pathname === '/_nrdocs/api/v1/publish') {
      if (request.method !== 'POST') {
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

    return textResponse('Not found', 404);
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
