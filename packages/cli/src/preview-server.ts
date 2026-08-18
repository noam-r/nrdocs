import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ManifestV1 } from '@nrdocs/contracts';
import type { InMemoryArtifact } from '@nrdocs/renderer';
import { ioError } from './errors.js';
import { PLATFORM_LOGO_SVG } from './platform-logo.js';

export const PREVIEW_PORT_START = 4173;
export const PREVIEW_PORT_END = 4273;

const PLATFORM_CSS = `/* nrdocs preview stub reader.css */
body{font-family:system-ui,sans-serif;margin:0}
.nr-site-title{display:flex;align-items:center;gap:.55rem;color:inherit;text-decoration:none;font-weight:650}
.nr-site-title::before{content:"";flex:0 0 auto;width:3.02rem;height:1.65rem;background-color:currentColor;-webkit-mask:url("/_nrdocs/v1/logo.svg") center / contain no-repeat;mask:url("/_nrdocs/v1/logo.svg") center / contain no-repeat;mask-mode:alpha}
.nr-broken-link{color:#b3261e;text-decoration:line-through;cursor:help}
.nr-broken-link::after{content:" \\26D4";text-decoration:none}
`;
const PLATFORM_JS = `/* nrdocs preview stub reader.js */\n`;
const PLATFORM_MERMAID = `/* nrdocs preview stub mermaid.js */\nexport default {};\n`;

const CACHE_NO_STORE = 'private, no-store';

type RouteEntry =
  | { kind: 'html'; bytes: Uint8Array }
  | { kind: 'asset'; bytes: Uint8Array; mediaType: string }
  | {
      kind: 'attachment';
      bytes: Uint8Array;
      mediaType: string;
      filename: string;
    }
  | { kind: 'platform'; bytes: Uint8Array; mediaType: string };

export type PreviewServer = {
  url: string;
  port: number;
  host: string;
  close(): Promise<void>;
};

/** Normalize a request pathname; reject escapes. Preserves a trailing slash. */
export function normalizeRequestPath(urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/')) return null;
  if (decoded.includes('\0')) return null;

  const hadTrailingSlash = decoded.length > 1 && decoded.endsWith('/');
  const parts = decoded.split('/').filter((p) => p.length > 0);
  if (parts.some((p) => p === '.' || p === '..')) return null;

  if (parts.length === 0) return '/';
  const joined = `/${parts.join('/')}`;
  return hadTrailingSlash ? `${joined}/` : joined;
}

function sanitizeAttachmentBasename(filename: string): string {
  let out = '';
  for (const ch of filename) {
    const code = ch.codePointAt(0)!;
    if (
      code < 0x20 ||
      code === 0x7f ||
      ch === '"' ||
      ch === "'" ||
      ch === '/' ||
      ch === '\\' ||
      ch === ':' ||
      // bidi controls
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      continue;
    }
    out += ch;
  }
  return out.length > 0 ? out : 'download';
}

/** Spec: filename="download" plus RFC 5987 filename* from declared basename. */
export function attachmentContentDisposition(filename: string): string {
  const safe = sanitizeAttachmentBasename(filename);
  const encoded = encodeURIComponent(safe).replace(
    /['()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="download"; filename*=UTF-8''${encoded}`;
}

function buildRouteTable(artifact: InMemoryArtifact): {
  routes: Map<string, RouteEntry>;
  redirectTo: string | null;
} {
  const routes = new Map<string, RouteEntry>();
  const byObject = new Map(artifact.files.map((f) => [f.objectPath, f.bytes]));

  for (const page of artifact.manifest.pages) {
    const bytes = byObject.get(page.object);
    if (!bytes) continue;
    routes.set(page.route, { kind: 'html', bytes });
  }
  for (const asset of artifact.manifest.assets) {
    const bytes = byObject.get(asset.object);
    if (!bytes) continue;
    routes.set(asset.path, { kind: 'asset', bytes, mediaType: asset.media_type });
  }
  for (const att of artifact.manifest.attachments) {
    const bytes = byObject.get(att.object);
    if (!bytes) continue;
    routes.set(att.path, {
      kind: 'attachment',
      bytes,
      mediaType: att.media_type,
      filename: att.filename,
    });
  }

  const enc = new TextEncoder();
  routes.set('/_nrdocs/v1/reader.css', {
    kind: 'platform',
    bytes: enc.encode(PLATFORM_CSS),
    mediaType: 'text/css; charset=utf-8',
  });
  routes.set('/_nrdocs/v1/reader.js', {
    kind: 'platform',
    bytes: enc.encode(PLATFORM_JS),
    mediaType: 'text/javascript; charset=utf-8',
  });
  routes.set('/_nrdocs/v1/mermaid.js', {
    kind: 'platform',
    bytes: enc.encode(PLATFORM_MERMAID),
    mediaType: 'text/javascript; charset=utf-8',
  });
  routes.set('/_nrdocs/v1/logo.svg', {
    kind: 'platform',
    bytes: enc.encode(PLATFORM_LOGO_SVG),
    mediaType: 'image/svg+xml; charset=utf-8',
  });
  routes.set('/favicon.ico', {
    kind: 'platform',
    bytes: enc.encode(PLATFORM_LOGO_SVG),
    mediaType: 'image/svg+xml; charset=utf-8',
  });

  const redirectTo =
    artifact.manifest.site.root.kind === 'redirect' ? artifact.manifest.site.root.route : null;

  return { routes, redirectTo };
}

export async function listenPreviewServer(
  artifact: InMemoryArtifact,
  options: { host?: string; portStart?: number; portEnd?: number } = {},
): Promise<PreviewServer> {
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1') {
    throw ioError('Preview may bind only to 127.0.0.1.');
  }
  const portStart = options.portStart ?? PREVIEW_PORT_START;
  const portEnd = options.portEnd ?? PREVIEW_PORT_END;
  const { routes, redirectTo } = buildRouteTable(artifact);

  const server = http.createServer((req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': CACHE_NO_STORE });
        res.end();
        return;
      }
      const hostHeader = req.headers.host ?? `${host}`;
      const rawUrl = new URL(req.url ?? '/', `http://${hostHeader}`);
      const pathname = normalizeRequestPath(rawUrl.pathname);
      if (pathname === null) {
        res.writeHead(400, { 'Cache-Control': CACHE_NO_STORE });
        res.end('Bad request');
        return;
      }

      // Canonical trailing slash for page-like paths without a file extension.
      if (
        pathname !== '/' &&
        !pathname.endsWith('/') &&
        !pathname.includes('.') &&
        !pathname.startsWith('/_nrdocs/')
      ) {
        res.writeHead(308, {
          Location: `${pathname}/`,
          'Cache-Control': CACHE_NO_STORE,
        });
        res.end();
        return;
      }

      if (pathname === '/' && redirectTo) {
        res.writeHead(308, { Location: redirectTo, 'Cache-Control': CACHE_NO_STORE });
        res.end();
        return;
      }

      const entry = routes.get(pathname);
      if (!entry) {
        res.writeHead(404, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': CACHE_NO_STORE,
        });
        if (req.method !== 'HEAD') res.end('Not found');
        else res.end();
        return;
      }

      const headers: Record<string, string | number> = {
        'Cache-Control': CACHE_NO_STORE,
        'Content-Length': entry.bytes.byteLength,
        'X-Content-Type-Options': 'nosniff',
      };

      if (entry.kind === 'html') {
        headers['Content-Type'] = 'text/html; charset=utf-8';
      } else if (entry.kind === 'asset' || entry.kind === 'platform') {
        headers['Content-Type'] = entry.mediaType;
      } else {
        headers['Content-Type'] = entry.mediaType;
        headers['Content-Disposition'] = attachmentContentDisposition(entry.filename);
      }

      res.writeHead(200, headers);
      if (req.method === 'HEAD') res.end();
      else res.end(Buffer.from(entry.bytes));
    } catch {
      res.writeHead(500, { 'Cache-Control': CACHE_NO_STORE });
      res.end('Internal error');
    }
  });

  const port = await bindLoopback(server, host, portStart, portEnd);
  const url = `http://${host}:${port}/`;

  return {
    url,
    port,
    host,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function bindLoopback(
  server: http.Server,
  host: string,
  portStart: number,
  portEnd: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = portStart;

    const tryListen = () => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        if (err.code === 'EADDRINUSE' && port < portEnd) {
          port += 1;
          tryListen();
          return;
        }
        if (err.code === 'EADDRINUSE') {
          reject(
            ioError(
              `No free preview port on 127.0.0.1 between ${portStart} and ${portEnd}.\nStop other local servers and retry.`,
            ),
          );
          return;
        }
        reject(ioError(`Unable to start preview server:\n  ${err.message}`));
      };
      const onListening = () => {
        server.off('error', onError);
        const addr = server.address() as AddressInfo;
        resolve(addr.port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    };

    tryListen();
  });
}

export function summarizeManifest(manifest: ManifestV1): string {
  return [
    `Pages:       ${String(manifest.pages.length).padStart(2)}`,
    `Images:      ${String(manifest.assets.length).padStart(2)}`,
    `Attachments: ${String(manifest.attachments.length).padStart(2)}`,
  ].join('\n');
}
