import { mimeTypeForPublishAssetPath, PUBLISH_ASSET_EXTENSIONS } from '../media/mime.js';

export interface DecodedPublishAsset {
  path: string;
  content: ArrayBuffer;
  contentType: string;
}

export type AssetIngestResult =
  | { ok: true; items: DecodedPublishAsset[] }
  | { ok: false; error: string };

/** Max decoded bytes per file (5 MiB). */
export const PUBLISH_ASSET_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Max total decoded bytes across all assets (25 MiB). */
export const PUBLISH_ASSET_MAX_TOTAL_BYTES = 25 * 1024 * 1024;

/** Max number of asset files per publish. */
export const PUBLISH_ASSET_MAX_COUNT = 200;

const ASSET_PATH_RE = /^([A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/;

function isValidAssetPathKey(key: string): boolean {
  if (!key || key.startsWith('/') || key.includes('..')) return false;
  if (key.endsWith('/')) return false;
  const lower = key.toLowerCase();
  if (lower.endsWith('.md')) return false;
  if (!ASSET_PATH_RE.test(key)) return false;
  const last = key.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return false;
  const ext = last.slice(dot).toLowerCase();
  return PUBLISH_ASSET_EXTENSIONS.has(ext);
}

function decodeBase64ToArrayBuffer(b64: string): ArrayBuffer | null {
  const trimmed = b64.replace(/\s+/g, '');
  if (trimmed.length === 0) return new ArrayBuffer(0);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(trimmed)) return null;
  try {
    const bin = atob(trimmed);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  } catch {
    return null;
  }
}

/**
 * Validates and decodes `repo_content.assets` from a publish request body.
 * Returns structured errors suitable for HTTP 400 responses.
 */
export function decodeRepoContentAssets(assets: unknown): AssetIngestResult {
  if (assets === undefined || assets === null) {
    return { ok: true, items: [] };
  }
  if (typeof assets !== 'object' || Array.isArray(assets)) {
    return { ok: false, error: 'repo_content.assets must be an object when present' };
  }

  const entries = Object.entries(assets as Record<string, unknown>);
  if (entries.length > PUBLISH_ASSET_MAX_COUNT) {
    return {
      ok: false,
      error: `repo_content.assets: at most ${PUBLISH_ASSET_MAX_COUNT} files allowed`,
    };
  }

  const items: DecodedPublishAsset[] = [];
  let total = 0;
  const seen = new Set<string>();

  for (const [rawKey, rawVal] of entries) {
    const key = rawKey.replace(/\\/g, '/');
    if (seen.has(key)) {
      return { ok: false, error: `repo_content.assets: duplicate path "${key}"` };
    }
    seen.add(key);

    if (!isValidAssetPathKey(key)) {
      return {
        ok: false,
        error: `repo_content.assets: invalid or disallowed path "${rawKey}" (use paths under content/ with an allowed extension: ${[...PUBLISH_ASSET_EXTENSIONS].join(', ')})`,
      };
    }

    const mime = mimeTypeForPublishAssetPath(key);
    if (!mime) {
      return { ok: false, error: `repo_content.assets: unsupported file type for "${key}"` };
    }

    if (typeof rawVal !== 'string') {
      return { ok: false, error: `repo_content.assets["${key}"] must be a base64 string` };
    }

    const buf = decodeBase64ToArrayBuffer(rawVal);
    if (buf === null) {
      return { ok: false, error: `repo_content.assets["${key}"]: invalid base64` };
    }

    if (buf.byteLength > PUBLISH_ASSET_MAX_FILE_BYTES) {
      return {
        ok: false,
        error: `repo_content.assets["${key}"]: file exceeds ${PUBLISH_ASSET_MAX_FILE_BYTES} bytes`,
      };
    }

    total += buf.byteLength;
    if (total > PUBLISH_ASSET_MAX_TOTAL_BYTES) {
      return {
        ok: false,
        error: `repo_content.assets: total size exceeds ${PUBLISH_ASSET_MAX_TOTAL_BYTES} bytes`,
      };
    }

    items.push({ path: key, content: buf, contentType: mime });
  }

  return { ok: true, items };
}
