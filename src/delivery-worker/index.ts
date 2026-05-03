/**
 * Delivery Worker — thin request router and authentication gate.
 *
 * Bound to `docs.example.com/*`. Resolves site slug from `/<slug>/...`,
 * looks up the repo in D1, and routes the request accordingly.
 *
 * GET `/` (no path segments) serves a platform homepage from R2 at `site/index.html`
 * by default (override with `HOME_PAGE_R2_KEY`, or set it to `""` to return 404 on `/`).
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 1.8, 1.9, 1.10, 13.2, 13.3, 20.1, 20.2, 20.3
 */

import { D1DataStore } from '../data-store/d1-data-store';
import { R2StorageProvider } from '../storage/r2-storage-provider';
import { PasswordHasher } from '../auth/password-hasher';
import { SessionTokenManager } from '../auth/session-token-manager';
import { RateLimiter } from '../auth/rate-limiter';
import { readCookieValue } from './cookie-header';
import { contentTypeForStaticExtension } from '../media/mime.js';

/** Default R2 object key for GET / on the delivery host (platform landing page, not a repo slug). */
export const DEFAULT_HOME_PAGE_R2_KEY = 'site/index.html';

/** Cloudflare Worker environment bindings for the Delivery Worker. */
export interface DeliveryEnv {
  DB: D1Database;
  BUCKET: R2Bucket;
  HMAC_SIGNING_KEY: string;
  /** Session duration in seconds. Default "28800" (8 hours). */
  SESSION_TTL: string;
  /** Cache TTL in seconds for content responses. */
  CACHE_TTL: string;
  /** Maximum failed login attempts before rate-limiting. */
  RATE_LIMIT_MAX: string;
  /** Rate-limit window in seconds. */
  RATE_LIMIT_WINDOW: string;
  /**
   * R2 object key for GET / (delivery origin with no path segments).
   * Defaults to {@link DEFAULT_HOME_PAGE_R2_KEY}. Set to empty string to disable (404 on /).
   */
  HOME_PAGE_R2_KEY?: string;
}

/**
 * Return a generic 404 response. Identical regardless of whether the
 * slug was never registered, is disabled, or is awaiting approval —
 * no information disclosure (Requirements 1.3, 1.4).
 */
function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

/** Default cache TTL in seconds when CACHE_TTL env is not set. */
const DEFAULT_CACHE_TTL = 300;

/** Default session TTL in seconds (8 hours). */
const DEFAULT_SESSION_TTL = 28800;

/**
 * Parse the session TTL from the environment, falling back to the default.
 */
function parseSessionTtl(env: DeliveryEnv): number {
  const raw = env.SESSION_TTL;
  if (!raw) return DEFAULT_SESSION_TTL;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SESSION_TTL;
}

/** Default maximum failed login attempts before rate-limiting. */
const DEFAULT_RATE_LIMIT_MAX = 5;

/** Default rate-limit window in seconds. */
const DEFAULT_RATE_LIMIT_WINDOW = 300;

/**
 * Parse the maximum failed login attempts from the environment, falling back to the default.
 */
function parseRateLimitMax(env: DeliveryEnv): number {
  const raw = env.RATE_LIMIT_MAX;
  if (!raw) return DEFAULT_RATE_LIMIT_MAX;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RATE_LIMIT_MAX;
}

/**
 * Parse the rate-limit window in seconds from the environment, falling back to the default.
 */
function parseRateLimitWindow(env: DeliveryEnv): number {
  const raw = env.RATE_LIMIT_WINDOW;
  if (!raw) return DEFAULT_RATE_LIMIT_WINDOW;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RATE_LIMIT_WINDOW;
}

function getCookie(request: Request, name: string): string | null {
  return readCookieValue(request.headers.get('Cookie'), name);
}

/** Compare internal repo UUIDs; D1 and JSON may differ in casing. */
function sameRepoId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Render the login page HTML for a password-protected site.
 *
 * Requirements: 5.1, 5.4, 5.8
 */
function renderLoginPage(projectTitle: string, actionUrl: string, error?: string): Response {
  const errorHtml = error
    ? `<p style="color:#c0392b;margin-bottom:1rem;">${escapeHtml(error)}</p>`
    : '';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login — ${escapeHtml(projectTitle)}</title>
<style>
  body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5;}
  .card{background:#fff;padding:2rem;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);max-width:360px;width:100%;}
  h1{margin:0 0 1.5rem;font-size:1.25rem;text-align:center;}
  label{display:block;margin-bottom:.5rem;font-weight:600;}
  input[type=password]{width:100%;padding:.5rem;border:1px solid #ccc;border-radius:4px;font-size:1rem;box-sizing:border-box;}
  button{margin-top:1rem;width:100%;padding:.6rem;background:#2563eb;color:#fff;border:none;border-radius:4px;font-size:1rem;cursor:pointer;}
  button:hover{background:#1d4ed8;}
</style>
</head>
<body>
<div class="card">
  <h1>${escapeHtml(projectTitle)}</h1>
  ${errorHtml}
  <form method="POST" action="${escapeHtml(actionUrl)}">
    <label for="password">Password</label>
    <input type="password" id="password" name="password" required autofocus>
    <button type="submit">Sign in</button>
  </form>
</div>
</body>
</html>`;
  return new Response(html, {
    status: error ? 401 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/**
 * Minimal HTML escaping for safe interpolation into HTML.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pathSegments(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean);
}

/**
 * Path under the site URL prefix (content path within the site).
 * e.g. prefix `/my-project`, path `/my-project/section/page/` → `section/page/`
 */
function extractRemainingPathAfterPrefix(url: URL, urlPathPrefix: string): string {
  let remaining = url.pathname.slice(urlPathPrefix.length);
  if (remaining.startsWith('/')) {
    remaining = remaining.slice(1);
  }
  return remaining;
}

/**
 * Check whether a path has a file extension.
 */
function hasFileExtension(path: string): boolean {
  const lastSegment = path.split('/').pop() ?? '';
  return lastSegment.includes('.') && !lastSegment.startsWith('.');
}

/**
 * Get the file extension from a path (including the dot), or empty string.
 */
function getFileExtension(path: string): string {
  const lastSegment = path.split('/').pop() ?? '';
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return lastSegment.slice(dotIndex).toLowerCase();
}

/**
 * Resolve the Content-Type for a given R2 content type or file extension.
 * Falls back to the R2 object's stored content type, then MIME lookup, then octet-stream.
 */
function resolveContentType(r2ContentType: string, filePath: string): string {
  // Prefer the R2-stored content type if it's meaningful
  if (r2ContentType && r2ContentType !== 'application/octet-stream') {
    return r2ContentType;
  }
  const ext = getFileExtension(filePath);
  return contentTypeForStaticExtension(ext) !== 'application/octet-stream'
    ? contentTypeForStaticExtension(ext)
    : (r2ContentType || 'application/octet-stream');
}

/**
 * Parse the cache TTL from the environment, falling back to the default.
 */
function parseCacheTtl(env: DeliveryEnv): number {
  const raw = env.CACHE_TTL;
  if (!raw) return DEFAULT_CACHE_TTL;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CACHE_TTL;
}

/** R2 key for the delivery root `/`. Empty string in env disables the homepage. */
function resolveHomePageR2Key(env: DeliveryEnv): string | null {
  const raw = env.HOME_PAGE_R2_KEY;
  if (raw === '') return null;
  const trimmed = raw?.trim();
  if (trimmed) return trimmed;
  return DEFAULT_HOME_PAGE_R2_KEY;
}

/**
 * GET/HEAD `/` — serve a static object from R2 (e.g. `site/index.html`), no D1 repo.
 */
async function tryServePlatformHomePage(request: Request, env: DeliveryEnv): Promise<Response | null> {
  const key = resolveHomePageR2Key(env);
  if (key === null) return null;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const storage = new R2StorageProvider(env.BUCKET);
  const object = await storage.get(key);
  if (!object) return null;

  const cacheTtl = parseCacheTtl(env);
  const contentType = resolveContentType(object.contentType, key);
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': `public, max-age=${cacheTtl}`,
  };

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }

  return new Response(object.content, { status: 200, headers });
}

/**
 * Resolve the R2 key, fetch the object, and return an HTTP response with
 * appropriate Cache-Control and Content-Type headers.
 *
 * This helper is shared by every access-mode path that ultimately needs
 * to serve static content from R2.
 *
 * Requirements: 1.8, 1.9, 1.10, 13.2, 20.1, 20.2, 20.3
 */
async function serveContent(
  url: URL,
  urlPathPrefix: string,
  pointer: string,
  env: DeliveryEnv,
): Promise<Response> {
  const remaining = extractRemainingPathAfterPrefix(url, urlPathPrefix);

  // URL resolution strategy (Requirements 1.8, 1.9, 1.10)
  // Case B: No trailing slash and no file extension → 301 redirect to trailing-slash form
  if (!url.pathname.endsWith('/') && !hasFileExtension(remaining)) {
    const redirectUrl = new URL(url.toString());
    redirectUrl.pathname = url.pathname + '/';
    return Response.redirect(redirectUrl.toString(), 301);
  }

  // Determine the R2 key to fetch
  let r2Key: string;
  if (url.pathname.endsWith('/')) {
    // Case A: Trailing slash → resolve to index.html
    r2Key = `${pointer}${remaining}index.html`;
  } else {
    // Case C: Has file extension → serve literal R2 object
    r2Key = `${pointer}${remaining}`;
  }

  // Fetch from R2 via StorageProvider
  const storage = new R2StorageProvider(env.BUCKET);
  const object = await storage.get(r2Key);

  if (!object) {
    return notFound();
  }

  // Serve content with appropriate headers (Requirements 20.1, 20.2, 20.3)
  const cacheTtl = parseCacheTtl(env);
  const contentType = resolveContentType(object.contentType, r2Key);

  return new Response(object.content, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${cacheTtl}`,
    },
  });
}

export default {
  async fetch(request: Request, env: DeliveryEnv): Promise<Response> {
    const url = new URL(request.url);
    const dataStore = new D1DataStore(env.DB);
    const segments = pathSegments(url);
    if (segments.length === 0) {
      const home = await tryServePlatformHomePage(request, env);
      if (home !== null) return home;
      return notFound();
    }

    const siteSlug = segments[0];
    const urlPathPrefix = `/${siteSlug}`;
    const repo = await dataStore.getRepoBySlug(siteSlug);

    // Unknown slug, disabled, or awaiting_approval → identical 404
    if (!repo || repo.status === 'disabled' || repo.status === 'awaiting_approval') {
      return notFound();
    }

    // No active publish pointer → nothing to serve (Req 13.2)
    if (!repo.active_publish_pointer) {
      return notFound();
    }

    const pointer = repo.active_publish_pointer;

    // Access mode branching (Requirements 4.2, 7.9)
    if (repo.access_mode === 'public') {
      // Public sites: serve content directly without authentication.
      return serveContent(url, urlPathPrefix, pointer, env);
    }

    // Password-protected sites: authentication required (Req 4.3).
    // Requirements: 4.3, 5.1, 5.2, 5.3, 5.4, 5.8, 6.5

    const hmacKey = env.HMAC_SIGNING_KEY?.trim() ?? '';
    if (!hmacKey) {
      console.error(
        'nrdocs delivery: HMAC_SIGNING_KEY is unset or empty — password login cannot work. ' +
          'Set the same secret on delivery and control-plane: wrangler secret put HMAC_SIGNING_KEY --env delivery',
      );
      return new Response(
        'Documentation login is unavailable (server configuration). Ask the platform operator to set HMAC_SIGNING_KEY on the delivery worker.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
      );
    }

    // Canonical site root: `/${slug}` → `/${slug}/`. Without this, browsers on the no-slash URL
    // can loop on login (form POST + redirect stays on `/slug` while content flow expects `/slug/`).
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      url.pathname === `/${siteSlug}`
    ) {
      const loc = new URL(url.toString());
      loc.pathname = `/${siteSlug}/`;
      return Response.redirect(loc.href, 308);
    }

    const sessionTtl = parseSessionTtl(env);
    const sessionCookie = getCookie(request, 'nrdocs_session');

    if (sessionCookie) {
      // Validate the session token: HMAC signature, expiry, password version
      const validation = await SessionTokenManager.validate(
        sessionCookie,
        hmacKey,
        repo.password_version,
      );
      if (validation.valid && sameRepoId(validation.repoId, repo.id)) {
        return serveContent(url, urlPathPrefix, pointer, env);
      }
      // Invalid token (expired, tampered, wrong password version) → treat as unauthenticated
      // Fall through to login flow
    }

    // No valid session — handle login flow.
    const actionUrl = url.pathname;

    if (request.method === 'POST') {
      // Process password submission (Req 5.2, 5.3, 5.4)
      const contentType = request.headers.get('Content-Type') ?? '';
      if (!contentType.includes('application/x-www-form-urlencoded')) {
        return renderLoginPage(repo.title, actionUrl, 'Invalid request.');
      }

      const formData = await request.formData();
      const submittedPassword = formData.get('password');

      if (typeof submittedPassword !== 'string' || submittedPassword.length === 0) {
        return renderLoginPage(repo.title, actionUrl, 'Password is required.');
      }

      // Rate limit check BEFORE password verification to prevent unnecessary
      // hash computation when rate-limited (Req 5.10)
      const rateLimiter = new RateLimiter(env.DB);
      const maxAttempts = parseRateLimitMax(env);
      const windowSeconds = parseRateLimitWindow(env);
      const rateLimitResult = await rateLimiter.checkAndIncrement(
        repo.id,
        maxAttempts,
        windowSeconds,
      );

      if (!rateLimitResult.allowed) {
        return new Response('Too many login attempts. Please try again later.', {
          status: 429,
          headers: {
            'Retry-After': String(rateLimitResult.retryAfterSeconds ?? windowSeconds),
            'Content-Type': 'text/plain; charset=utf-8',
          },
        });
      }

      // Retrieve stored password hash from D1
      const hashRecord = await dataStore.getPasswordHash(repo.id);
      if (!hashRecord) {
        // No password configured — cannot authenticate
        return renderLoginPage(repo.title, actionUrl, 'Authentication is not configured for this site.');
      }

      // Verify submitted password against stored hash (Req 5.2)
      const passwordValid = await PasswordHasher.verify(submittedPassword, hashRecord.hash);

      if (!passwordValid) {
        // Log failed login attempt with site slug and request metadata,
        // excluding the submitted password (Req 5.11)
        const clientIp = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'unknown';
        const userAgent = request.headers.get('User-Agent') ?? 'unknown';
        console.log(
          `Login failure: slug="${repo.slug}" ip="${clientIp}" user-agent="${userAgent}"`,
        );

        // Record login_failure operational event (Req 19.1)
        await dataStore.recordEvent({
          id: crypto.randomUUID(),
          repo_id: repo.id,
          event_type: 'login_failure',
          detail: JSON.stringify({
            slug: repo.slug,
            ip: clientIp,
            user_agent: userAgent,
          }),
          created_at: new Date().toISOString(),
        });

        // Req 5.4: re-render login page with error, do not issue token
        return renderLoginPage(repo.title, actionUrl, 'Incorrect password.');
      }

      // Password verified — issue session token (Req 5.3, 6.5)
      // Use hashRecord.version (paired with the hash we verified), not a later re-read.
      const token = await SessionTokenManager.create(
        repo.id,
        hashRecord.version,
        hmacKey,
        sessionTtl,
      );

      // Set cookie scoped to this site's URL prefix.
      // Secure: browsers ignore Secure cookies on plain-HTTP origins (e.g. wrangler dev) — omit on http.
      // Path: use `/${slug}` (no trailing slash) so both `/slug` and `/slug/...` match (RFC cookie path prefix).
      const secureAttr = url.protocol === 'https:' ? 'Secure; ' : '';
      const cookieValue =
        `nrdocs_session=${token}; ${secureAttr}HttpOnly; SameSite=Lax; Path=${urlPathPrefix}; Max-Age=${sessionTtl}`;

      // Redirect to canonical path (same as serveContent): site root must use trailing slash.
      const loc = new URL(url.toString());
      if (loc.pathname === `/${siteSlug}`) {
        loc.pathname = `/${siteSlug}/`;
      }
      const redirectTo = loc.href;
      return new Response(null, {
        status: 303,
        headers: {
          'Set-Cookie': cookieValue,
          Location: redirectTo,
        },
      });
    }

    // GET (or any other method): return login page (Req 5.1)
    return renderLoginPage(repo.title, actionUrl);
  },
};
