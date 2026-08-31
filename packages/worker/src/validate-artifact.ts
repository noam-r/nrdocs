import {
  findPathCollisions,
  isManifestV2,
  isManifestV3,
  mediaTypeForExtension,
  normalizeExtension,
  parseAgentManifestV1,
  parseManifest,
  parseSha256Digest,
  sha256Hex,
  type ManifestV1,
  type ManifestV2,
  type ManifestV3,
  type PathEntry,
  type SiteId,
} from '@nrdocs/contracts';
import { PublisherApiErrorCode } from '@nrdocs/contracts';
import { ApiError } from './http.js';
import { LIMITS, MAX_PAGES_WITH_OPENAPI } from './limits.js';
import type { ArchiveFile } from './archive.js';
import { validateStoredPage } from './validate-page.js';
import { validateStoredPageV2 } from './validate-page-v2.js';
import { validateStoredPageV3 } from './validate-page-v3.js';

export type ValidatedArtifact = {
  manifest: ManifestV1 | ManifestV2 | ManifestV3;
  files: Map<string, Uint8Array>;
  digest: string;
};

async function fileDigestHex(body: Uint8Array): Promise<string> {
  return sha256Hex(body);
}

function invalid(message: string): never {
  throw new ApiError(PublisherApiErrorCode.InvalidArtifact, message);
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
    if (byPath.has(f.path)) invalid('Archive contains duplicate paths.');
    byPath.set(f.path, f.body);
  }

  const manifestBytes = byPath.get('nrdocs-manifest.json');
  if (!manifestBytes) invalid('Archive is missing nrdocs-manifest.json.');
  if (manifestBytes.byteLength > LIMITS.manifestMaxBytes) invalid('Manifest exceeds size limit.');

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  } catch {
    invalid('Manifest is not valid JSON.');
  }

  let manifest: ManifestV1 | ManifestV2 | ManifestV3;
  try {
    manifest = await parseManifest(raw, { verifyArtifactDigest: true });
  } catch (error) {
    invalid(error instanceof Error ? error.message : 'Manifest is invalid.');
  }

  if (manifest.site_id !== options.expectedSiteId) {
    invalid('Manifest site_id does not match the authorized site.');
  }

  if (manifest.artifact.digest !== expectedDigest) {
    throw new ApiError(
      PublisherApiErrorCode.DigestMismatch,
      'Artifact digest does not match the request header.',
    );
  }

  const maxPages = isManifestV3(manifest) ? MAX_PAGES_WITH_OPENAPI : LIMITS.maxPages;
  if (manifest.pages.length > maxPages) invalid('Too many pages.');
  if (manifest.assets.length > LIMITS.maxAssets) invalid('Too many assets.');
  if (manifest.attachments.length > LIMITS.maxAttachments) invalid('Too many attachments.');

  const maxDeclaredFiles = isManifestV3(manifest)
    ? LIMITS.maxDeclaredFilesWithOpenApi
    : LIMITS.maxDeclaredFiles;

  const declared = new Map<string, { size: number; sha256: string }>();
  if (isManifestV2(manifest) || isManifestV3(manifest)) {
    for (const page of manifest.pages) {
      declared.set(page.html.object, { size: page.html.size, sha256: page.html.sha256 });
      declared.set(page.markdown.object, {
        size: page.markdown.size,
        sha256: page.markdown.sha256,
      });
    }
    declared.set(manifest.agent.index.object, {
      size: manifest.agent.index.size,
      sha256: manifest.agent.index.sha256,
    });
    declared.set(manifest.agent.manifest.object, {
      size: manifest.agent.manifest.size,
      sha256: manifest.agent.manifest.sha256,
    });
    if (manifest.agent.all) {
      declared.set(manifest.agent.all.object, {
        size: manifest.agent.all.size,
        sha256: manifest.agent.all.sha256,
      });
    }
    if (isManifestV3(manifest)) {
      declared.set(manifest.openapi_download.object, {
        size: manifest.openapi_download.size,
        sha256: manifest.openapi_download.sha256,
      });
    }
  } else {
    for (const page of manifest.pages) {
      declared.set(page.object, { size: page.size, sha256: page.sha256 });
    }
  }

  for (const asset of manifest.assets) {
    if (asset.size > LIMITS.maxImageBytes) invalid('Asset exceeds size limit.');
    const ext = normalizeExtension(asset.path);
    const expectedType = ext ? mediaTypeForExtension(ext) : null;
    if (!expectedType || asset.media_type !== expectedType) invalid('Asset media type is invalid.');
    declared.set(asset.object, { size: asset.size, sha256: asset.sha256 });
  }
  for (const att of manifest.attachments) {
    if (att.size > LIMITS.maxAttachmentBytes) invalid('Attachment exceeds size limit.');
    const filenameScalars = [...att.filename];
    if (
      filenameScalars.length > LIMITS.maxAttachmentFilenameScalars ||
      new TextEncoder().encode(att.filename).byteLength > LIMITS.maxAttachmentFilenameBytes
    ) {
      invalid('Attachment filename is too long.');
    }
    const ext = normalizeExtension(att.path);
    const expectedType = ext ? mediaTypeForExtension(ext) : null;
    if (!expectedType || att.media_type !== expectedType) {
      invalid('Attachment media type is invalid.');
    }
    declared.set(att.object, { size: att.size, sha256: att.sha256 });
  }

  if (declared.size > maxDeclaredFiles) invalid('Archive declares too many files.');

  const expectedPaths = new Set<string>(['nrdocs-manifest.json', ...declared.keys()]);
  for (const path of expectedPaths) {
    if (!byPath.has(path)) invalid('Archive is missing a declared file.');
  }
  for (const path of byPath.keys()) {
    if (!expectedPaths.has(path)) invalid('Archive contains an undeclared file.');
  }

  for (const [path, meta] of declared) {
    const body = byPath.get(path)!;
    if (body.byteLength !== meta.size) invalid('File size does not match manifest.');
    const hex = await fileDigestHex(body);
    if (hex !== meta.sha256) invalid('File digest does not match manifest.');
  }

  const objectEntries: PathEntry[] = [...byPath.keys()].map((path) => ({
    collection: 'source',
    path,
  }));
  if (findPathCollisions(objectEntries).length > 0) {
    invalid('Portable path collision detected.');
  }

  const publicEntries: PathEntry[] = [
    ...manifest.pages.map((p) => ({ collection: 'pages' as const, path: p.route })),
    ...manifest.assets.map((a) => ({ collection: 'assets' as const, path: a.path })),
    ...manifest.attachments.map((a) => ({ collection: 'attachments' as const, path: a.path })),
    ...(isManifestV3(manifest)
      ? [{ collection: 'attachments' as const, path: manifest.openapi_download.route }]
      : []),
  ];
  if (findPathCollisions(publicEntries).length > 0) {
    invalid('Portable path collision detected.');
  }

  if (isManifestV2(manifest) || isManifestV3(manifest)) {
    for (const path of [
      ...manifest.pages.map((p) => p.markdown.object),
      manifest.agent.index.object,
      manifest.agent.manifest.object,
      ...(manifest.agent.all ? [manifest.agent.all.object] : []),
    ]) {
      const body = byPath.get(path)!;
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(body);
      } catch {
        invalid('Agent file is not valid UTF-8.');
      }
    }
    const agentManifestBytes = byPath.get(manifest.agent.manifest.object)!;
    let agentRaw: unknown;
    try {
      agentRaw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(agentManifestBytes));
    } catch {
      invalid('agent/manifest.json is not valid JSON.');
    }
    try {
      await parseAgentManifestV1(agentRaw, {
        verifyContentDigest: true,
        indexSha256: manifest.agent.index.sha256,
        allSha256: manifest.agent.all ? manifest.agent.all.sha256 : null,
      });
    } catch (error) {
      invalid(error instanceof Error ? error.message : 'agent/manifest.json is invalid.');
    }
    for (const page of manifest.pages) {
      if (isManifestV3(manifest)) {
        validateStoredPageV3(byPath.get(page.html.object)!, {
          pageRoute: page.route,
          manifest,
        });
      } else {
        validateStoredPageV2(byPath.get(page.html.object)!, {
          pageRoute: page.route,
          manifest,
        });
      }
    }
  } else {
    for (const page of manifest.pages) {
      validateStoredPage(byPath.get(page.object)!, {
        pageRoute: page.route,
        manifest,
      });
    }
  }

  return {
    manifest,
    files: byPath,
    digest: expectedDigest,
  };
}
