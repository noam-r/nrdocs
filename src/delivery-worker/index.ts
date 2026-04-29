/**
 * Delivery Worker — thin request router and authentication gate.
 *
 * Bound to `docs.example.com/*`. Resolves org + project from the path
 * (`/<org>/<project>/...` or legacy `/<project>/...` for the default org),
 * looks up the project in D1, and routes
 * the request accordingly.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 1.8, 1.9, 1.10, 13.2, 13.3, 20.1, 20.2, 20.3
 */

import { D1DataStore } from '../data-store/d1-data-store';
import { R2StorageProvider } from '../storage/r2-storage-provider';
import { PasswordHasher } from '../auth/password-hasher';
import { SessionTokenManager } from '../auth/session-token-manager';
import { RateLimiter } from '../auth/rate-limiter';

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

/**
 * Extract the value of a named cookie from the Cookie header.
 */
function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.split('=');
    if (key.trim() === name) {
      return rest.join('=').trim();
    }
  }
  return null;
}

/**
 * Render the login page HTML for a password-protected project.
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

/**
 * Common MIME types by file extension for content serving.
 */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

function pathSegments(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean);
}

/**
 * Path under the project URL prefix (content path within the site).
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
  return MIME_TYPES[ext] ?? r2ContentType ?? 'application/octet-stream';
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
    if (segments.length === 0) return notFound();

    // Disambiguate `/org/project/...` vs legacy `/project/...`:
    // If `/org/project` exists in DB, treat it as org-scoped route.
    // Otherwise, fall back to default-org `/project/...` and treat the rest as page path.
    let orgSlug: string;
    let projectSlug: string;
    let urlPathPrefix: string;
    let project = null as Awaited<ReturnType<typeof dataStore.getProjectByOrgSlugAndProjectSlug>>;

    if (segments.length >= 2) {
      const [maybeOrgSlug, maybeProjectSlug] = segments;
      const explicit = await dataStore.getProjectByOrgSlugAndProjectSlug(maybeOrgSlug, maybeProjectSlug);
      if (explicit) {
        orgSlug = maybeOrgSlug;
        projectSlug = maybeProjectSlug;
        urlPathPrefix = `/${orgSlug}/${projectSlug}`;
        project = explicit;
      } else {
        orgSlug = 'default';
        projectSlug = segments[0];
        urlPathPrefix = `/${projectSlug}`;
        project = await dataStore.getProjectByOrgSlugAndProjectSlug(orgSlug, projectSlug);
      }
    } else {
      orgSlug = 'default';
      projectSlug = segments[0];
      urlPathPrefix = `/${projectSlug}`;
      project = await dataStore.getProjectByOrgSlugAndProjectSlug(orgSlug, projectSlug);
    }

    // Unknown slug, disabled, or awaiting_approval → identical 404
    if (!project || project.status === 'disabled' || project.status === 'awaiting_approval') {
      return notFound();
    }

    // No active publish pointer → nothing to serve (Req 13.2)
    if (!project.active_publish_pointer) {
      return notFound();
    }

    const pointer = project.active_publish_pointer;

    // Access mode branching (Requirements 4.2, 7.9)
    if (project.access_mode === 'public') {
      // Public projects: serve content directly without authentication.
      // No access policy evaluation (Req 7.9).
      return serveContent(url, urlPathPrefix, pointer, env);
    }

    // Password-protected projects: authentication required (Req 4.3).
    // Requirements: 4.3, 5.1, 5.2, 5.3, 5.4, 5.8, 6.5

    const sessionTtl = parseSessionTtl(env);
    const sessionCookie = getCookie(request, 'nrdocs_session');

    if (sessionCookie) {
      // Validate the session token: HMAC signature, expiry, password version
      const validation = await SessionTokenManager.validate(
        sessionCookie,
        env.HMAC_SIGNING_KEY,
        project.password_version,
      );
      if (validation.valid) {
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
        return renderLoginPage(project.title, actionUrl, 'Invalid request.');
      }

      const formData = await request.formData();
      const submittedPassword = formData.get('password');

      if (typeof submittedPassword !== 'string' || submittedPassword.length === 0) {
        return renderLoginPage(project.title, actionUrl, 'Password is required.');
      }

      // Rate limit check BEFORE password verification to prevent unnecessary
      // hash computation when rate-limited (Req 5.10)
      const rateLimiter = new RateLimiter(env.DB);
      const maxAttempts = parseRateLimitMax(env);
      const windowSeconds = parseRateLimitWindow(env);
      const rateLimitResult = await rateLimiter.checkAndIncrement(
        project.id,
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
      const hashRecord = await dataStore.getPasswordHash(project.id);
      if (!hashRecord) {
        // No password configured — cannot authenticate
        return renderLoginPage(project.title, actionUrl, 'Authentication is not configured for this project.');
      }

      // Verify submitted password against stored hash (Req 5.2)
      const passwordValid = await PasswordHasher.verify(submittedPassword, hashRecord.hash);

      if (!passwordValid) {
        // Log failed login attempt with project slug and request metadata,
        // excluding the submitted password (Req 5.11)
        const clientIp = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'unknown';
        const userAgent = request.headers.get('User-Agent') ?? 'unknown';
        console.log(
          `Login failure: project="${project.slug}" ip="${clientIp}" user-agent="${userAgent}"`,
        );

        // Record login_failure operational event (Req 19.1)
        await dataStore.recordEvent({
          id: crypto.randomUUID(),
          project_id: project.id,
          event_type: 'login_failure',
          detail: JSON.stringify({
            slug: project.slug,
            ip: clientIp,
            user_agent: userAgent,
          }),
          created_at: new Date().toISOString(),
        });

        // Req 5.4: re-render login page with error, do not issue token
        return renderLoginPage(project.title, actionUrl, 'Incorrect password.');
      }

      // Password verified — issue session token (Req 5.3, 6.5)
      const token = await SessionTokenManager.create(
        project.id,
        hashRecord.version,
        env.HMAC_SIGNING_KEY,
        sessionTtl,
      );

      // Set cookie scoped to this project's URL prefix (includes org segment when present).
      const cookieValue = `nrdocs_session=${token}; Secure; HttpOnly; SameSite=Lax; Path=${urlPathPrefix}/; Max-Age=${sessionTtl}`;

      // Redirect to the originally requested path (Req 5.3)
      return new Response(null, {
        status: 303,
        headers: {
          'Set-Cookie': cookieValue,
          Location: url.pathname,
        },
      });
    }

    // GET (or any other method): return login page (Req 5.1)
    return renderLoginPage(project.title, actionUrl);
  },
};
