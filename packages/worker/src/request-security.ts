import { normalizeRepoPath } from './session.js';

/**
 * True when the client connection is HTTPS (directly or via X-Forwarded-Proto).
 */
export function isSecureRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (url.protocol === 'https:') return true;

  const forwarded = request.headers.get('X-Forwarded-Proto');
  const first = forwarded?.split(',')[0]?.trim().toLowerCase();
  return first === 'https';
}

/**
 * Upgrades a request URL to https:// (same host, path, and query).
 */
export function buildHttpsRequestUrl(request: Request): string {
  const url = new URL(request.url);
  url.protocol = 'https:';
  return url.toString();
}

/**
 * HTTPS URL for a password-protected repo root.
 */
export function buildHttpsRepoUrl(request: Request, repoFullName: string): string {
  const url = new URL(request.url);
  url.protocol = 'https:';
  url.pathname = `${normalizeRepoPath(`/${repoFullName}`)}/`;
  url.search = '';
  return url.toString();
}
