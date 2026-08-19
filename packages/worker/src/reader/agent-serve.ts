import { artifactObjectKey, getSiteById, getSiteBySlug, type SiteRow } from '@nrdocs/persistence';
import { foldSlugInput, isManifestV2, parseSlug, type ManifestV2 } from '@nrdocs/contracts';
import { sha256Hex } from '@nrdocs/contracts';
import {
  agentContentHeaders,
  attachmentContentDisposition,
  ATTACHMENT_CSP,
  htmlSecurityHeaders,
} from './headers.js';
import { notFoundPage, unavailablePage, htmlResponse } from './platform-pages.js';
import {
  authorizedForPasswordSite,
  loadCurrentManifest,
  siteIsReadable,
  type ReaderContext,
} from './serve.js';
import { verifyAgentGrantToken } from './grant.js';

function notFound(ctx: ReaderContext): Response {
  return htmlResponse(notFoundPage(), 404, { hsts: ctx.hsts });
}

function methodNotAllowed(ctx: ReaderContext): Response {
  return htmlResponse(notFoundPage(), 405, { hsts: ctx.hsts });
}

async function objectMatches(
  ctx: ReaderContext,
  site: SiteRow,
  object: string,
  size: number,
  sha256: string,
): Promise<'ok' | 'missing' | 'mismatch'> {
  const key = artifactObjectKey(site.id, site.current_artifact_id!, object);
  const bytes = await ctx.store.get(key);
  if (!bytes) return 'missing';
  if (bytes.byteLength !== size) return 'mismatch';
  const hex = await sha256Hex(bytes);
  if (hex !== sha256) return 'mismatch';
  return 'ok';
}

async function serveDeclared(
  ctx: ReaderContext,
  site: SiteRow,
  object: string,
  size: number,
  sha256: string,
  contentType: string,
  method: string,
  extra?: Record<string, string>,
): Promise<Response> {
  const match = await objectMatches(ctx, site, object, size, sha256);
  if (match !== 'ok') {
    return htmlResponse(unavailablePage(ctx.requestId), 503, { hsts: ctx.hsts });
  }
  const key = artifactObjectKey(site.id, site.current_artifact_id!, object);
  const bytes = await ctx.store.get(key);
  if (!bytes) return htmlResponse(unavailablePage(ctx.requestId), 503, { hsts: ctx.hsts });
  const headers = new Headers({
    ...agentContentHeaders({ hsts: ctx.hsts, contentType }),
    ...extra,
  });
  if (method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(Uint8Array.from(bytes), { status: 200, headers });
}

async function serveAgentRest(
  ctx: ReaderContext,
  site: SiteRow,
  manifest: ManifestV2,
  rest: string,
  method: string,
): Promise<Response> {
  if (rest === 'index.md' || rest === 'index.md/') {
    return serveDeclared(
      ctx,
      site,
      manifest.agent.index.object,
      manifest.agent.index.size,
      manifest.agent.index.sha256,
      'text/markdown; charset=utf-8',
      method,
    );
  }
  if (rest === 'manifest.json' || rest === 'manifest.json/') {
    return serveDeclared(
      ctx,
      site,
      manifest.agent.manifest.object,
      manifest.agent.manifest.size,
      manifest.agent.manifest.sha256,
      'application/json; charset=utf-8',
      method,
    );
  }
  if (rest === 'all.md' || rest === 'all.md/') {
    if (!manifest.agent.all) return notFound(ctx);
    return serveDeclared(
      ctx,
      site,
      manifest.agent.all.object,
      manifest.agent.all.size,
      manifest.agent.all.sha256,
      'text/markdown; charset=utf-8',
      method,
    );
  }
  const pageMatch = /^pages\/([0-9a-f]{32})\.md\/?$/.exec(rest);
  if (pageMatch) {
    const page = manifest.pages.find((p) => p.id === pageMatch[1]);
    if (!page) return notFound(ctx);
    return serveDeclared(
      ctx,
      site,
      page.markdown.object,
      page.markdown.size,
      page.markdown.sha256,
      'text/markdown; charset=utf-8',
      method,
    );
  }
  const assetMatch = /^assets\/([0-9a-f]{32})\/([^/]+)$/.exec(rest);
  if (assetMatch) {
    const asset = manifest.assets.find(
      (a) =>
        a.agent.id === assetMatch[1] &&
        a.agent.route === `assets/${assetMatch[1]}/${assetMatch[2]}`,
    );
    if (!asset) return notFound(ctx);
    return serveDeclared(
      ctx,
      site,
      asset.object,
      asset.size,
      asset.sha256,
      asset.media_type,
      method,
    );
  }
  const attMatch = /^attachments\/([0-9a-f]{32})\/([^/]+)$/.exec(rest);
  if (attMatch) {
    const att = manifest.attachments.find(
      (a) =>
        a.agent.id === attMatch[1] && a.agent.route === `attachments/${attMatch[1]}/${attMatch[2]}`,
    );
    if (!att) return notFound(ctx);
    return serveDeclared(ctx, site, att.object, att.size, att.sha256, att.media_type, method, {
      'content-disposition': attachmentContentDisposition(att.filename),
      'content-security-policy': ATTACHMENT_CSP,
    });
  }
  return notFound(ctx);
}

export async function handleAgentGrantRoute(
  request: Request,
  ctx: ReaderContext,
  pathname: string,
): Promise<Response> {
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(ctx);
  const prefix = '/_nrdocs/agent/share/';
  if (!pathname.startsWith(prefix)) return notFound(ctx);
  const restPath = pathname.slice(prefix.length);
  const slash = restPath.indexOf('/');
  if (slash <= 0) return notFound(ctx);
  const grant = restPath.slice(0, slash);
  const rest = restPath.slice(slash + 1);
  const payload = await verifyAgentGrantToken(ctx.sessionKey, grant, ctx.now());
  if (!payload) return notFound(ctx);
  const site = await getSiteById(ctx.db, payload.site_id);
  if (!siteIsReadable(site) || site.session_generation !== payload.generation) return notFound(ctx);
  const manifest = await loadCurrentManifest(ctx.store, site);
  if (manifest === 'missing' || manifest === 'invalid' || !isManifestV2(manifest)) {
    return notFound(ctx);
  }
  return serveAgentRest(ctx, site, manifest, rest, method);
}

export async function handleAgentCleanRoute(
  request: Request,
  ctx: ReaderContext,
  pathname: string,
): Promise<Response> {
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(ctx);
  const prefix = '/_nrdocs/agent/';
  if (!pathname.startsWith(prefix)) return notFound(ctx);
  const restPath = pathname.slice(prefix.length);
  const slash = restPath.indexOf('/');
  if (slash <= 0) return notFound(ctx);
  const slugCandidate = restPath.slice(0, slash);
  const rest = restPath.slice(slash + 1);
  const slug = parseSlug(foldSlugInput(slugCandidate));
  if (!slug) return notFound(ctx);
  if (slugCandidate !== slug) {
    return new Response(null, {
      status: 308,
      headers: {
        ...htmlSecurityHeaders({ hsts: ctx.hsts }),
        location: `/_nrdocs/agent/${slug}/${rest}`,
      },
    });
  }
  const site = await getSiteBySlug(ctx.db, slug);
  if (!siteIsReadable(site)) return notFound(ctx);
  if (site.access_mode === 'password') {
    const ok = await authorizedForPasswordSite(ctx, site, request);
    if (!ok) return notFound(ctx);
  }
  const manifest = await loadCurrentManifest(ctx.store, site);
  if (manifest === 'missing' || manifest === 'invalid' || !isManifestV2(manifest)) {
    return notFound(ctx);
  }
  return serveAgentRest(ctx, site, manifest, rest, method);
}
