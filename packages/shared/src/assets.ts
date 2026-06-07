/**
 * Artifact file extension policy: whitelist, forbidden, and rule-gated unlisted.
 */

import { REJECTED_EXTENSIONS } from './constants.js';

/** Extensions always allowed in artifacts (no rule consent required). */
export const WHITELISTED_ASSET_EXTENSIONS = new Set([
  '.html',
  '.css',
  '.json',
  '.jsonp',
  '.yaml',
  '.yml',
  '.xml',
  '.toml',
  '.csv',
  '.ndjson',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.txt',
  '.pdf',
]);

/** @deprecated Use WHITELISTED_ASSET_EXTENSIONS */
export const ALLOWED_ASSET_EXTENSIONS = WHITELISTED_ASSET_EXTENSIONS;

export type AssetExtensionClass = 'whitelisted' | 'unlisted' | 'forbidden';

const MANIFEST_BASENAME = 'nrdocs-manifest.json';

/**
 * Extracts lowercase extension including the dot, or null if none.
 */
export function getExtensionFromPath(filePath: string): string | null {
  const basename = filePath.split('/').pop() ?? filePath;
  const lastDot = basename.lastIndexOf('.');
  if (lastDot === -1) return null;
  return basename.slice(lastDot).toLowerCase();
}

/** Prefix for published Markdown sources (export). */
export const NRDOCS_SOURCES_PREFIX = '_nrdocs/sources/';

/** Path to the all-pages Markdown zip in artifacts. */
export const NRDOCS_EXPORT_SITE_ZIP = '_nrdocs/export/site.zip';

/**
 * True for export bundle paths (_nrdocs/sources/, _nrdocs/export/).
 */
export function isNrdocsExportArtifactPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return (
    normalized.startsWith(NRDOCS_SOURCES_PREFIX) ||
    normalized.startsWith('_nrdocs/export/')
  );
}

/**
 * True for platform-generated paths under _nrdocs/ (e.g. mermaid.min.js), excluding export bundles.
 */
export function isPlatformRuntimePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  if (!normalized.startsWith('_nrdocs/')) return false;
  if (isNrdocsExportArtifactPath(normalized)) return false;
  return true;
}

/**
 * Artifact path for a nav page's source Markdown.
 */
export function nrdocsSourceArtifactPath(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, '/');
  return `${NRDOCS_SOURCES_PREFIX}${normalized}`;
}

/**
 * Classifies an extension (with leading dot).
 */
export function classifyAssetExtension(ext: string): AssetExtensionClass {
  const lower = ext.toLowerCase();
  if (REJECTED_EXTENSIONS.has(lower)) {
    return 'forbidden';
  }
  if (WHITELISTED_ASSET_EXTENSIONS.has(lower)) {
    return 'whitelisted';
  }
  return 'unlisted';
}

export interface ValidateAssetOptions {
  /** When true, unlisted extensions are permitted (operator rule consent). */
  allowUnlisted?: boolean;
}

export interface ValidateAssetResult {
  ok: boolean;
  code?: string;
  message?: string;
  classification?: AssetExtensionClass;
}

/**
 * Validates a file path for publish/archive inclusion.
 */
export function validateAssetFilePath(
  filePath: string,
  options: ValidateAssetOptions = {},
): ValidateAssetResult {
  const basename = filePath.split('/').pop() ?? filePath;
  if (basename === MANIFEST_BASENAME) {
    return { ok: true, classification: 'whitelisted' };
  }

  if (isNrdocsExportArtifactPath(filePath) || isPlatformRuntimePath(filePath)) {
    return { ok: true, classification: 'whitelisted' };
  }

  const ext = getExtensionFromPath(filePath);
  if (!ext) {
    return {
      ok: false,
      code: 'INVALID_EXTENSION',
      message: `No extension found: ${filePath}`,
      classification: 'unlisted',
    };
  }

  if (REJECTED_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      code: 'REJECTED_EXTENSION',
      message: `Rejected extension ${ext}: ${filePath}`,
      classification: 'forbidden',
    };
  }

  const classification = classifyAssetExtension(ext);
  if (classification === 'whitelisted') {
    return { ok: true, classification };
  }

  if (classification === 'forbidden') {
    return {
      ok: false,
      code: 'REJECTED_EXTENSION',
      message: `Rejected extension ${ext}: ${filePath}`,
      classification,
    };
  }

  if (options.allowUnlisted) {
    return { ok: true, classification: 'unlisted' };
  }

  return {
    ok: false,
    code: 'EXTENSION_NOT_PERMITTED',
    message: `Extension not on whitelist (${ext}): ${filePath}`,
    classification: 'unlisted',
  };
}

/**
 * Returns paths in the list that require allow_unlisted_assets on a matching rule.
 */
export function findUnlistedAssetPaths(filePaths: string[]): string[] {
  const unlisted: string[] = [];
  for (const p of filePaths) {
    const basename = p.split('/').pop() ?? p;
    if (basename === MANIFEST_BASENAME) continue;
    const ext = getExtensionFromPath(p);
    if (!ext) {
      unlisted.push(p);
      continue;
    }
    if (classifyAssetExtension(ext) === 'unlisted') {
      unlisted.push(p);
    }
  }
  return unlisted;
}
