/**
 * URL path resolution for the docs serving route.
 * Handles canonical URL redirects and file path mapping.
 */

import { REJECTED_EXTENSIONS } from '@nrdocs/shared';

export type PathResolution =
  | { type: 'serve'; filePath: string }
  | { type: 'redirect'; location: string }
  | { type: 'not_found' };

/**
 * Resolves a request path to the artifact file path.
 * Handles canonical URL logic:
 * - /owner/repo → redirect to /owner/repo/
 * - /owner/repo/ → serve index.html
 * - /owner/repo/page/ → serve page/index.html
 * - /owner/repo/page → redirect to /owner/repo/page/ (non-asset paths)
 * - /owner/repo/page.html → redirect to /owner/repo/page/
 * - /owner/repo/page/index.html → redirect to /owner/repo/page/
 * - /owner/repo/assets/file.css → serve assets/file.css (no redirect for assets)
 */
export function resolveServingPath(
  requestPath: string,
  owner: string,
  repo: string,
): PathResolution {
  const prefix = `/${owner}/${repo}`;

  // Exact match without trailing slash → redirect
  if (requestPath === prefix) {
    return { type: 'redirect', location: `${prefix}/` };
  }

  // Strip the prefix to get the relative path
  if (!requestPath.startsWith(`${prefix}/`)) {
    return { type: 'not_found' };
  }

  const relativePath = requestPath.slice(prefix.length + 1); // after the /

  // Root path (empty relative = trailing slash on prefix)
  if (relativePath === '') {
    return { type: 'serve', filePath: 'index.html' };
  }

  const normalizedRelative = relativePath.replace(/\/+$/, '');
  const ext = getExtension(normalizedRelative);

  // Serve static assets: non-html paths with an extension (whitelist + rule-gated unlisted at publish time)
  if (ext && ext !== '.html') {
    if (isPlatformRuntimePath(normalizedRelative, ext)) {
      return { type: 'serve', filePath: normalizedRelative };
    }
    if (!REJECTED_EXTENSIONS.has(ext)) {
      return { type: 'serve', filePath: relativePath };
    }
  }

  // Handle .html extension → redirect to clean URL
  if (ext === '.html') {
    // /owner/repo/page.html → /owner/repo/page/
    // /owner/repo/page/index.html → /owner/repo/page/
    const withoutExt = relativePath.slice(0, -5); // remove .html
    if (withoutExt.endsWith('/index') || withoutExt === 'index') {
      // index.html at root or subdir
      const dir = withoutExt === 'index' ? '' : withoutExt.slice(0, -6); // remove /index
      return { type: 'redirect', location: `${prefix}/${dir}${dir ? '/' : ''}` };
    }
    // page.html → page/
    return { type: 'redirect', location: `${prefix}/${withoutExt}/` };
  }

  // Path ends with / → serve as directory index
  if (relativePath.endsWith('/')) {
    return { type: 'serve', filePath: `${relativePath}index.html` };
  }

  // Path without extension and without trailing slash → redirect to add trailing slash
  return { type: 'redirect', location: `${prefix}/${relativePath}/` };
}

/**
 * Checks if a pathname is a reserved platform path.
 */
export function isReservedPath(pathname: string): boolean {
  // Check exact matches and prefix matches
  if (pathname === '/favicon.ico' || pathname === '/robots.txt') {
    return true;
  }
  if (
    pathname.startsWith('/api/') ||
    (pathname.startsWith('/api') && pathname.length === 4) ||
    pathname.startsWith('/_nrdocs/') ||
    (pathname.startsWith('/_nrdocs') && pathname.length === 8) ||
    pathname.startsWith('/.well-known/')
  ) {
    return true;
  }
  return false;
}

/** Platform-generated scripts under _nrdocs/ (not repo assets). */
function isPlatformRuntimePath(normalizedRelative: string, ext: string | null): boolean {
  if (!normalizedRelative.startsWith('_nrdocs/')) return false;
  return ext === '.js' || ext === '.mjs' || ext === '.cjs';
}

/** Extracts the file extension (lowercase, including the dot). */
function getExtension(filePath: string): string | null {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return null;
  const lastSlash = filePath.lastIndexOf('/');
  if (lastDot < lastSlash) return null;
  return filePath.slice(lastDot).toLowerCase();
}
