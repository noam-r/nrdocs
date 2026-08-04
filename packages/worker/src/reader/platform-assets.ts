import { sha256Hex } from '@nrdocs/contracts';
import { PLATFORM_ASSETS } from '../limits.js';
import { baseSecurityHeaders, PLATFORM_CACHE } from './headers.js';

export const PLATFORM_CSS = `/* nrdocs platform reader.css v1 */
body{font-family:system-ui,sans-serif;margin:0;color:#111;background:#fff}
.nr-platform-main{max-width:40rem;margin:3rem auto;padding:0 1.25rem}
.nr-platform-main label{display:block;margin:.75rem 0 .25rem}
.nr-platform-main input[type=password]{width:100%;max-width:24rem;padding:.4rem .5rem}
.nr-platform-main button{margin-top:1rem;padding:.4rem .9rem}
.nr-request-id{font-size:.85rem;opacity:.7;word-break:break-all}
`;

export const PLATFORM_JS = `/* nrdocs platform reader.js v1 */
(() => {
  const root = document.documentElement;
  const key = 'nrdocs-theme';
  const cycle = ['system', 'light', 'dark'];
  function apply(theme) {
    if (theme === 'system') root.removeAttribute('data-nr-theme');
    else root.setAttribute('data-nr-theme', theme);
  }
  let theme = localStorage.getItem(key);
  if (theme !== 'system' && theme !== 'light' && theme !== 'dark') {
    localStorage.removeItem(key);
    theme = 'system';
  }
  apply(theme || 'system');
  const btn = document.querySelector('.nr-theme-toggle');
  btn?.addEventListener('click', () => {
    const cur = localStorage.getItem(key) || 'system';
    const next = cycle[(cycle.indexOf(cur) + 1) % cycle.length];
    localStorage.setItem(key, next);
    apply(next);
  });
  const toggle = document.querySelector('.nr-nav-toggle');
  const nav = document.querySelector('#nr-nav');
  toggle?.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    document.body.classList.toggle('nr-nav-open', !open);
    if (!open) nav?.querySelector('a,button')?.focus?.();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      toggle?.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('nr-nav-open');
    }
  });
})();
`;

export const PLATFORM_MERMAID = `/* nrdocs platform mermaid.js v1 */
export default {};
`;

const ASSETS: Record<string, { body: string; mediaType: string }> = {
  [PLATFORM_ASSETS[0]]: { body: PLATFORM_CSS, mediaType: 'text/css; charset=utf-8' },
  [PLATFORM_ASSETS[1]]: { body: PLATFORM_JS, mediaType: 'text/javascript; charset=utf-8' },
  [PLATFORM_ASSETS[2]]: {
    body: PLATFORM_MERMAID,
    mediaType: 'text/javascript; charset=utf-8',
  },
};

export async function servePlatformAsset(
  pathname: string,
  request: Request,
  opts?: { hsts?: boolean },
): Promise<Response | null> {
  const asset = ASSETS[pathname];
  if (!asset) return null;
  const bytes = new TextEncoder().encode(asset.body);
  const etag = `"${await sha256Hex(bytes)}"`;
  const inm = request.headers.get('if-none-match');
  const headers = new Headers({
    ...baseSecurityHeaders(opts),
    'cache-control': PLATFORM_CACHE,
    'content-type': asset.mediaType,
    etag,
  });
  if (inm && inm === etag) {
    return new Response(null, { status: 304, headers });
  }
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }
  return new Response(Uint8Array.from(bytes), { status: 200, headers });
}
