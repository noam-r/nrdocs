import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ManifestV1, ManifestV2 } from '@nrdocs/contracts';
import { shareInstructions } from '@nrdocs/contracts';
import type { InMemoryArtifact } from '@nrdocs/renderer';
import { ioError } from './errors.js';
import { PLATFORM_LOGO_SVG } from './platform-logo.js';

export const PREVIEW_PORT_START = 4173;
export const PREVIEW_PORT_END = 4273;

const PLATFORM_CSS = `/* nrdocs preview stub reader.css */
.nr-header{display:flex;align-items:center;gap:.65rem;padding:.6rem 1rem;border-bottom:1px solid #e2e2e2;background:#fff}
.nr-site-title{flex:1}
.nr-site-title{display:flex;align-items:center;gap:.55rem;color:inherit;text-decoration:none;font-weight:650}
.nr-site-title::before{content:"";flex:0 0 auto;width:3.02rem;height:1.65rem;background-color:currentColor;-webkit-mask:url("/_nrdocs/v1/logo.svg") center / contain no-repeat;mask:url("/_nrdocs/v1/logo.svg") center / contain no-repeat;mask-mode:alpha}
.nr-broken-link{color:#b3261e;text-decoration:line-through;cursor:help}
.nr-broken-link::after{content:" \\26D4";text-decoration:none}
.nr-ai-share.nr-icon-btn{
  position:relative;flex:0 0 2.25rem;width:2.25rem;height:2.25rem;margin:0;padding:0;
  border:1px solid #ccc;border-radius:.55rem;background:#fff;color:transparent;
  overflow:hidden;text-indent:2.5rem;white-space:nowrap;cursor:pointer
}
.nr-ai-share.nr-icon-btn::before{content:"";position:absolute;inset:0;margin:auto;width:.16rem;height:.78rem;background:#1a1a1a}
.nr-ai-share.nr-icon-btn::after{content:"";position:absolute;inset:0;margin:auto;width:.78rem;height:.16rem;background:#1a1a1a}
.nr-ai-dialog{max-width:32rem;padding:1.35rem 1.4rem;font-family:system-ui,sans-serif;border:1px solid #e2e2e2;border-radius:.75rem;background:#fff;color:#1a1a1a}
.nr-ai-dialog h2{margin:0 0 .65rem;font-size:1.2rem}
.nr-ai-dialog p{margin:0 0 .8rem;color:#5a5a5a;line-height:1.45}
.nr-ai-lead{color:#1a1a1a}
.nr-ai-actions{display:flex;gap:.5rem;justify-content:flex-end;margin-top:.25rem}
.nr-ai-btn{font:inherit;font-weight:650;border-radius:.5rem;padding:.65rem .95rem;cursor:pointer}
.nr-ai-btn-primary{border:0;background:#0b57d0;color:#fff}
.nr-ai-btn-secondary{border:1px solid #e2e2e2;background:#fafafa;color:#1a1a1a}
.nr-ai-error{color:#b3261e}
.nr-ai-status{color:#1a1a1a;font-weight:650}
.nr-ai-choice{display:flex;align-items:center;gap:.6rem;margin:0 0 .4rem;padding:.55rem .7rem;border:1px solid #e2e2e2;border-radius:.5rem;cursor:pointer;font:inherit}
.nr-ai-choice input{accent-color:#0b57d0;margin:0}
`;
const PLATFORM_JS = `/* nrdocs preview stub reader.js */\n`;
const PLATFORM_JS_V2 = `${PLATFORM_JS}
(() => {
  const button = document.querySelector('.nr-ai-share');
  if (!button || !(button instanceof HTMLButtonElement)) return;
  let dialog = null;
  let lastActive = null;
  const closeDialog = () => {
    if (!dialog) return;
    const box = dialog.querySelector('textarea');
    if (box) { box.value = ''; box.remove(); }
    if (typeof dialog.close === 'function') dialog.close();
    dialog.remove();
    dialog = null;
    if (lastActive) lastActive.focus();
  };
  const showError = (msg) => {
    if (!dialog) return;
    let err = dialog.querySelector('.nr-ai-error');
    if (!err) {
      err = document.createElement('p');
      err.className = 'nr-ai-error';
      dialog.insertBefore(err, dialog.querySelector('.nr-ai-actions'));
    }
    err.textContent = msg;
  };
  const copyText = async (text) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    throw new Error('clipboard unavailable');
  };
  const showFallback = (text) => {
    if (!dialog) return;
    showError('Clipboard copy failed. The box below is the AI prompt — not the explanation above. Select it and copy.');
    let area = dialog.querySelector('textarea');
    if (!area) {
      area = document.createElement('textarea');
      area.className = 'nr-ai-fallback';
      area.readOnly = true;
      area.setAttribute('aria-label', 'AI prompt to paste into a chat');
      dialog.insertBefore(area, dialog.querySelector('.nr-ai-actions'));
    }
    area.value = text;
    area.focus();
    area.select();
  };
  const openDialog = async () => {
    lastActive = button;
    dialog = document.createElement('dialog');
    dialog.className = 'nr-ai-dialog';
    dialog.setAttribute('aria-labelledby', 'nr-ai-share-title');
    dialog.innerHTML = '<h2 id="nr-ai-share-title">Copy a prompt for an AI</h2>' +
      '<p class="nr-ai-lead">This window is for you. None of the sentences here are copied to the clipboard.</p>' +
      '<p>The Copy AI prompt button puts a <strong>different</strong> message on the clipboard: a prompt that tells the model to fetch the Markdown edition of this site (not this web page) and how to read it. After it copies, paste that prompt into ChatGPT, Claude, or another assistant.</p>' +
      '<p class="nr-ai-public">This preview is public. The AI prompt includes a link that does not expire.</p>' +
      '<div class="nr-ai-actions"><button type="button" class="nr-ai-copy nr-ai-btn nr-ai-btn-primary">Copy AI prompt</button>' +
      '<button type="button" class="nr-ai-cancel nr-ai-btn nr-ai-btn-secondary">Cancel</button></div>';
    document.body.appendChild(dialog);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(); });
    dialog.querySelector('.nr-ai-cancel').addEventListener('click', closeDialog);
    try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); }
    dialog.querySelector('.nr-ai-copy').focus();
    let instructions = '';
    try {
      const res = await fetch('/_nrdocs/agent-share', { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error('unavailable');
      const data = await res.json();
      instructions = data.instructions || '';
    } catch {
      showError('Unable to prepare the AI prompt.');
    }
    dialog.querySelector('.nr-ai-copy').addEventListener('click', async () => {
      if (!instructions) {
        showError('Unable to prepare the AI prompt.');
        return;
      }
      try {
        await copyText(instructions);
        showError('');
        const note = dialog.querySelector('.nr-ai-error') || document.createElement('p');
        note.className = 'nr-ai-error nr-ai-status';
        note.textContent = 'Copied the AI prompt. Paste it into the chat with the model.';
        if (!note.parentNode) dialog.insertBefore(note, dialog.querySelector('.nr-ai-actions'));
      } catch {
        showFallback(instructions);
      }
    });
  };
  button.addEventListener('click', () => { void openDialog(); });
})();
`;
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
    const bytes = byObject.get(page.html.object);
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
  const putPlatform = (pathname: string, bytes: Uint8Array, mediaType: string) => {
    routes.set(pathname, { kind: 'platform', bytes, mediaType });
  };
  putPlatform('/_nrdocs/v1/reader.css', enc.encode(PLATFORM_CSS), 'text/css; charset=utf-8');
  putPlatform('/_nrdocs/v1/reader.js', enc.encode(PLATFORM_JS), 'text/javascript; charset=utf-8');
  putPlatform(
    '/_nrdocs/v1/mermaid.js',
    enc.encode(PLATFORM_MERMAID),
    'text/javascript; charset=utf-8',
  );
  putPlatform(
    '/_nrdocs/v1/logo.svg',
    enc.encode(PLATFORM_LOGO_SVG),
    'image/svg+xml; charset=utf-8',
  );
  putPlatform(
    '/_nrdocs/v2/reader.css',
    enc.encode(PLATFORM_CSS.replaceAll('/v1/', '/v2/')),
    'text/css; charset=utf-8',
  );
  putPlatform(
    '/_nrdocs/v2/reader.js',
    enc.encode(PLATFORM_JS_V2),
    'text/javascript; charset=utf-8',
  );
  putPlatform(
    '/_nrdocs/v2/mermaid.js',
    enc.encode(PLATFORM_MERMAID),
    'text/javascript; charset=utf-8',
  );
  putPlatform(
    '/_nrdocs/v2/logo.svg',
    enc.encode(PLATFORM_LOGO_SVG),
    'image/svg+xml; charset=utf-8',
  );
  putPlatform('/favicon.ico', enc.encode(PLATFORM_LOGO_SVG), 'image/svg+xml; charset=utf-8');

  const md = (object: string, mediaType: string) => {
    const bytes = byObject.get(object);
    if (bytes) {
      routes.set(`/_nrdocs/agent/${object.slice('agent/'.length)}`, {
        kind: 'platform',
        bytes,
        mediaType,
      });
    }
  };
  md('agent/index.md', 'text/markdown; charset=utf-8');
  md('agent/manifest.json', 'application/json; charset=utf-8');
  if (artifact.manifest.agent.all) md('agent/all.md', 'text/markdown; charset=utf-8');
  for (const page of artifact.manifest.pages) {
    md(page.markdown.object, 'text/markdown; charset=utf-8');
  }
  for (const asset of artifact.manifest.assets) {
    const bytes = byObject.get(asset.object);
    if (!bytes) continue;
    routes.set(`/_nrdocs/agent/${asset.agent.route}`, {
      kind: 'asset',
      bytes,
      mediaType: asset.media_type,
    });
  }
  for (const att of artifact.manifest.attachments) {
    const bytes = byObject.get(att.object);
    if (!bytes) continue;
    routes.set(`/_nrdocs/agent/${att.agent.route}`, {
      kind: 'attachment',
      bytes,
      mediaType: att.media_type,
      filename: att.filename,
    });
  }

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
  const siteTitle = artifact.manifest.site.title;

  const server = http.createServer((req, res) => {
    try {
      const hostHeader = req.headers.host ?? `${host}`;
      const rawUrl = new URL(req.url ?? '/', `http://${hostHeader}`);
      const pathname = normalizeRequestPath(rawUrl.pathname);
      if (pathname === '/_nrdocs/agent-share') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(404, { 'Cache-Control': CACHE_NO_STORE });
          res.end();
          return;
        }
        const origin = `http://${hostHeader}`;
        const entryUrl = `${origin}/_nrdocs/agent/index.md`;
        const body = JSON.stringify({
          site_title: siteTitle,
          access_mode: 'public',
          entry_url: entryUrl,
          expires_at: null,
          instructions: shareInstructions(entryUrl, null),
          allowed_durations: [],
        });
        const bytes = Buffer.from(body);
        res.writeHead(200, {
          'Cache-Control': CACHE_NO_STORE,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': bytes.byteLength,
          'X-Content-Type-Options': 'nosniff',
        });
        if (req.method === 'HEAD') res.end();
        else res.end(bytes);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': CACHE_NO_STORE });
        res.end();
        return;
      }
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

export function summarizeManifest(manifest: ManifestV1 | ManifestV2): string {
  return [
    `Pages:       ${String(manifest.pages.length).padStart(2)}`,
    `Images:      ${String(manifest.assets.length).padStart(2)}`,
    `Attachments: ${String(manifest.attachments.length).padStart(2)}`,
  ].join('\n');
}
