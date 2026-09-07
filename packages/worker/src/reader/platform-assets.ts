import { sha256Hex } from '@nrdocs/contracts';
import { PLATFORM_ASSETS, PLATFORM_ASSETS_V2, PLATFORM_ASSETS_V3 } from '../limits.js';
import { baseSecurityHeaders, PLATFORM_CACHE } from './headers.js';
import { PLATFORM_LOGO_SVG } from './logo.js';
import { MERMAID_BUNDLE } from './mermaid-bundle.generated.js';

export const PLATFORM_CSS = `/* nrdocs platform reader.css v1 */
:root{
  --nr-bg:#fafafa;
  --nr-fg:#1a1a1a;
  --nr-muted:#5a5a5a;
  --nr-border:#e2e2e2;
  --nr-header:#fff;
  --nr-link:#0b57d0;
  --nr-code-bg:#f3f3f3;
  --nr-focus:#0b57d0;
  --nr-accent:#0b57d0;
  --nr-danger:#b3261e;
  --nr-sidebar-width:17.5rem;
  --nr-toc-width:14.5rem;
  --nr-header-height:3.5rem;
  --nr-radius:.75rem;
  --nr-shadow:0 16px 40px rgb(16 24 40 / .08);
}
@media (prefers-color-scheme:dark){
  :root:not([data-nr-theme="light"]){
    --nr-bg:#0f1113;
    --nr-fg:#f3f4f6;
    --nr-muted:#b3b8c2;
    --nr-border:#2a2f36;
    --nr-header:#16191d;
    --nr-link:#8ab4f8;
    --nr-code-bg:#1c2128;
    --nr-focus:#8ab4f8;
    --nr-accent:#8ab4f8;
    --nr-danger:#f2b8b5;
    --nr-shadow:0 16px 40px rgb(0 0 0 / .35);
  }
}
:root[data-nr-theme="dark"]{
  --nr-bg:#0f1113;
  --nr-fg:#f3f4f6;
  --nr-muted:#b3b8c2;
  --nr-border:#2a2f36;
  --nr-header:#16191d;
  --nr-link:#8ab4f8;
  --nr-code-bg:#1c2128;
  --nr-focus:#8ab4f8;
  --nr-accent:#8ab4f8;
  --nr-danger:#f2b8b5;
  --nr-shadow:0 16px 40px rgb(0 0 0 / .35);
}
:root[data-nr-theme="light"]{
  --nr-bg:#fafafa;
  --nr-fg:#1a1a1a;
  --nr-muted:#5a5a5a;
  --nr-border:#e2e2e2;
  --nr-header:#fff;
  --nr-link:#0b57d0;
  --nr-code-bg:#f3f3f3;
  --nr-focus:#0b57d0;
  --nr-accent:#0b57d0;
  --nr-danger:#b3261e;
  --nr-shadow:0 16px 40px rgb(16 24 40 / .08);
}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
html{font-size:18px}
body{
  font-family:system-ui,sans-serif;
  color:var(--nr-fg);
  background:var(--nr-bg);
  line-height:1.65;
}
a{color:var(--nr-link)}
a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--nr-focus);outline-offset:2px}
.nr-skip{
  position:absolute;
  inset-inline-start:-9999px;
  top:0;
  padding:.5rem .75rem;
  background:var(--nr-header);
  z-index:40;
}
.nr-skip:focus{inset-inline-start:.75rem}
.nr-header{
  position:sticky;
  top:0;
  z-index:20;
  display:flex;
  align-items:center;
  gap:.65rem;
  min-height:var(--nr-header-height);
  padding-inline:1rem;
  border-bottom:1px solid var(--nr-border);
  background:var(--nr-header);
}
.nr-nav-toggle{
  display:none;
  border:1px solid var(--nr-border);
  background:var(--nr-bg);
  color:var(--nr-fg);
  padding:.35rem .7rem;
  border-radius:.5rem;
}
.nr-site-title{
  flex:1;
  display:flex;
  align-items:center;
  gap:.55rem;
  font-weight:650;
  text-decoration:none;
  color:inherit;
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.nr-site-title::before{
  content:"";
  flex:0 0 auto;
  width:3.02rem;
  height:1.65rem;
  background-color:currentColor;
  -webkit-mask:url("/_nrdocs/v1/logo.svg") center / contain no-repeat;
  mask:url("/_nrdocs/v1/logo.svg") center / contain no-repeat;
  mask-mode:alpha;
}
.nr-icon-btn,.nr-theme-toggle{
  position:relative;
  flex:0 0 2.25rem;
  width:2.25rem;
  height:2.25rem;
  margin:0;
  padding:0;
  border:1px solid var(--nr-border);
  border-radius:.55rem;
  background:var(--nr-bg);
  color:transparent;
  overflow:hidden;
  text-indent:2.5rem;
  white-space:nowrap;
  cursor:pointer;
  text-decoration:none;
}
.nr-icon-btn:hover,.nr-theme-toggle:hover{border-color:var(--nr-accent)}
.nr-header .nr-sign-out,.nr-theme-toggle,.nr-ai-share{margin-inline-start:0}
.nr-theme-toggle::before{
  content:"";
  position:absolute;
  inset:0;
  margin:auto;
  width:.72rem;
  height:.72rem;
  border-radius:50%;
  background:var(--nr-fg);
  box-shadow:
    0 -.55rem 0 -.28rem var(--nr-fg),
    0 .55rem 0 -.28rem var(--nr-fg),
    -.55rem 0 0 -.28rem var(--nr-fg),
    .55rem 0 0 -.28rem var(--nr-fg),
    -.4rem -.4rem 0 -.28rem var(--nr-fg),
    .4rem -.4rem 0 -.28rem var(--nr-fg),
    -.4rem .4rem 0 -.28rem var(--nr-fg),
    .4rem .4rem 0 -.28rem var(--nr-fg);
}
@media (prefers-color-scheme:dark){
  :root:not([data-nr-theme="light"]) .nr-theme-toggle::before{
    background:transparent;
    box-shadow:inset -.22rem -.08rem 0 .08rem var(--nr-fg);
  }
}
:root[data-nr-theme="dark"] .nr-theme-toggle::before{
  background:transparent;
  box-shadow:inset -.22rem -.08rem 0 .08rem var(--nr-fg);
}
.nr-sign-out.nr-icon-btn::before{
  content:"";
  position:absolute;
  inset-block:0;
  inset-inline-start:.55rem;
  margin-block:auto;
  width:.55rem;
  height:.72rem;
  border:.12rem solid var(--nr-fg);
  border-inline-start:0;
  border-radius:0 .12rem .12rem 0;
}
.nr-sign-out.nr-icon-btn::after{
  content:"";
  position:absolute;
  inset-block:0;
  inset-inline-start:.38rem;
  margin-block:auto;
  width:.42rem;
  height:.12rem;
  background:var(--nr-fg);
  box-shadow:.18rem -.16rem 0 -.02rem var(--nr-fg),.18rem .16rem 0 -.02rem var(--nr-fg);
}
.nr-layout{
  display:grid;
  grid-template-columns:var(--nr-sidebar-width) minmax(0,1fr);
  min-height:calc(100vh - var(--nr-header-height));
}
.nr-layout:has(.nr-toc){
  grid-template-columns:var(--nr-sidebar-width) minmax(0,1fr) var(--nr-toc-width);
}
.nr-sidebar{
  position:sticky;
  top:var(--nr-header-height);
  align-self:start;
  max-height:calc(100vh - var(--nr-header-height));
  border-inline-end:1px solid var(--nr-border);
  background:var(--nr-header);
  padding:1.1rem .95rem 2rem;
  overflow:auto;
}
.nr-nav-list{list-style:none;margin:0;padding:0}
.nr-nav-list .nr-nav-list{padding-inline-start:.75rem;margin-block:.15rem}
.nr-nav-item{margin:.12rem 0}
.nr-nav-item > a{
  display:block;
  text-decoration:none;
  color:inherit;
  padding:.28rem .5rem;
  border-radius:.4rem;
}
.nr-nav-item > a:hover{background:var(--nr-bg)}
.nr-nav-item > a[aria-current="page"]{background:var(--nr-bg);font-weight:650;box-shadow:inset 3px 0 0 var(--nr-accent)}
.nr-nav-section{display:block;font-size:.78rem;letter-spacing:.04em;color:var(--nr-muted);margin:.7rem 0 .25rem .5rem;text-transform:uppercase}
.nr-main{min-width:0;padding:1.75rem 1.75rem 3.5rem}
.nr-article{max-width:46rem}
.nr-article :where(h1,h2,h3,h4,h5,h6){line-height:1.25;margin-block:1.6rem .7rem;scroll-margin-top:calc(var(--nr-header-height) + .75rem)}
.nr-article h1{font-size:2rem;margin-top:0}
.nr-article h2{font-size:1.45rem}
.nr-article h3{font-size:1.2rem}
.nr-article p,.nr-article ul,.nr-article ol,.nr-article table,.nr-article pre,.nr-article blockquote{margin-block:1rem}
.nr-article li{margin-block:.25rem}
.nr-article img{max-width:100%;height:auto}
.nr-article pre,.nr-article code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em}
.nr-article pre{
  overflow:auto;
  padding:.95rem 1.05rem;
  background:var(--nr-code-bg);
  border:1px solid var(--nr-border);
  border-radius:.5rem;
}
.nr-article :not(pre) > code{background:var(--nr-code-bg);padding:.12em .38em;border-radius:.25rem}
.nr-article table{border-collapse:collapse;width:100%}
.nr-article th,.nr-article td{border:1px solid var(--nr-border);padding:.5rem .65rem;vertical-align:top}
.nr-broken-link{
  color:var(--nr-danger);
  text-decoration:line-through;
  cursor:help;
}
.nr-broken-link::after{
  content:"";
  display:inline-block;
  width:.8em;
  height:.8em;
  margin-inline-start:.28em;
  vertical-align:-.08em;
  background:currentColor;
  -webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' d='M6.2 9.8l-1.4 1.4a2.4 2.4 0 11-3.4-3.4L2.8 6.4M9.8 6.2l1.4-1.4a2.4 2.4 0 113.4 3.4L13.2 9.6M5.5 3.5l5 9'/%3E%3C/svg%3E") center / contain no-repeat;
  mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' d='M6.2 9.8l-1.4 1.4a2.4 2.4 0 11-3.4-3.4L2.8 6.4M9.8 6.2l1.4-1.4a2.4 2.4 0 113.4 3.4L13.2 9.6M5.5 3.5l5 9'/%3E%3C/svg%3E") center / contain no-repeat;
}
.nr-align-left{text-align:start}
.nr-align-center{text-align:center}
.nr-align-right{text-align:end}
.nr-pagination{display:flex;justify-content:space-between;gap:1rem;margin-top:2.5rem;padding-top:1.15rem;border-top:1px solid var(--nr-border)}
.nr-prev,.nr-next{text-decoration:none}
.nr-next{margin-inline-start:auto}
.nr-footer{padding:1rem 1.25rem;border-top:1px solid var(--nr-border);color:var(--nr-muted);font-size:.9rem}
.nr-toc{
  position:sticky;
  top:var(--nr-header-height);
  align-self:start;
  max-height:calc(100vh - var(--nr-header-height));
  overflow:auto;
  padding:1.25rem 1rem 2rem .25rem;
  border-inline-start:1px solid var(--nr-border);
}
.nr-toc-title{
  margin:0 0 .65rem;
  padding-inline:.65rem;
  font-size:.78rem;
  letter-spacing:.04em;
  text-transform:uppercase;
  color:var(--nr-muted);
}
.nr-toc ul{list-style:none;margin:0;padding:0}
.nr-toc a{
  display:block;
  color:inherit;
  text-decoration:none;
  padding:.28rem .65rem;
  border-radius:.35rem;
  font-size:.92rem;
  line-height:1.35;
}
.nr-toc a[data-nr-depth="3"]{padding-inline-start:1.15rem;color:var(--nr-muted)}
.nr-toc a:hover,.nr-toc a[aria-current="location"]{background:var(--nr-header)}
.nr-toc a[aria-current="location"]{font-weight:650;box-shadow:inset 3px 0 0 var(--nr-accent)}
.nr-top{
  position:fixed;
  inset-block-end:1.25rem;
  inset-inline-end:1.25rem;
  z-index:18;
  opacity:0;
  pointer-events:none;
  transform:translateY(.35rem);
  transition:opacity .16s ease,transform .16s ease;
}
.nr-top.is-visible{
  opacity:1;
  pointer-events:auto;
  transform:none;
}
.nr-top.nr-icon-btn{
  width:2.6rem;
  height:2.6rem;
  flex-basis:2.6rem;
  background:var(--nr-header);
  box-shadow:var(--nr-shadow);
}
.nr-top::before{
  content:"";
  position:absolute;
  inset-inline:0;
  inset-block-start:.7rem;
  margin-inline:auto;
  width:.7rem;
  height:.7rem;
  border-block-start:.16rem solid var(--nr-fg);
  border-inline-start:.16rem solid var(--nr-fg);
  transform:rotate(45deg);
}
body.nr-platform{
  display:flex;
  align-items:center;
  justify-content:center;
  min-height:100vh;
  padding:1.25rem;
  background:
    radial-gradient(1200px 480px at 50% -10%, color-mix(in srgb, var(--nr-accent) 14%, transparent), transparent 70%),
    var(--nr-bg);
}
.nr-platform-main{width:100%;max-width:32rem;margin:0;padding:0}
.nr-platform-card{
  padding:1.85rem 1.6rem 1.5rem;
  border:1px solid var(--nr-border);
  border-radius:var(--nr-radius);
  background:var(--nr-header);
  box-shadow:var(--nr-shadow);
}
.nr-platform-brand{margin:0 0 1.25rem}
.nr-platform-brand::before{
  content:"";
  display:block;
  width:100%;
  aspect-ratio:1408/768;
  background-color:currentColor;
  -webkit-mask:url("/_nrdocs/v1/logo.svg") center / contain no-repeat;
  mask:url("/_nrdocs/v1/logo.svg") center / contain no-repeat;
  mask-mode:alpha;
}
.nr-platform-card h1{margin:0 0 .5rem;font-size:1.55rem;line-height:1.25}
.nr-platform-lead{margin:0 0 1.15rem;color:var(--nr-muted)}
.nr-platform-error{margin:0 0 1.15rem;color:var(--nr-danger)}
.nr-platform-footer{
  margin:1.35rem 0 0;
  padding-top:1rem;
  border-top:1px solid var(--nr-border);
  font-size:.9rem;
}
.nr-platform-footer a{color:var(--nr-muted)}
.nr-platform-main label{display:block;margin:0 0 .4rem;font-weight:600}
.nr-platform-main input[type=password]{
  width:100%;
  max-width:none;
  padding:.7rem .8rem;
  border:1px solid var(--nr-border);
  border-radius:.5rem;
  background:var(--nr-bg);
  color:var(--nr-fg);
  font:inherit;
}
.nr-platform-main button{
  display:block;
  width:100%;
  margin-top:1rem;
  padding:.75rem 1rem;
  border:0;
  border-radius:.5rem;
  background:var(--nr-accent);
  color:#fff;
  font:inherit;
  font-weight:650;
  cursor:pointer;
}
.nr-request-id{font-size:.85rem;opacity:.7;word-break:break-all}
.nr-mermaid-error{color:var(--nr-danger);margin:.5rem 0}
.hljs-comment,.hljs-quote{color:var(--nr-muted)}
.hljs-keyword,.hljs-selector-tag,.hljs-addition{color:#0b57d0}
.hljs-string,.hljs-attr,.hljs-symbol,.hljs-bullet{color:#188038}
.hljs-title,.hljs-section,.hljs-name,.hljs-selector-id,.hljs-selector-class{color:#c5221f}
.hljs-number,.hljs-literal,.hljs-variable,.hljs-template-variable{color:#b06000}
@media (prefers-color-scheme:dark){
  :root:not([data-nr-theme="light"]) .hljs-keyword,:root:not([data-nr-theme="light"]) .hljs-selector-tag{color:#8ab4f8}
  :root:not([data-nr-theme="light"]) .hljs-string,:root:not([data-nr-theme="light"]) .hljs-attr{color:#81c995}
  :root:not([data-nr-theme="light"]) .hljs-title,:root:not([data-nr-theme="light"]) .hljs-name{color:#f28b82}
  :root:not([data-nr-theme="light"]) .hljs-number{color:#fdd663}
}
:root[data-nr-theme="dark"] .hljs-keyword,:root[data-nr-theme="dark"] .hljs-selector-tag{color:#8ab4f8}
:root[data-nr-theme="dark"] .hljs-string,:root[data-nr-theme="dark"] .hljs-attr{color:#81c995}
:root[data-nr-theme="dark"] .hljs-title,:root[data-nr-theme="dark"] .hljs-name{color:#f28b82}
:root[data-nr-theme="dark"] .hljs-number{color:#fdd663}
@media (max-width:72rem){
  .nr-toc{display:none}
  .nr-layout:has(.nr-toc){grid-template-columns:var(--nr-sidebar-width) minmax(0,1fr)}
}
@media (max-width:52rem){
  .nr-nav-toggle{display:inline-flex}
  .nr-layout,.nr-layout:has(.nr-toc){grid-template-columns:minmax(0,1fr)}
  .nr-sidebar{
    position:fixed;
    inset-block:var(--nr-header-height) 0;
    inset-inline-start:0;
    width:min(20rem,86vw);
    transform:translateX(-110%);
    z-index:15;
    box-shadow:none;
    border-inline-end:1px solid var(--nr-border);
  }
  [dir="rtl"] .nr-sidebar{transform:translateX(110%)}
  body.nr-nav-open{overflow:hidden}
  body.nr-nav-open .nr-sidebar{transform:none;box-shadow:0 0 0 100vw rgb(0 0 0 / .35)}
}
@media (prefers-reduced-motion:reduce){
  *{animation:none !important;transition:none !important}
}
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

  function syncThemeButton(btn, theme) {
    if (!btn) return;
    btn.classList.add('nr-icon-btn');
    btn.title = 'Theme: ' + theme;
    btn.setAttribute('aria-label', 'Change color theme');
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
    syncThemeButton(btn, theme);
    void renderMermaid();
  }

  apply(currentTheme());
  const btn = document.querySelector('.nr-theme-toggle');
  syncThemeButton(btn, currentTheme());
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
    const insertSignOut = () => {
      if (!header || header.querySelector('.nr-sign-out')) return;
      const link = document.createElement('a');
      link.className = 'nr-sign-out nr-icon-btn';
      link.href = '/_nrdocs/logout?site=' + encodeURIComponent(slug);
      link.title = 'Log out';
      link.setAttribute('aria-label', 'Log out');
      link.textContent = 'Log out';
      if (themeToggle) header.insertBefore(link, themeToggle);
      else header.appendChild(link);
    };
    try {
      if (typeof Image === 'function') {
        const probe = new Image();
        probe.addEventListener('load', insertSignOut);
        probe.src = '/_nrdocs/signed-in?site=' + encodeURIComponent(slug);
      }
    } catch {
      /* preview and non-browser tests have no Image */
    }
  }

  function buildToc() {
    const article = document.querySelector('article.nr-article');
    const layout = document.querySelector('.nr-layout');
    if (!article || !layout || layout.querySelector('.nr-toc')) return;
    const headings = Array.from(article.querySelectorAll('h2[id], h3[id]'));
    if (headings.length < 2) return;
    const nav = document.createElement('nav');
    nav.className = 'nr-toc';
    nav.setAttribute('aria-label', 'On this page');
    const title = document.createElement('p');
    title.className = 'nr-toc-title';
    title.textContent = 'On this page';
    const list = document.createElement('ul');
    const links = [];
    for (const heading of headings) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = '#' + heading.id;
      link.textContent = heading.textContent || heading.id;
      link.setAttribute('data-nr-depth', heading.tagName === 'H3' ? '3' : '2');
      item.appendChild(link);
      list.appendChild(item);
      links.push({ heading, link });
    }
    nav.appendChild(title);
    nav.appendChild(list);
    layout.appendChild(nav);

    const setCurrent = (id) => {
      for (const entry of links) {
        if (entry.heading.id === id) entry.link.setAttribute('aria-current', 'location');
        else entry.link.removeAttribute('aria-current');
      }
    };
    if (links[0]) setCurrent(links[0].heading.id);
    if (typeof IntersectionObserver === 'function') {
      const visible = new Map();
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.set(entry.target.id, entry.target);
          else visible.delete(entry.target.id);
        }
        let active = null;
        for (const heading of headings) {
          if (visible.has(heading.id)) {
            active = heading;
            break;
          }
        }
        if (!active) {
          for (const heading of headings) {
            if (heading.getBoundingClientRect().top <= 96) active = heading;
          }
        }
        if (active) setCurrent(active.id);
      }, { rootMargin: '-80px 0px -60% 0px', threshold: 0.01 });
      for (const heading of headings) observer.observe(heading);
    }
  }
  buildToc();

  function buildBackToTop() {
    if (document.body.classList.contains('nr-platform')) return;
    if (!document.querySelector('.nr-article')) return;
    if (document.querySelector('.nr-top')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nr-top nr-icon-btn';
    button.title = 'Back to top';
    button.setAttribute('aria-label', 'Back to top');
    button.textContent = 'Back to top';
    button.addEventListener('click', () => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });
    const sync = () => {
      button.classList.toggle('is-visible', window.scrollY > 320);
    };
    window.addEventListener('scroll', sync, { passive: true });
    sync();
    document.body.appendChild(button);
  }
  buildBackToTop();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { void renderMermaid(); });
  } else {
    void renderMermaid();
  }
})();
`;

export const PLATFORM_CSS_V2 = `${PLATFORM_CSS.replaceAll('/_nrdocs/v1/', '/_nrdocs/v2/')}
/* v2 AI prompt control — sparkle (auto_awesome) */
.nr-ai-share.nr-icon-btn{flex:0 0 2.25rem}
.nr-ai-share.nr-icon-btn::before{
  content:"";
  position:absolute;
  inset:0;
  margin:auto;
  width:1.05rem;
  height:1.05rem;
  background:var(--nr-fg);
  -webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12z'/%3E%3C/svg%3E") center / contain no-repeat;
  mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12z'/%3E%3C/svg%3E") center / contain no-repeat;
}
.nr-ai-share.nr-icon-btn::after{content:none;display:none}
.nr-ai-dialog{
  max-width:32rem;
  width:calc(100% - 2rem);
  border:1px solid var(--nr-border);
  border-radius:var(--nr-radius);
  background:var(--nr-header);
  color:var(--nr-fg);
  box-shadow:var(--nr-shadow);
  padding:1.35rem 1.4rem 1.2rem;
  font:inherit;
}
.nr-ai-dialog::backdrop{background:rgb(16 24 40 / .45)}
.nr-ai-dialog h2{margin:0 0 .65rem;font-size:1.2rem;line-height:1.3;font-weight:650;color:var(--nr-fg)}
.nr-ai-dialog p{margin:0 0 .8rem;color:var(--nr-muted);line-height:1.45}
.nr-ai-lead{color:var(--nr-fg)}
.nr-ai-dialog fieldset{border:0;padding:0;margin:0 0 1rem}
.nr-ai-dialog legend{font-weight:650;color:var(--nr-fg);margin:0 0 .45rem}
.nr-ai-choice{
  display:flex;
  align-items:center;
  gap:.6rem;
  margin:0 0 .4rem;
  padding:.55rem .7rem;
  border:1px solid var(--nr-border);
  border-radius:.5rem;
  background:var(--nr-bg);
  color:var(--nr-fg);
  cursor:pointer;
  font:inherit;
}
.nr-ai-choice:has(input:checked){
  border-color:var(--nr-accent);
  box-shadow:inset 3px 0 0 var(--nr-accent);
}
.nr-ai-choice input{
  flex:0 0 auto;
  accent-color:var(--nr-accent);
  width:1rem;
  height:1rem;
  margin:0;
}
.nr-ai-actions{display:flex;gap:.5rem;flex-wrap:wrap;justify-content:flex-end;margin-top:.25rem}
.nr-ai-btn{
  font:inherit;
  font-weight:650;
  border-radius:.5rem;
  padding:.65rem .95rem;
  cursor:pointer;
}
.nr-ai-btn-primary{
  border:0;
  background:var(--nr-accent);
  color:#fff;
}
.nr-ai-btn-primary:hover{filter:brightness(1.06)}
.nr-ai-btn-secondary{
  border:1px solid var(--nr-border);
  background:var(--nr-bg);
  color:var(--nr-fg);
}
.nr-ai-btn-secondary:hover{border-color:var(--nr-accent)}
.nr-ai-status{color:var(--nr-fg);font-weight:650}
.nr-ai-error{color:var(--nr-danger)}
.nr-ai-fallback{
  display:block;
  width:100%;
  min-height:8rem;
  margin:0 0 .85rem;
  padding:.7rem .8rem;
  border:1px solid var(--nr-border);
  border-radius:.5rem;
  background:var(--nr-bg);
  color:var(--nr-fg);
  font:inherit;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:.86em;
  line-height:1.4;
  resize:vertical;
}
@media (prefers-reduced-motion:reduce){
  .nr-ai-dialog{transition:none}
}
`;

export const PLATFORM_JS_V2 = `${PLATFORM_JS.replaceAll('/_nrdocs/v1/', '/_nrdocs/v2/')}
(() => {
  const button = document.querySelector('.nr-ai-share');
  if (!button || !(button instanceof HTMLButtonElement)) return;
  const siteMatch = location.pathname.match(new RegExp('^/([^/]+)'));
  const siteSlug = siteMatch ? siteMatch[1] : '';
  let dialog = null;
  let lastActive = null;

  const closeDialog = () => {
    if (!dialog) return;
    const box = dialog.querySelector('textarea');
    if (box) { box.value = ''; box.remove(); }
    dialog.close();
    dialog.remove();
    dialog = null;
    if (lastActive) lastActive.focus();
  };

  const trap = (event) => {
    if (!dialog || event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button, input, textarea, [href]')].filter((el) => !el.disabled);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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
      '<p>The publication may change while a copied link remains valid.</p>' +
      '<div class="nr-ai-durations" hidden></div>' +
      '<p class="nr-ai-public" hidden>This site is public. The AI prompt includes a link that does not expire.</p>' +
      '<p class="nr-ai-protected" hidden>This site is password-protected. The AI prompt includes a temporary access link. Anyone who receives that prompt can read the site until the link expires. Choose how long the link should work, then copy.</p>' +
      '<div class="nr-ai-actions"><button type="button" class="nr-ai-copy nr-ai-btn nr-ai-btn-primary">Copy AI prompt</button>' +
      '<button type="button" class="nr-ai-cancel nr-ai-btn nr-ai-btn-secondary">Cancel</button></div>';
    document.body.appendChild(dialog);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(); });
    dialog.querySelector('.nr-ai-cancel').addEventListener('click', closeDialog);
    document.addEventListener('keydown', trap);
    dialog.addEventListener('close', () => document.removeEventListener('keydown', trap));
    try {
      dialog.showModal();
    } catch {
      dialog.setAttribute('open', '');
    }
    dialog.querySelector('.nr-ai-copy').focus();

    let publicPayload = null;
    let shareMeta = null;
    try {
      const res = await fetch('/_nrdocs/agent-share?site=' + encodeURIComponent(siteSlug), {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error('unavailable');
      const data = await res.json();
      if (data.access_mode === 'public') {
        publicPayload = data;
        dialog.querySelector('.nr-ai-public').hidden = false;
      } else {
        shareMeta = data;
        dialog.querySelector('.nr-ai-protected').hidden = false;
        const box = dialog.querySelector('.nr-ai-durations');
        box.hidden = false;
        box.innerHTML = '<fieldset><legend>How long the AI’s link should work</legend>' +
          '<label class="nr-ai-choice"><input type="radio" name="nr-ai-dur" value="1h"> 1 hour</label>' +
          '<label class="nr-ai-choice"><input type="radio" name="nr-ai-dur" value="24h" checked> 24 hours</label>' +
          '<label class="nr-ai-choice"><input type="radio" name="nr-ai-dur" value="7d"> 7 days</label></fieldset>';
      }
    } catch {
      showError('Unable to prepare the AI prompt.');
    }

    dialog.querySelector('.nr-ai-copy').addEventListener('click', async () => {
      try {
        let text = '';
        if (publicPayload) {
          text = publicPayload.instructions;
        } else if (shareMeta) {
          const chosen = dialog.querySelector('input[name="nr-ai-dur"]:checked');
          const duration = chosen ? chosen.value : '24h';
          const res = await fetch('/_nrdocs/agent-share', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json; charset=utf-8', accept: 'application/json' },
            body: JSON.stringify({ site: siteSlug, duration, csrf: shareMeta.csrf }),
          });
          if (!res.ok) throw new Error('create failed');
          const created = await res.json();
          text = created.instructions;
        } else {
          throw new Error('not ready');
        }
        try {
          await copyText(text);
          text = '';
          showError('');
          const note = dialog.querySelector('.nr-ai-error') || document.createElement('p');
          note.className = 'nr-ai-error nr-ai-status';
          note.textContent = 'Copied the AI prompt. Paste it into the chat with the model.';
          if (!note.parentNode) dialog.insertBefore(note, dialog.querySelector('.nr-ai-actions'));
        } catch {
          showFallback(text);
        }
      } catch {
        showError('Unable to create the AI prompt.');
      }
    });
  };

  button.addEventListener('click', () => { void openDialog(); });
})();
`;

const PLATFORM_API_CSS = `
/* v3 API reference — fill the main column (guides keep .nr-article max-width:46rem) */
.nr-article:has(.nr-api-layout){max-width:none;width:100%}
.nr-api-layout{display:grid;gap:1.75rem;width:100%}
@media (min-width:64rem){
  .nr-api-layout{grid-template-columns:minmax(0,1.35fr) minmax(20rem,.95fr);align-items:start;gap:1.75rem}
  .nr-api-secondary{position:sticky;top:calc(var(--nr-header-height) + 1rem)}
}
.nr-api-primary,.nr-api-examples,.nr-api-secondary{min-width:0}
.nr-api-secondary{display:flex;flex-direction:column;gap:1rem}
.nr-api-method-path{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin:0 0 1rem}
.nr-api-method{
  display:inline-block;font:650 .75rem/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  letter-spacing:.04em;padding:.35rem .55rem;border-radius:.4rem;background:var(--nr-code-bg);color:var(--nr-fg)
}
.nr-api-method-get{background:#e7f0fe;color:#0b57d0}
.nr-api-method-post{background:#e6f4ea;color:#137333}
.nr-api-method-put,.nr-api-method-patch{background:#fef7e0;color:#8a5b00}
.nr-api-method-delete{background:#fce8e6;color:#c5221f}
:root:not([data-nr-theme="light"]) .nr-api-method-get,
:root[data-nr-theme="dark"] .nr-api-method-get{background:#1a3050;color:#8ab4f8}
:root:not([data-nr-theme="light"]) .nr-api-method-post,
:root[data-nr-theme="dark"] .nr-api-method-post{background:#1a3a28;color:#81c995}
:root:not([data-nr-theme="light"]) .nr-api-method-put,
:root:not([data-nr-theme="light"]) .nr-api-method-patch,
:root[data-nr-theme="dark"] .nr-api-method-put,
:root[data-nr-theme="dark"] .nr-api-method-patch{background:#3a3010;color:#fdd663}
:root:not([data-nr-theme="light"]) .nr-api-method-delete,
:root[data-nr-theme="dark"] .nr-api-method-delete{background:#4a1e1a;color:#f28b82}
.nr-api-path{font-size:.95em}
.nr-api-cost{margin:0 0 1rem}
.nr-api-cost-label{font-weight:650;margin-inline-end:.35rem}
.nr-api-table{width:100%;border-collapse:collapse;margin:0 0 1rem;font-size:.95em}
.nr-api-table th,.nr-api-table td{border:1px solid var(--nr-border);padding:.45rem .55rem;text-align:start;vertical-align:top}
.nr-api-table th{background:var(--nr-code-bg);font-weight:650}

/* Example cards (request / response) — inspired by reference API docs */
.nr-api-panel{
  border:1px solid var(--nr-border);
  border-radius:.75rem;
  background:var(--nr-header);
  overflow:hidden;
  min-width:0;
}
.nr-api-panel .nr-tabs{margin:0}
.nr-api-panel-chrome{
  display:flex;align-items:center;gap:.5rem;
  padding:.55rem .75rem;
  border-bottom:1px solid var(--nr-border);
  background:var(--nr-code-bg);
}
.nr-api-panel-chrome .nr-tab-list{
  flex:1;display:flex;flex-wrap:wrap;align-items:center;gap:.15rem .55rem;margin:0;min-width:0
}
.nr-api-panel-chrome .nr-tab{
  appearance:none;font:inherit;font-size:.82rem;font-weight:650;
  padding:.35rem .2rem;margin:0;border:0;border-radius:0;
  background:transparent;color:var(--nr-muted);cursor:pointer;
  box-shadow:none;border-bottom:2px solid transparent
}
.nr-api-panel-chrome .nr-tab:hover{color:var(--nr-fg)}
.nr-api-panel-chrome .nr-tab.nr-tab-active{
  color:var(--nr-accent);border-bottom-color:var(--nr-accent);box-shadow:none
}
.nr-api-panel-chrome .nr-copy{
  flex:0 0 auto;position:relative;
  width:2rem;height:2rem;padding:0;margin:0;
  border:1px solid var(--nr-border);border-radius:.45rem;
  background:var(--nr-bg);color:transparent;overflow:hidden;
  text-indent:2.5rem;white-space:nowrap;cursor:pointer;font:inherit
}
.nr-api-panel-chrome .nr-copy::before,
.nr-api-panel-chrome .nr-copy::after{
  content:"";position:absolute;pointer-events:none
}
.nr-api-panel-chrome .nr-copy::before{
  inset-block-start:.45rem;inset-inline-start:.45rem;
  width:.72rem;height:.72rem;border:1.5px solid var(--nr-fg);border-radius:.18rem;opacity:.55
}
.nr-api-panel-chrome .nr-copy::after{
  inset-block-start:.68rem;inset-inline-start:.68rem;
  width:.72rem;height:.72rem;border:1.5px solid var(--nr-fg);border-radius:.18rem;
  background:var(--nr-bg)
}
.nr-api-panel-chrome .nr-copy:hover{border-color:var(--nr-accent)}
.nr-api-panel .nr-tab-panel{margin:0}
.nr-api-panel .nr-code-block{margin:0}
.nr-api-panel .nr-code-block pre{
  margin:0;padding:1rem 1.05rem 1.15rem;max-height:22rem;overflow:auto;
  border:0;border-radius:0;background:transparent;font-size:.84em;line-height:1.45
}
.nr-api-panel .nr-code-block .nr-copy{display:none}

/* Fallback tab chrome outside panels (unused on operation pages after panel migration) */
.nr-tabs{margin:0 0 1rem}
.nr-tab-list{display:flex;flex-wrap:wrap;gap:.35rem;margin:0 0 .75rem}
.nr-tab{
  font:inherit;font-weight:650;padding:.45rem .7rem;border:1px solid var(--nr-border);
  border-radius:.5rem;background:var(--nr-bg);color:var(--nr-fg);cursor:pointer
}
.nr-tab.nr-tab-active{border-color:var(--nr-accent);box-shadow:inset 0 -2px 0 var(--nr-accent)}
.nr-tab-panel{margin:0 0 1rem}
@media (scripting: enabled){
  .nr-tabs .nr-tab-panel{display:none}
  .nr-tabs .nr-tab-panel.nr-tab-panel-active{display:block}
}
.nr-code-block{position:relative}
.nr-code-block pre{margin:0 0 .5rem}
.nr-copy{
  font:inherit;font-size:.85em;padding:.3rem .55rem;border:1px solid var(--nr-border);
  border-radius:.4rem;background:var(--nr-bg);color:var(--nr-fg);cursor:pointer
}
`;

const PLATFORM_API_JS = `
(() => {
  for (const root of document.querySelectorAll('.nr-tabs')) {
    const list = root.querySelector(':scope > .nr-api-panel-chrome > .nr-tab-list, :scope > .nr-tab-list');
    if (!list) continue;
    const tabs = [...list.querySelectorAll(':scope > .nr-tab')];
    const panels = [...root.querySelectorAll(':scope > .nr-tab-panel')];
    if (tabs.length === 0 || tabs.length !== panels.length) continue;
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t, i) => t.classList.toggle('nr-tab-active', i === index));
        panels.forEach((p, i) => p.classList.toggle('nr-tab-panel-active', i === index));
      });
    });
  }
  for (const btn of document.querySelectorAll('button.nr-copy')) {
    btn.addEventListener('click', async () => {
      const tabsRoot = btn.closest('.nr-tabs');
      const activePanel = tabsRoot && tabsRoot.querySelector(':scope > .nr-tab-panel.nr-tab-panel-active');
      const pre =
        (activePanel && activePanel.querySelector('pre')) ||
        (btn.closest('.nr-code-block') && btn.closest('.nr-code-block').querySelector('pre'));
      const text = pre ? pre.textContent || '' : '';
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        }
      } catch {}
    });
  }
})();
`;

export const PLATFORM_CSS_V3 = `${PLATFORM_CSS_V2.replaceAll('/_nrdocs/v2/', '/_nrdocs/v3/')}${PLATFORM_API_CSS}`;

export const PLATFORM_JS_V3 = `${PLATFORM_JS_V2.replaceAll('/_nrdocs/v2/', '/_nrdocs/v3/')}
${PLATFORM_API_JS}
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
  [PLATFORM_ASSETS[3]]: { body: PLATFORM_LOGO_SVG, mediaType: 'image/svg+xml; charset=utf-8' },
  [PLATFORM_ASSETS_V2[0]]: { body: PLATFORM_CSS_V2, mediaType: 'text/css; charset=utf-8' },
  [PLATFORM_ASSETS_V2[1]]: { body: PLATFORM_JS_V2, mediaType: 'text/javascript; charset=utf-8' },
  [PLATFORM_ASSETS_V2[2]]: {
    body: PLATFORM_MERMAID,
    mediaType: 'text/javascript; charset=utf-8',
  },
  [PLATFORM_ASSETS_V2[3]]: { body: PLATFORM_LOGO_SVG, mediaType: 'image/svg+xml; charset=utf-8' },
  [PLATFORM_ASSETS_V3[0]]: { body: PLATFORM_CSS_V3, mediaType: 'text/css; charset=utf-8' },
  [PLATFORM_ASSETS_V3[1]]: { body: PLATFORM_JS_V3, mediaType: 'text/javascript; charset=utf-8' },
  [PLATFORM_ASSETS_V3[2]]: {
    body: PLATFORM_MERMAID,
    mediaType: 'text/javascript; charset=utf-8',
  },
  [PLATFORM_ASSETS_V3[3]]: { body: PLATFORM_LOGO_SVG, mediaType: 'image/svg+xml; charset=utf-8' },
};

export async function servePlatformAsset(
  pathname: string,
  request: Request,
  opts?: { hsts?: boolean },
): Promise<Response | null> {
  const asset = ASSETS[pathname === '/favicon.ico' ? PLATFORM_ASSETS[3] : pathname];
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
