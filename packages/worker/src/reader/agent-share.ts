import { getSiteBySlug } from '@nrdocs/persistence';
import {
  AGENT_SHARE_DEFAULT_DURATION,
  AGENT_SHARE_DURATION_LABELS,
  AGENT_SHARE_POST_MAX_BYTES,
  AGENT_SHARE_RATE_INSTANCE,
  AGENT_SHARE_RATE_SITE_IP,
  isManifestV2,
  parseAgentShareDuration,
  parseSlug,
} from '@nrdocs/contracts';
import { enforceRateLimit } from '../rate-limit.js';
import { resolveCanonicalOrigin } from '../canonical-origin.js';
import { agentShareJsonHeaders } from './headers.js';
import { htmlResponse, notFoundPage, unavailablePage } from './platform-pages.js';
import { mintCsrfToken, verifyCsrfToken } from './csrf.js';
import { mintAgentGrant, shareInstructions } from './grant.js';
import {
  authorizedForPasswordSite,
  loadCurrentManifest,
  siteIsReadable,
  type ReaderContext,
} from './serve.js';

function jsonResponse(ctx: ReaderContext, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: agentShareJsonHeaders({ hsts: ctx.hsts }),
  });
}

function notFound(ctx: ReaderContext): Response {
  return htmlResponse(notFoundPage(), 404, { hsts: ctx.hsts });
}

export async function handleAgentShareGet(
  request: Request,
  ctx: ReaderContext,
  env: { NRDOCS_CANONICAL_ORIGIN?: string },
): Promise<Response> {
  const url = new URL(request.url);
  const slug = parseSlug(url.searchParams.get('site') ?? '');
  if (!slug) return notFound(ctx);
  const origin = resolveCanonicalOrigin(env);
  if (!origin) return htmlResponse(unavailablePage(ctx.requestId), 503, { hsts: ctx.hsts });
  const site = await getSiteBySlug(ctx.db, slug);
  if (!siteIsReadable(site)) return notFound(ctx);
  const manifest = await loadCurrentManifest(ctx.store, site);
  if (manifest === 'missing' || manifest === 'invalid' || !isManifestV2(manifest)) {
    return notFound(ctx);
  }
  if (site.access_mode === 'public') {
    const entry_url = `${origin}/_nrdocs/agent/${site.slug}/index.md`;
    return jsonResponse(ctx, {
      site_title: manifest.site.title,
      access_mode: 'public',
      entry_url,
      expires_at: null,
      instructions: shareInstructions(entry_url, null),
      allowed_durations: [],
    });
  }
  const ok = await authorizedForPasswordSite(ctx, site, request);
  if (!ok) return notFound(ctx);
  const csrf = await mintCsrfToken(ctx.sessionKey, {
    action: 'agent-share',
    siteId: site.id,
    generation: site.session_generation,
    now: ctx.now(),
  });
  return jsonResponse(ctx, {
    site_title: manifest.site.title,
    access_mode: 'password',
    default_duration: AGENT_SHARE_DEFAULT_DURATION,
    allowed_durations: [...AGENT_SHARE_DURATION_LABELS],
    csrf,
  });
}

export async function handleAgentSharePost(
  request: Request,
  ctx: ReaderContext,
  env: { NRDOCS_CANONICAL_ORIGIN?: string },
): Promise<Response> {
  const origin = resolveCanonicalOrigin(env);
  if (!origin) return htmlResponse(unavailablePage(ctx.requestId), 503, { hsts: ctx.hsts });
  const posted = request.headers.get('origin');
  if (!posted) return notFound(ctx);
  try {
    if (new URL(posted).origin !== origin) return notFound(ctx);
  } catch {
    return notFound(ctx);
  }
  const ct = (request.headers.get('content-type') ?? '').toLowerCase().replace(/\s+/g, '');
  if (ct !== 'application/json;charset=utf-8' && ct !== 'application/json') return notFound(ctx);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.byteLength > AGENT_SHARE_POST_MAX_BYTES) return notFound(ctx);
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buf));
  } catch {
    return notFound(ctx);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return notFound(ctx);
  const rec = body as Record<string, unknown>;
  const keys = Object.keys(rec);
  if (
    keys.length !== 3 ||
    !keys.includes('site') ||
    !keys.includes('duration') ||
    !keys.includes('csrf')
  ) {
    return notFound(ctx);
  }
  const slug = parseSlug(typeof rec.site === 'string' ? rec.site : '');
  const duration = parseAgentShareDuration(rec.duration);
  if (!slug || !duration || typeof rec.csrf !== 'string') return notFound(ctx);

  const site = await getSiteBySlug(ctx.db, slug);
  await enforceRateLimit(
    ctx.rateLimiter,
    ['agent-share-ip', site?.id ?? 'unknown', ctx.clientIp],
    AGENT_SHARE_RATE_SITE_IP.limit,
    AGENT_SHARE_RATE_SITE_IP.windowMs,
  );
  await enforceRateLimit(
    ctx.rateLimiter,
    ['agent-share-instance'],
    AGENT_SHARE_RATE_INSTANCE.limit,
    AGENT_SHARE_RATE_INSTANCE.windowMs,
  );

  if (!siteIsReadable(site) || site.access_mode !== 'password') return notFound(ctx);
  const manifest = await loadCurrentManifest(ctx.store, site);
  if (manifest === 'missing' || manifest === 'invalid' || !isManifestV2(manifest)) {
    return notFound(ctx);
  }
  const sessionOk = await authorizedForPasswordSite(ctx, site, request);
  if (!sessionOk) return notFound(ctx);
  const csrfOk = await verifyCsrfToken(ctx.sessionKey, rec.csrf, {
    action: 'agent-share',
    siteId: site.id,
    generation: site.session_generation,
    now: ctx.now(),
  });
  if (!csrfOk) return notFound(ctx);
  const minted = await mintAgentGrant(ctx.sessionKey, {
    siteId: site.id,
    generation: site.session_generation,
    duration,
    now: ctx.now(),
  });
  const entry_url = `${origin}/_nrdocs/agent/share/${minted.token}/index.md`;
  return jsonResponse(ctx, {
    entry_url,
    expires_at: minted.expiresAt,
    instructions: shareInstructions(entry_url, minted.expiresAt),
  });
}
