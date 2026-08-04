import {
  ARTIFACT_CONTENT_TYPE,
  formatId,
  PUBLISHER_HEADERS,
  PublisherApiErrorCode,
  type ArtifactId,
  type LockId,
  type PublishResultData,
  type PublishTargetData,
  type SiteId,
} from '@nrdocs/contracts';
import {
  acquirePublishLock,
  cleanupOrphanPrefix,
  getInstanceMetadata,
  promoteArtifact,
  releasePublishLock,
  writeStagingArtifact,
  type ArtifactObjectStore,
  type SqlExecutor,
} from '@nrdocs/persistence';
import { ApiError, successResponse } from './http.js';
import { assertExpectedSite, authenticatePublisher, type AuthenticatedPublisher } from './auth.js';
import { expandArtifactArchive } from './archive.js';
import { validateExpandedArtifact } from './validate-artifact.js';
import { enforceRateLimit, RATE_LIMITS, type RateLimiter } from './rate-limit.js';
import type { RequestId } from '@nrdocs/contracts';
import type { SiteRow } from '@nrdocs/persistence';

function siteUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, '')}/${slug}/`;
}

function targetPayload(origin: string, site: SiteRow): PublishTargetData {
  return {
    site: {
      id: site.id,
      slug: site.slug,
      url: siteUrl(origin, site.slug),
      enabled: site.enabled,
      access: site.access_mode,
      content: site.current_artifact_id ? 'published' : 'empty',
    },
  };
}

function resultPayload(
  origin: string,
  site: SiteRow,
  publication: PublishResultData['publication'],
): PublishResultData {
  return {
    site: {
      id: site.id,
      slug: site.slug,
      url: siteUrl(origin, site.slug),
      enabled: site.enabled,
      access: site.access_mode,
    },
    publication,
  };
}

export async function handlePublishTarget(
  request: Request,
  ctx: {
    db: SqlExecutor;
    requestId: RequestId;
    rateLimiter: RateLimiter;
    clientIp: string;
  },
): Promise<Response> {
  await enforceRateLimit(
    ctx.rateLimiter,
    ['api', ctx.clientIp],
    RATE_LIMITS.apiPerInstance.limit,
    RATE_LIMITS.apiPerInstance.windowMs,
  );

  let auth: AuthenticatedPublisher;
  try {
    auth = await authenticatePublisher(ctx.db, request.headers.get('authorization'));
  } catch (error) {
    if (error instanceof ApiError && error.code === PublisherApiErrorCode.InvalidToken) {
      await enforceRateLimit(
        ctx.rateLimiter,
        ['invalid-cred', ctx.clientIp],
        RATE_LIMITS.invalidCredentialsPerIp.limit,
        RATE_LIMITS.invalidCredentialsPerIp.windowMs,
      );
    }
    throw error;
  }

  await enforceRateLimit(
    ctx.rateLimiter,
    ['resolve', auth.verifier],
    RATE_LIMITS.resolveTargetPerToken.limit,
    RATE_LIMITS.resolveTargetPerToken.windowMs,
  );

  assertExpectedSite(auth, request.headers.get(PUBLISHER_HEADERS.expectedSiteId), {
    required: false,
  });

  const meta = await getInstanceMetadata(ctx.db);
  return successResponse(ctx.requestId, targetPayload(meta.canonical_origin, auth.site));
}

export async function handlePublish(
  request: Request,
  ctx: {
    db: SqlExecutor;
    store: ArtifactObjectStore;
    requestId: RequestId;
    rateLimiter: RateLimiter;
    clientIp: string;
    now?: () => Date;
  },
): Promise<Response> {
  const now = ctx.now ?? (() => new Date());

  await enforceRateLimit(
    ctx.rateLimiter,
    ['api', ctx.clientIp],
    RATE_LIMITS.apiPerInstance.limit,
    RATE_LIMITS.apiPerInstance.windowMs,
  );

  let auth: AuthenticatedPublisher;
  try {
    auth = await authenticatePublisher(ctx.db, request.headers.get('authorization'));
  } catch (error) {
    if (error instanceof ApiError && error.code === PublisherApiErrorCode.InvalidToken) {
      await enforceRateLimit(
        ctx.rateLimiter,
        ['invalid-cred', ctx.clientIp],
        RATE_LIMITS.invalidCredentialsPerIp.limit,
        RATE_LIMITS.invalidCredentialsPerIp.windowMs,
      );
    }
    throw error;
  }

  await enforceRateLimit(
    ctx.rateLimiter,
    ['publish', auth.siteId, auth.verifier],
    RATE_LIMITS.publishPerSiteToken.limit,
    RATE_LIMITS.publishPerSiteToken.windowMs,
  );

  assertExpectedSite(auth, request.headers.get(PUBLISHER_HEADERS.expectedSiteId), {
    required: true,
  });

  const contentType = (request.headers.get('content-type') ?? '')
    .split(';')[0]!
    .trim()
    .toLowerCase();
  const fullContentType = (request.headers.get('content-type') ?? '')
    .toLowerCase()
    .replace(/\s+/g, '');
  const expectedCt = ARTIFACT_CONTENT_TYPE.toLowerCase().replace(/\s+/g, '');
  if (fullContentType !== expectedCt && !fullContentType.startsWith(expectedCt)) {
    // Require exact media type including version parameter
    if (
      contentType !== 'application/vnd.nrdocs.artifact+gzip' ||
      !fullContentType.includes('version=1')
    ) {
      throw new ApiError(
        PublisherApiErrorCode.UnsupportedArtifactFormat,
        'Unsupported artifact content type.',
      );
    }
  }

  const digestHeader = request.headers.get(PUBLISHER_HEADERS.artifactDigest);
  if (!digestHeader) {
    throw new ApiError(
      PublisherApiErrorCode.InvalidRequest,
      'X-Nrdocs-Artifact-Digest is required.',
    );
  }

  const lengthHeader = request.headers.get('content-length');
  if (!lengthHeader) {
    throw new ApiError(PublisherApiErrorCode.InvalidRequest, 'Content-Length is required.');
  }
  const contentLength = Number(lengthHeader);
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    throw new ApiError(PublisherApiErrorCode.InvalidRequest, 'Content-Length is invalid.');
  }

  const meta = await getInstanceMetadata(ctx.db);

  // Unchanged-digest short-circuit after auth + site match
  if (auth.site.current_artifact_digest === digestHeader) {
    // Consume body to avoid stalled connections
    try {
      await request.arrayBuffer();
    } catch {
      // ignore
    }
    return successResponse(
      ctx.requestId,
      resultPayload(meta.canonical_origin, auth.site, {
        result: 'unchanged',
        pages: auth.site.current_page_count ?? 0,
        assets: auth.site.current_asset_count ?? 0,
        attachments: auth.site.current_attachment_count ?? 0,
      }),
    );
  }

  const lockId = formatId('lock', globalThis.crypto.getRandomValues(new Uint8Array(16))) as LockId;
  const acquired = await acquirePublishLock(ctx.db, {
    siteId: auth.siteId,
    lockId,
    now: now(),
  });
  if (!acquired.ok) {
    throw new ApiError(
      PublisherApiErrorCode.PublishInProgress,
      'Another publication is in progress for this site.',
      { retryAfterSeconds: acquired.retryAfterSeconds },
    );
  }

  const artifactId = formatId(
    'artifact',
    globalThis.crypto.getRandomValues(new Uint8Array(16)),
  ) as ArtifactId;
  let staged = false;
  const previousArtifactId = auth.site.current_artifact_id;

  try {
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength !== contentLength) {
      throw new ApiError(
        PublisherApiErrorCode.InvalidRequest,
        'Body length does not match Content-Length.',
      );
    }

    const expanded = await expandArtifactArchive(body);
    const validated = await validateExpandedArtifact(expanded, {
      expectedSiteId: auth.siteId as SiteId,
      expectedDigest: digestHeader,
    });

    const objects = [...validated.files.entries()].map(([path, bytes]) => ({
      path,
      body: bytes,
    }));
    await writeStagingArtifact(ctx.store, {
      siteId: auth.siteId,
      artifactId,
      objects,
    });
    staged = true;

    const promoted = await promoteArtifact(ctx.db, {
      siteId: auth.siteId,
      lockId,
      tokenId: auth.tokenId,
      publication: {
        artifact_id: artifactId,
        artifact_digest: validated.digest,
        root_route:
          validated.manifest.site.root.kind === 'page' ? '/' : validated.manifest.site.root.route,
        language: validated.manifest.site.language,
        direction: validated.manifest.site.direction,
        page_count: validated.manifest.pages.length,
        asset_count: validated.manifest.assets.length,
        attachment_count: validated.manifest.attachments.length,
      },
      now: now(),
    });

    if (promoted.result === 'rejected') {
      throw new ApiError(
        PublisherApiErrorCode.PublicationFailed,
        'Publication could not be committed.',
      );
    }

    if (promoted.result === 'published' && previousArtifactId) {
      await cleanupOrphanPrefix(ctx.store, {
        siteId: auth.siteId,
        candidateArtifactId: previousArtifactId,
        currentArtifactId: artifactId,
      });
    }
    if (promoted.result === 'unchanged' && staged) {
      await cleanupOrphanPrefix(ctx.store, {
        siteId: auth.siteId,
        candidateArtifactId: artifactId,
        currentArtifactId: previousArtifactId,
      });
    }

    return successResponse(
      ctx.requestId,
      resultPayload(meta.canonical_origin, promoted.site, {
        result: promoted.result,
        pages: validated.manifest.pages.length,
        assets: validated.manifest.assets.length,
        attachments: validated.manifest.attachments.length,
      }),
    );
  } catch (error) {
    try {
      await releasePublishLock(ctx.db, { siteId: auth.siteId, lockId, now: now() });
    } catch {
      // expire
    }
    if (staged) {
      try {
        await cleanupOrphanPrefix(ctx.store, {
          siteId: auth.siteId,
          candidateArtifactId: artifactId,
          currentArtifactId: previousArtifactId,
        });
      } catch {
        // best-effort
      }
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(PublisherApiErrorCode.PublicationFailed, 'Publication failed.');
  }
}
