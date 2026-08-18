import {
  formatId,
  ExitCode,
  type ArtifactId,
  type LockId,
  type PublishResultData,
  type SiteId,
  type TokenRecordId,
} from '@nrdocs/contracts';
import {
  acquirePublishLock,
  cleanupOrphanPrefix,
  findTokenByNameOrId,
  getAuthoritativeUtcNow,
  getSiteById,
  isTokenUsable,
  issueToken,
  listTokensForSite,
  promoteArtifact,
  releasePublishLock,
  writeStagingArtifact,
  type SiteRow,
} from '@nrdocs/persistence';
import type { InMemoryArtifact } from '@nrdocs/renderer';
import { generatePublishingToken } from './crypto.js';
import { siteUrl } from './site.js';
import type { AdminSession } from './context.js';
import { CliError } from '../errors.js';

function publishFailure(
  message: string,
  code: string,
  exit: (typeof ExitCode)[keyof typeof ExitCode],
) {
  return new CliError({
    code,
    phase: 'upload',
    exit_code: exit,
    safe_message: `Publish failed during upload.\n\n${message}\n\nThe currently published site was not changed.`,
  });
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

async function resolveUsableTokenId(session: AdminSession, siteId: SiteId): Promise<TokenRecordId> {
  const nowIso = await getAuthoritativeUtcNow(session.db);
  const tokens = await listTokensForSite(session.db, siteId);
  const usable = tokens.find((token) => isTokenUsable(token, nowIso));
  if (usable) return usable.id;

  let name = 'admin-publish';
  let n = 2;
  while (await findTokenByNameOrId(session.db, siteId, name)) {
    name = `admin-publish-${n}`;
    n += 1;
  }
  const tokenId = formatId(
    'tok',
    globalThis.crypto.getRandomValues(new Uint8Array(16)),
  ) as TokenRecordId;
  const { verifier } = await generatePublishingToken();
  const issued = await issueToken(session.db, {
    id: tokenId,
    site_id: siteId,
    name,
    token_verifier: verifier,
  });
  return issued.id;
}

/** Promote a locally rendered artifact through D1 + R2 (admin machine, no publisher token). */
export async function applyAdminPublication(
  session: AdminSession,
  input: {
    siteId: SiteId;
    artifact: InMemoryArtifact;
    digest: string;
    now?: Date;
  },
): Promise<PublishResultData> {
  const origin = session.descriptor.canonical_origin;
  const site = await getSiteById(session.db, input.siteId);
  if (!site) {
    throw publishFailure(
      'Site was not found on this instance.',
      'site_not_found',
      ExitCode.LocalValidation,
    );
  }

  if (site.current_artifact_digest === input.digest) {
    return resultPayload(origin, site, {
      result: 'unchanged',
      pages: site.current_page_count ?? 0,
      assets: site.current_asset_count ?? 0,
      attachments: site.current_attachment_count ?? 0,
    });
  }

  const now = input.now ?? new Date();
  const lockId = formatId('lock', globalThis.crypto.getRandomValues(new Uint8Array(16))) as LockId;
  const acquired = await acquirePublishLock(session.db, {
    siteId: input.siteId,
    lockId,
    now,
  });
  if (!acquired.ok) {
    throw publishFailure(
      'Another publication is in progress for this site.',
      'publish_in_progress',
      ExitCode.RetryableExternal,
    );
  }

  const artifactId = formatId(
    'artifact',
    globalThis.crypto.getRandomValues(new Uint8Array(16)),
  ) as ArtifactId;
  let staged = false;
  const previousArtifactId = site.current_artifact_id;
  const tokenId = await resolveUsableTokenId(session, input.siteId);

  try {
    await writeStagingArtifact(session.store, {
      siteId: input.siteId,
      artifactId,
      objects: input.artifact.files.map((file) => ({
        path: file.objectPath,
        body: file.bytes,
      })),
    });
    staged = true;

    const root = input.artifact.manifest.site.root;
    const promoted = await promoteArtifact(session.db, {
      siteId: input.siteId,
      lockId,
      tokenId,
      publication: {
        artifact_id: artifactId,
        artifact_digest: input.digest,
        root_route: root.kind === 'page' ? '/' : root.route,
        language: input.artifact.manifest.site.language,
        direction: input.artifact.manifest.site.direction,
        page_count: input.artifact.manifest.pages.length,
        asset_count: input.artifact.manifest.assets.length,
        attachment_count: input.artifact.manifest.attachments.length,
      },
      now,
    });

    if (promoted.result === 'rejected') {
      throw publishFailure(
        'Publication could not be committed.',
        'publication_failed',
        ExitCode.RetryableExternal,
      );
    }

    if (promoted.result === 'published' && previousArtifactId) {
      await cleanupOrphanPrefix(session.store, {
        siteId: input.siteId,
        candidateArtifactId: previousArtifactId,
        currentArtifactId: artifactId,
      });
    }
    if (promoted.result === 'unchanged' && staged) {
      await cleanupOrphanPrefix(session.store, {
        siteId: input.siteId,
        candidateArtifactId: artifactId,
        currentArtifactId: previousArtifactId,
      });
    }

    return resultPayload(origin, promoted.site, {
      result: promoted.result,
      pages: input.artifact.manifest.pages.length,
      assets: input.artifact.manifest.assets.length,
      attachments: input.artifact.manifest.attachments.length,
    });
  } catch (error) {
    try {
      await releasePublishLock(session.db, { siteId: input.siteId, lockId, now });
    } catch {
      // expire
    }
    if (staged) {
      try {
        await cleanupOrphanPrefix(session.store, {
          siteId: input.siteId,
          candidateArtifactId: artifactId,
          currentArtifactId: previousArtifactId,
        });
      } catch {
        // best-effort
      }
    }
    if (error instanceof CliError) throw error;
    throw publishFailure('Publication failed.', 'publication_failed', ExitCode.RetryableExternal);
  }
}
