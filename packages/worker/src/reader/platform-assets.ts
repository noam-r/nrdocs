import { sha256Hex } from '@nrdocs/contracts';
import { PLATFORM_ASSETS } from '../limits.js';
import { baseSecurityHeaders, PLATFORM_CACHE } from './headers.js';
import { MERMAID_BUNDLE } from './mermaid-bundle.generated.js';

export const PLATFORM_CSS = `/* nrdocs platform reader.css v1 */
body{font-family:system-ui,sans-serif;margin:0;color:#111;background:#fff}
.nr-platform-main{max-width:40rem;margin:3rem auto;padding:0 1.25rem}
.nr-platform-main label{display:block;margin:.75rem 0 .25rem}
.nr-platform-main input[type=password]{width:100%;max-width:24rem;padding:.4rem .5rem}
.nr-platform-main button{margin-top:1rem;padding:.4rem .9rem}
.nr-request-id{font-size:.85rem;opacity:.7;word-break:break-all}
.nr-header .nr-sign-out{margin-inline-start:auto;margin-inline-end:.5rem}
.nr-mermaid-error{color:#a40000;margin:.5rem 0}
`;

export const PLATFORM_JS = `/* nrdocs platform reader.js v1 */
(() => {
  const root = document.documentElement;
  const key = 'nrdocs-theme';
  const cycle = ['system', 'light', 'dark'];
  const mql = window.matchMedia('(prefers-color-scheme: dark)');

  function apply(theme) {
    if (theme === 'system') root.removeAttribute('data-nr-theme');
    else root.setAttribute('data-nr-theme', theme);
  }

  function currentTheme() {
    const t = localStorage.getItem(key);
    if (t === 'system' || t === 'light' || t === 'dark') return t;
    localStorage.removeItem(key);
    return 'system';
  }

  function mermaidTheme() {
    const t = currentTheme();
    if (t === 'dark') return 'dark';
    if (t === 'light') return 'default';
    return mql.matches ? 'dark' : 'default';
  }

  function clearMermaidChrome(pre) {
    let next = pre.nextElementSibling;
    while (next && (next.hasAttribute('data-nr-mermaid-out') || next.classList.contains('nr-mermaid-error'))) {
      const remove = next;
      next = next.nextElementSibling;
      remove.remove();
    }
  }

  function showMermaidFailure(pre) {
    clearMermaidChrome(pre);
    pre.hidden = false;
    const err = document.createElement('p');
    err.className = 'nr-mermaid-error';
    err.textContent = 'Diagram could not be rendered.';
    pre.after(err);
  }

  async function renderMermaid() {
    const blocks = Array.from(document.querySelectorAll('pre.nr-mermaid[data-nr-mermaid]'));
    if (!blocks.length) return;
    let api = null;
    try {
      const mod = await import('/_nrdocs/v1/mermaid.js');
      api = mod.default || mod.mermaid || null;
    } catch {
      api = null;
    }
    if (!api || typeof api.initialize !== 'function' || typeof api.render !== 'function') {
      for (const pre of blocks) showMermaidFailure(pre);
      return;
    }
    api.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      deterministicIds: true,
      theme: mermaidTheme(),
    });
    let n = 0;
    for (const pre of blocks) {
      clearMermaidChrome(pre);
      const source = pre.querySelector('code')?.textContent || '';
      const out = document.createElement('div');
      out.setAttribute('data-nr-mermaid-out', '');
      pre.after(out);
      try {
        n += 1;
        const result = await api.render('nr-mermaid-' + n, source);
        out.innerHTML = result.svg;
        pre.hidden = true;
      } catch {
        out.remove();
        showMermaidFailure(pre);
      }
    }
  }

  function onThemeChange(theme) {
    apply(theme);
    void renderMermaid();
  }

  apply(currentTheme());
  const btn = document.querySelector('.nr-theme-toggle');
  btn?.addEventListener('click', () => {
    const cur = currentTheme();
    const next = cycle[(cycle.indexOf(cur) + 1) % cycle.length];
    localStorage.setItem(key, next);
    onThemeChange(next);
  });
  mql.addEventListener('change', () => {
    if (currentTheme() === 'system') onThemeChange('system');
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
      toggle?.focus?.();
    }
  });

  const segments = location.pathname.split('/').filter(Boolean);
  const slug = segments[0];
  if (slug && slug !== '_nrdocs') {
    const header = document.querySelector('.nr-header');
    const themeToggle = document.querySelector('.nr-theme-toggle');
    if (header && !header.querySelector('.nr-sign-out')) {
      const link = document.createElement('a');
      link.className = 'nr-sign-out';
      link.href = '/_nrdocs/logout?site=' + encodeURIComponent(slug);
      link.textContent = 'Sign out';
      if (themeToggle) header.insertBefore(link, themeToggle);
      else header.appendChild(link);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { void renderMermaid(); });
  } else {
    void renderMermaid();
  }
})();
`;

/** Served at `/_nrdocs/v1/mermaid.js`. Stub in unit tests; real bundle from release build. */
export const PLATFORM_MERMAID = MERMAID_BUNDLE;

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
