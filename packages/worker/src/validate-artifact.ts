import {
  findPathCollisions,
  mediaTypeForExtension,
  normalizeExtension,
  parseManifestV1,
  parseSha256Digest,
  sha256Hex,
  type ManifestV1,
  type PathEntry,
  type SiteId,
} from '@nrdocs/contracts';
import { PublisherApiErrorCode } from '@nrdocs/contracts';
import { ApiError } from './http.js';
import { LIMITS } from './limits.js';
import type { ArchiveFile } from './archive.js';
import { validateStoredPage } from './validate-page.js';

export type ValidatedArtifact = {
  manifest: ManifestV1;
  files: Map<string, Uint8Array>;
  digest: string;
};

async function fileDigestHex(body: Uint8Array): Promise<string> {
  return sha256Hex(body);
}

export async function validateExpandedArtifact(
  files: ArchiveFile[],
  options: {
    expectedSiteId: SiteId;
    expectedDigest: string;
  },
): Promise<ValidatedArtifact> {
  const expectedDigest = parseSha256Digest(options.expectedDigest);
  if (!expectedDigest) {
    throw new ApiError(
      PublisherApiErrorCode.InvalidRequest,
      'X-Nrdocs-Artifact-Digest must be sha256:<hex>.',
    );
  }

  const byPath = new Map<string, Uint8Array>();
  for (const f of files) {
    if (byPath.has(f.path)) {
      throw new ApiError(
        PublisherApiErrorCode.InvalidArtifact,
        'Archive contains duplicate paths.',
      );
    }
    byPath.set(f.path, f.body);
  }

  const manifestBytes = byPath.get('nrdocs-manifest.json');
  if (!manifestBytes) {
    throw new ApiError(
      PublisherApiErrorCode.InvalidArtifact,
      'Archive is missing nrdocs-manifest.json.',
    );
  }
  if (manifestBytes.byteLength > LIMITS.manifestMaxBytes) {
    throw new ApiError(PublisherApiErrorCode.InvalidArtifact, 'Manifest exceeds size limit.');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  } catch {
    throw new ApiError(PublisherApiErrorCode.InvalidArtifact, 'Manifest is not valid JSON.');
  }

  let manifest: ManifestV1;
  try {
    manifest = await parseManifestV1(raw, { verifyArtifactDigest: true });
  } catch (error) {
    throw new ApiError(
      PublisherApiErrorCode.InvalidArtifact,
      error instanceof Error ? error.message : 'Manifest is invalid.',
    );
  }

  if (manifest.site_id !== options.expectedSiteId) {
    throw new ApiError(
      PublisherApiErrorCode.InvalidArtifact,
      'Manifest site_id does not match the authorized site.',
    );
  }

  if (manifest.artifact.digest !== expectedDigest) {
    throw new ApiError(
      PublisherApiErrorCode.DigestMismatch,
      'Artifact digest does not match the request header.',
    );
  }

  if (manifest.pages.length > LIMITS.maxPages) {
    throw new ApiError(PublisherApiErrorCode.InvalidArtifact, 'Too many pages.');
  }
  if (manifest.assets.length > LIMITS.maxAssets) {
    throw new ApiError(PublisherApiErrorCode.InvalidArtifact, 'Too many assets.');
  }
  if (manifest.attachments.length > LIMITS.maxAttachments) {
    throw new ApiError(PublisherApiErrorCode.InvalidArtifact, 'Too many attachments.');
  }

  const declared = new Map<string, { size: number; sha256: string }>();
  for (const page of manifest.pages) {
    declared.set(page.object, { size: page.size, sha256: page.sha256 });
  }
  for (const asset of manifest.assets) {
    if (asset.size > LIMITS.maxImageBytes) {
      throw new ApiError(PublisherApiErrorCode.InvalidArtifact, 'Asset exceeds size limit.');
    }
    const ext = normalizeExtension(asset.path);
    const expectedType = ext ? mediaTypeForExtension(ext) : null;
    if (!expectedType || asset.media_type !== expectedType) {
      throw new ApiError(PublisherApiErrorCode.InvalidArtifact, 'Asset media type is invalid.');
    }
    declared.set(asset.object, { size: asset.size, sha256: asset.sha256 });
  }
  for (const att of manifest.attachments) {
    if (att.size > LIMITS.maxAttachmentBytes) {
      throw new ApiError(PublisherApiErrorCode.InvalidArtifact, 'Attachment exceeds size limit.');
    }
    const filenameScalars = [...att.filename];
    if (
      filenameScalars.length > LIMITS.maxAttachmentFilenameScalars ||
      new TextEncoder().encode(att.filename).byteLength > LIMITS.maxAttachmentFilenameBytes
    ) {
      throw new ApiError(PublisherApiErrorCode.InvalidArtifact, 'Attachment filename is too long.');
    }
    const ext = normalizeExtension(att.path);
    const expectedType = ext ? mediaTypeForExtension(ext) : null;
    if (!expectedType || att.media_type !== expectedType) {
      throw new ApiError(
        PublisherApiErrorCode.InvalidArtifact,
        'Attachment media type is invalid.',
      );
    }
    declared.set(att.object, { size: att.size, sha256: att.sha256 });
  }

  const expectedPaths = new Set<string>(['nrdocs-manifest.json', ...declared.keys()]);
  for (const path of expectedPaths) {
    if (!byPath.has(path)) {
      throw new ApiError(
        PublisherApiErrorCode.InvalidArtifact,
        'Archive is missing a declared file.',
      );
    }
  }
  for (const path of byPath.keys()) {
    if (!expectedPaths.has(path)) {
      throw new ApiError(
        PublisherApiErrorCode.InvalidArtifact,
        'Archive contains an undeclared file.',
      );
    }
  }

  for (const [path, meta] of declared) {
    const body = byPath.get(path)!;
    if (body.byteLength !== meta.size) {
      throw new ApiError(
        PublisherApiErrorCode.InvalidArtifact,
        'File size does not match manifest.',
      );
    }
    const hex = await fileDigestHex(body);
    if (hex !== meta.sha256) {
      throw new ApiError(
        PublisherApiErrorCode.InvalidArtifact,
        'File digest does not match manifest.',
      );
    }
  }

  const objectEntries: PathEntry[] = [...byPath.keys()].map((path) => ({
    collection: 'source',
    path,
  }));
  if (findPathCollisions(objectEntries).length > 0) {
    throw new ApiError(PublisherApiErrorCode.InvalidArtifact, 'Portable path collision detected.');
  }

  const publicEntries: PathEntry[] = [
    ...manifest.pages.map((p) => ({ collection: 'pages' as const, path: p.route })),
    ...manifest.assets.map((a) => ({ collection: 'assets' as const, path: a.path })),
    ...manifest.attachments.map((a) => ({ collection: 'attachments' as const, path: a.path })),
  ];
  if (findPathCollisions(publicEntries).length > 0) {
    throw new ApiError(PublisherApiErrorCode.InvalidArtifact, 'Portable path collision detected.');
  }

  for (const page of manifest.pages) {
    validateStoredPage(byPath.get(page.object)!, {
      pageRoute: page.route,
      manifest,
    });
  }

  return {
    manifest,
    files: byPath,
    digest: expectedDigest,
  };
}
