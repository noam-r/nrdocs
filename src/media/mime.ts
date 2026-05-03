/**
 * MIME types for static paths (Delivery Worker) and publish-asset validation.
 */

/** Lowercase extension including dot, e.g. `.png`. */
export function extensionFromPath(filePath: string): string {
  const last = filePath.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return '';
  return last.slice(dot).toLowerCase();
}

/**
 * Extensions permitted in `repo_content.assets` (v1 — raster/icons only).
 * SVG omitted from publish pipeline until reviewed for XSS when co-hosted.
 */
export const PUBLISH_ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
]);

const PUBLISH_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

export function mimeTypeForPublishAssetPath(path: string): string | undefined {
  const ext = extensionFromPath(path);
  if (!PUBLISH_ASSET_EXTENSIONS.has(ext)) return undefined;
  return PUBLISH_MIME[ext];
}

/** Broad map for Delivery Worker responses (path has file extension). */
export const STATIC_MIME_BY_EXTENSION: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

export function contentTypeForStaticExtension(extWithDot: string): string {
  const ext = extWithDot.toLowerCase();
  return STATIC_MIME_BY_EXTENSION[ext] ?? 'application/octet-stream';
}
