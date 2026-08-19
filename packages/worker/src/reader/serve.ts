import {
  artifactObjectKey,
  getInstanceMetadata,
  getSiteBySlug,
  type ArtifactObjectStore,
  type SiteRow,
  type SqlExecutor,
} from '@nrdocs/persistence';
import {
  foldSlugInput,
  isManifestV2,
  parseManifest,
  parseSlug,
  type ManifestV1,
  type ManifestV2,
  type RequestId,
} from '@nrdocs/contracts';
import { ApiError } from '../http.js';
import { RATE_LIMITS } from '../limits.js';
import { enforceRateLimit, type RateLimiter } from '../rate-limit.js';
import {
  attachmentContentDisposition,
  ATTACHMENT_CSP,
  baseSecurityHeaders,
  formSecurityHeaders,
  htmlSecurityHeaders,
  NO_STORE,
} from './headers.js';
import { mintCsrfToken, verifyCsrfToken } from './csrf.js';
import { validateSafeReturnPath } from './return-path.js';
import {
  mintSessionToken,
  parseSessionToken,
  readCookie,
  sessionClearCookie,
  sessionCookieName,
  sessionSetCookie,
} from './session.js';
import { passwordInputLooksPlausible, verifyReaderPassword } from './password.js';
import {
  headOf,
  htmlResponse,
  logoutFormPage,
  logoutPage,
  notFoundPage,
  passwordFormPage,
  unavailablePage,
  type PlatformLang,
} from './platform-pages.js';

export type ReaderContext = {
  db: SqlExecutor;
  store: ArtifactObjectStore;
  sessionKey: Uint8Array;
  rateLimiter: RateLimiter;
  clientIp: string;
  requestId: RequestId;
  now: () => Date;
  hsts: boolean;
};

function siteLang(site: SiteRow | null): PlatformLang {
  return {
    language: site?.current_language ?? 'und',
    direction: site?.current_direction ?? 'auto',
  };
}

export function siteIsReadable(site: SiteRow | null): site is SiteRow {
  return Boolean(site && site.enabled && site.current_artifact_id);
}

export async function loadCurrentManifest(
  store: ArtifactObjectStore,
  site: SiteRow,
): Promise<ManifestV1 | ManifestV2 | 'missing' | 'invalid'> {
  if (!site.current_artifact_id) return 'missing';
  const key = artifactObjectKey(site.id, site.current_artifact_id, 'nrdocs-manifest.json');
  const bytes = await store.get(key);
  if (!bytes) return 'missing';
  try {
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return await parseManifest(raw, { verifyArtifactDigest: false });
  } catch {
    return 'invalid';
  }
}

function normalizeSitePath(pathname: string, slug: string): string | null {
  const prefix = `/${slug}`;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
  let rest = pathname === prefix ? '/' : pathname.slice(prefix.length);
  try {
    rest = decodeURIComponent(rest);
  } catch {
    return null;
  }
  if (rest.includes('\0') || rest.includes('\\') || rest.includes('//')) return null;
  if (!rest.startsWith('/')) return null;
  if (rest === '/') return '/';

  const hadTrailingSlash = rest.length > 1 && rest.endsWith('/');
  const segs = rest.split('/').filter((p) => p.length > 0);
  if (segs.some((p) => p === '.' || p === '..')) return null;
  if (segs.length === 0) return '/';
  const joined = `/${segs.join('/')}`;
  return hadTrailingSlash ? `${joined}/` : joined;
}

export async function authorizedForPasswordSite(
  ctx: ReaderContext,
  site: SiteRow,
  request: Request,
): Promise<boolean> {
  const token = readCookie(request.headers.get('cookie'), sessionCookieName(site.id));
  if (!token) return false;
  const claims = await parseSessionToken(ctx.sessionKey, token, {
    siteId: site.id,
    generation: site.session_generation,
    now: ctx.now(),
  });
  return claims !== null;
}

export async function redirectToPassword(
  ctx: ReaderContext,
  site: SiteRow,
  returnPath: string,
): Promise<Response> {
  const safe = validateSafeReturnPath(returnPath, site.slug);
  const location = `/_nrdocs/access?site=${encodeURIComponent(site.slug)}&return=${encodeURIComponent(safe)}`;
  return new Response(null, {
    status: 302,
    headers: {
      ...htmlSecurityHeaders({ hsts: ctx.hsts }),
      location,
    },
  });
}

async function serveObject(
  ctx: ReaderContext,
  site: SiteRow,
  manifest: ManifestV1 | ManifestV2,
  siteRelativePath: string,
  method: string,
  authorized: boolean,
): Promise<Response> {
  const lang = siteLang(site);
  const pageSchema = isManifestV2(manifest) ? 2 : 1;

  for (const page of manifest.pages) {
    if (page.route === siteRelativePath) {
      const object = isManifestV2(manifest)
        ? (page as ManifestV2['pages'][number]).html.object
        : (page as ManifestV1['pages'][number]).object;
      const key = artifactObjectKey(site.id, site.current_artifact_id!, object);
      const bytes = await ctx.store.get(key);
      if (!bytes)
        return htmlResponse(unavailablePage(ctx.requestId, lang), 503, { hsts: ctx.hsts });
      const headers = new Headers(htmlSecurityHeaders({ hsts: ctx.hsts, pageSchema }));
      if (isManifestV2(manifest) && (site.access_mode === 'public' || authorized)) {
        headers.set(
          'link',
          `</_nrdocs/agent/${site.slug}/index.md>; rel="alternate"; type="text/markdown"`,
        );
      }
      if (method === 'HEAD') return new Response(null, { status: 200, headers });
      return new Response(Uint8Array.from(bytes), { status: 200, headers });
    }
  }

  for (const asset of manifest.assets) {
    if (asset.path === siteRelativePath) {
      const key = artifactObjectKey(site.id, site.current_artifact_id!, asset.object);
      const bytes = await ctx.store.get(key);
      if (!bytes)
        return htmlResponse(unavailablePage(ctx.requestId, lang), 503, { hsts: ctx.hsts });
      const headers = new Headers({
        ...baseSecurityHeaders({ hsts: ctx.hsts }),
        'cache-control': NO_STORE,
        'content-type': asset.media_type,
      });
      if (method === 'HEAD') return new Response(null, { status: 200, headers });
      return new Response(Uint8Array.from(bytes), { status: 200, headers });
    }
  }

  for (const att of manifest.attachments) {
    if (att.path === siteRelativePath) {
      const key = artifactObjectKey(site.id, site.current_artifact_id!, att.object);
      const bytes = await ctx.store.get(key);
      if (!bytes)
        return htmlResponse(unavailablePage(ctx.requestId, lang), 503, { hsts: ctx.hsts });
      const headers = new Headers({
        ...baseSecurityHeaders({ hsts: ctx.hsts }),
        'cache-control': NO_STORE,
        'content-type': att.media_type,
        'content-disposition': attachmentContentDisposition(att.filename),
        'content-security-policy': ATTACHMENT_CSP,
      });
      if (method === 'HEAD') return new Response(null, { status: 200, headers });
      return new Response(Uint8Array.from(bytes), { status: 200, headers });
    }
  }

  if (!siteRelativePath.endsWith('/')) {
    const withSlash = `${siteRelativePath}/`;
    if (manifest.pages.some((p) => p.route === withSlash)) {
      return new Response(null, {
        status: 308,
        headers: {
          ...htmlSecurityHeaders({ hsts: ctx.hsts }),
          location: `/${site.slug}${withSlash}`,
        },
      });
    }
  }

  return htmlResponse(notFoundPage(lang), 404, { hsts: ctx.hsts });
}

async function handleSiteContentInner(
  request: Request,
  ctx: ReaderContext,
  slug: string,
  pathname: string,
): Promise<Response> {
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    return htmlResponse(notFoundPage(), 405, { hsts: ctx.hsts });
  }

  if (pathname === `/${slug}`) {
    return new Response(null, {
      status: 308,
      headers: {
        ...htmlSecurityHeaders({ hsts: ctx.hsts }),
        location: `/${slug}/`,
      },
    });
  }

  const site = await getSiteBySlug(ctx.db, slug);
  if (!siteIsReadable(site)) {
    return htmlResponse(notFoundPage(siteLang(site)), 404, { hsts: ctx.hsts });
  }

  if (site.access_mode === 'password') {
    const ok = await authorizedForPasswordSite(ctx, site, request);
    if (!ok) {
      const sitePath = normalizeSitePath(pathname, slug) ?? '/';
      const returnPath = sitePath === '/' ? `/${slug}/` : `/${slug}${sitePath}`;
      return redirectToPassword(ctx, site, returnPath);
    }
  }

  const manifest = await loadCurrentManifest(ctx.store, site);
  if (manifest === 'missing' || manifest === 'invalid') {
    return htmlResponse(unavailablePage(ctx.requestId, siteLang(site)), 503, { hsts: ctx.hsts });
  }

  const sitePath = normalizeSitePath(pathname, slug);
  if (sitePath === null) {
    return htmlResponse(notFoundPage(siteLang(site)), 404, { hsts: ctx.hsts });
  }

  if (sitePath === '/' && manifest.site.root.kind === 'redirect') {
    return new Response(null, {
      status: 308,
      headers: {
        ...htmlSecurityHeaders({ hsts: ctx.hsts }),
        location: `/${site.slug}${manifest.site.root.route}`,
      },
    });
  }

  const authorized =
    site.access_mode === 'public' || (await authorizedForPasswordSite(ctx, site, request));
  return serveObject(ctx, site, manifest, sitePath, method, authorized);
}

export async function handleSiteContent(
  request: Request,
  ctx: ReaderContext,
  slug: string,
  pathname: string,
): Promise<Response> {
  const response = await handleSiteContentInner(request, ctx, slug, pathname);
  return request.method === 'HEAD' ? headOf(response) : response;
}

function parseForm(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of body.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawVal = eq === -1 ? '' : part.slice(eq + 1);
    let key: string;
    let val: string;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      val = decodeURIComponent(rawVal.replace(/\+/g, ' '));
    } catch {
      continue;
    }
    if (!out.has(key)) out.set(key, val);
  }
  return out;
}

function originMatches(request: Request, canonicalOrigin: string): boolean {
  const origin = request.headers.get('origin');
  const requestOrigin = new URL(request.url).origin;
  let canonical: string;
  try {
    canonical = new URL(canonicalOrigin).origin;
  } catch {
    canonical = requestOrigin;
  }
  if (!origin) {
    const referer = request.headers.get('referer');
    if (!referer) {
      // Classic HTML form POST often omits Origin; Referer may be suppressed by
      // Referrer-Policy. Modern browsers still send Sec-Fetch-Site.
      const secFetchSite = request.headers.get('sec-fetch-site');
      return secFetchSite === 'same-origin';
    }
    try {
      const refererOrigin = new URL(referer).origin;
      return refererOrigin === requestOrigin || refererOrigin === canonical;
    } catch {
      return false;
    }
  }
  try {
    const postedOrigin = new URL(origin).origin;
    if (postedOrigin === requestOrigin) return true;
    return postedOrigin === canonical;
  } catch {
    return false;
  }
}

function forbidden(ctx: ReaderContext): Response {
  return new Response('Forbidden', {
    status: 403,
    headers: {
      ...htmlSecurityHeaders({ hsts: ctx.hsts }),
      'content-type': 'text/plain; charset=utf-8',
    },
  });
}

export async function handleAccessGet(request: Request, ctx: ReaderContext): Promise<Response> {
  const url = new URL(request.url);
  const slug = parseSlug(foldSlugInput(url.searchParams.get('site') ?? ''));
  if (!slug) return htmlResponse(notFoundPage(), 404, { hsts: ctx.hsts });
  const site = await getSiteBySlug(ctx.db, slug);
  if (!siteIsReadable(site) || site.access_mode !== 'password') {
    return htmlResponse(notFoundPage(siteLang(site)), 404, { hsts: ctx.hsts });
  }
  const returnPath = validateSafeReturnPath(url.searchParams.get('return'), slug);
  const csrf = await mintCsrfToken(ctx.sessionKey, {
    action: 'access',
    siteId: site.id,
    returnPath,
    now: ctx.now(),
  });
  return htmlResponse(passwordFormPage({ lang: siteLang(site), slug, returnPath, csrf }), 200, {
    hsts: ctx.hsts,
    headers: formSecurityHeaders({ hsts: ctx.hsts }),
  });
}

export async function handleAccessPost(request: Request, ctx: ReaderContext): Promise<Response> {
  const meta = await getInstanceMetadata(ctx.db);
  if (!originMatches(request, meta.canonical_origin)) return forbidden(ctx);
  const ct = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (ct !== 'application/x-www-form-urlencoded') return forbidden(ctx);
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 4096) return forbidden(ctx);

  const form = parseForm(rawBody);
  const allowed = new Set(['site', 'return', 'csrf', 'password']);
  for (const key of form.keys()) {
    if (!allowed.has(key)) return forbidden(ctx);
  }
  for (const req of ['site', 'return', 'csrf', 'password']) {
    if (!form.has(req)) return forbidden(ctx);
  }

  const slug = parseSlug(foldSlugInput(form.get('site')!));
  if (!slug) return htmlResponse(notFoundPage(), 404, { hsts: ctx.hsts });
  const site = await getSiteBySlug(ctx.db, slug);
  if (!siteIsReadable(site) || site.access_mode !== 'password' || !site.password_verifier) {
    return htmlResponse(notFoundPage(siteLang(site)), 404, { hsts: ctx.hsts });
  }

  const returnPath = validateSafeReturnPath(form.get('return'), slug);

  try {
    await enforceRateLimit(
      ctx.rateLimiter,
      ['pwd-ip', site.id, ctx.clientIp],
      RATE_LIMITS.passwordPerSiteIp.limit,
      RATE_LIMITS.passwordPerSiteIp.windowMs,
    );
    await enforceRateLimit(
      ctx.rateLimiter,
      ['pwd-site', site.id],
      RATE_LIMITS.passwordPerSite.limit,
      RATE_LIMITS.passwordPerSite.windowMs,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      const headers = new Headers(htmlSecurityHeaders({ hsts: ctx.hsts }));
      headers.set('retry-after', String(RATE_LIMITS.retryAfterSeconds));
      return new Response(unavailablePage(ctx.requestId, siteLang(site)), {
        status: 429,
        headers,
      });
    }
    throw error;
  }

  const csrfOk = await verifyCsrfToken(ctx.sessionKey, form.get('csrf')!, {
    action: 'access',
    siteId: site.id,
    returnPath,
    now: ctx.now(),
  });
  if (!csrfOk) return forbidden(ctx);

  const password = form.get('password')!;
  const ok =
    passwordInputLooksPlausible(password) &&
    (await verifyReaderPassword(password, site.password_verifier));

  if (!ok) {
    const csrf = await mintCsrfToken(ctx.sessionKey, {
      action: 'access',
      siteId: site.id,
      returnPath,
      now: ctx.now(),
    });
    return htmlResponse(
      passwordFormPage({ lang: siteLang(site), slug, returnPath, csrf, wrong: true }),
      200,
      { hsts: ctx.hsts, headers: formSecurityHeaders({ hsts: ctx.hsts }) },
    );
  }

  const token = await mintSessionToken(ctx.sessionKey, {
    siteId: site.id,
    generation: site.session_generation,
    now: ctx.now(),
  });
  return new Response(null, {
    status: 303,
    headers: {
      ...htmlSecurityHeaders({ hsts: ctx.hsts }),
      location: returnPath,
      'set-cookie': sessionSetCookie(site.id, token),
    },
  });
}

export async function handleLogoutGet(request: Request, ctx: ReaderContext): Promise<Response> {
  const url = new URL(request.url);
  const slug = parseSlug(foldSlugInput(url.searchParams.get('site') ?? ''));
  if (!slug) return htmlResponse(notFoundPage(), 404, { hsts: ctx.hsts });
  const site = await getSiteBySlug(ctx.db, slug);
  if (!site) return htmlResponse(notFoundPage(), 404, { hsts: ctx.hsts });
  const returnPath = `/${slug}/`;
  const csrf = await mintCsrfToken(ctx.sessionKey, {
    action: 'logout',
    siteId: site.id,
    returnPath,
    now: ctx.now(),
  });
  return htmlResponse(logoutFormPage({ lang: siteLang(site), slug, csrf }), 200, {
    hsts: ctx.hsts,
    headers: formSecurityHeaders({ hsts: ctx.hsts }),
  });
}

export async function handleLogoutPost(request: Request, ctx: ReaderContext): Promise<Response> {
  const meta = await getInstanceMetadata(ctx.db);
  if (!originMatches(request, meta.canonical_origin)) return forbidden(ctx);
  const ct = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (ct !== 'application/x-www-form-urlencoded') return forbidden(ctx);
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 4096) return forbidden(ctx);

  const form = parseForm(rawBody);
  const allowed = new Set(['site', 'csrf']);
  for (const key of form.keys()) {
    if (!allowed.has(key)) return forbidden(ctx);
  }
  for (const req of ['site', 'csrf']) {
    if (!form.has(req)) return forbidden(ctx);
  }

  const slug = parseSlug(foldSlugInput(form.get('site')!));
  if (!slug) return htmlResponse(notFoundPage(), 404, { hsts: ctx.hsts });
  const site = await getSiteBySlug(ctx.db, slug);
  const returnPath = `/${slug}/`;
  if (!site) return htmlResponse(notFoundPage(), 404, { hsts: ctx.hsts });

  const csrfOk = await verifyCsrfToken(ctx.sessionKey, form.get('csrf')!, {
    action: 'logout',
    siteId: site.id,
    returnPath,
    now: ctx.now(),
  });
  if (!csrfOk) return forbidden(ctx);

  return htmlResponse(logoutPage({ lang: siteLang(site), slug }), 200, {
    hsts: ctx.hsts,
    setCookie: sessionClearCookie(site.id),
  });
}
