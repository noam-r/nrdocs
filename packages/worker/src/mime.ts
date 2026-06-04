/**
 * MIME type resolution and security headers for artifact files.
 */

const MIME_MAP: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

/**
 * Returns the MIME type for a file based on extension.
 * Returns null for unknown/rejected types.
 */
export function getMimeType(filePath: string): string | null {
  const ext = getExtension(filePath);
  if (!ext) return null;
  return MIME_MAP[ext] ?? null;
}

/**
 * Returns security headers appropriate for the file type.
 * - All files get X-Content-Type-Options: nosniff
 * - SVG files get additional CSP headers to prevent script execution
 */
export function getSecurityHeaders(filePath: string): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
  };

  const ext = getExtension(filePath);
  if (ext === '.svg') {
    headers['Content-Security-Policy'] =
      "script-src 'none'; object-src 'none'; base-uri 'none'";
  }

  return headers;
}

/**
 * Extracts the file extension (lowercase, including the dot).
 */
function getExtension(filePath: string): string | null {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return null;
  // Handle paths like "dir.name/file" where dot is in directory
  const lastSlash = filePath.lastIndexOf('/');
  if (lastDot < lastSlash) return null;
  return filePath.slice(lastDot).toLowerCase();
}
