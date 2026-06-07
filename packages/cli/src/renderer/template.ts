/**
 * HTML template generation for rendered documentation pages.
 */
import type { NavSidebarEntry } from './navigation.js';

const DOWNLOAD_ICON_SVG = `<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.75v9.5"/><path d="M8 10.5 12 14.5l4-4"/><path d="M5.25 15.75v2.5a1.5 1.5 0 0 0 1.5 1.5h10.5a1.5 1.5 0 0 0 1.5-1.5v-2.5"/></svg>`;

const MOON_ICON_SVG = `<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20.25 14.15A7.85 7.85 0 0 1 9.85 3.75a8.25 8.25 0 1 0 10.4 10.4z"/></svg>`;

export interface TemplateOptions {
  title: string;
  siteTitle: string;
  content: string;
  nav: NavSidebarEntry[];
  canonicalUrl: string;
  baseUrl: string;
  /** Page contains mermaid diagrams */
  includeMermaid?: boolean;
  /** Relative src to _nrdocs/mermaid.min.js from this page */
  mermaidScriptSrc?: string | null;
  /** Show Markdown export menu in the right panel toolbar */
  exportEnabled?: boolean;
  /** Relative URL to download this page's source .md */
  pageSourceDownloadUrl?: string | null;
  /** Relative URL to download all pages as .zip */
  siteZipDownloadUrl?: string | null;
}

/**
 * Extracts headings from rendered HTML for the table of contents.
 */
function extractToc(html: string): Array<{ id: string; text: string; level: number }> {
  const toc: Array<{ id: string; text: string; level: number }> = [];
  const regex = /<h([2-3])[^>]*id="([^"]*)"[^>]*>(.*?)<\/h[2-3]>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    toc.push({
      level: parseInt(match[1]!, 10),
      id: match[2]!,
      text: match[3]!.replace(/<[^>]*>/g, ''),
    });
  }
  return toc;
}

/**
 * Adds id attributes to h2 and h3 headings for anchor linking.
 */
export function addHeadingIds(html: string): string {
  return html.replace(/<h([2-3])([^>]*)>(.*?)<\/h[2-3]>/gi, (_match, level: string, attrs: string, text: string) => {
    if (attrs.includes('id=')) return _match;
    const plainText = text.replace(/<[^>]*>/g, '');
    const id = plainText
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return `<h${level} id="${id}"${attrs}>${text}</h${level}>`;
  });
}

/**
 * Wraps rendered Markdown content in a complete HTML page.
 */
export function wrapInTemplate(options: TemplateOptions): string {
  const {
    title,
    siteTitle,
    content,
    nav,
    canonicalUrl,
    baseUrl,
    includeMermaid = false,
    mermaidScriptSrc = null,
    exportEnabled = false,
    pageSourceDownloadUrl = null,
    siteZipDownloadUrl = null,
  } = options;
  const pageTitle = title === siteTitle ? siteTitle : `${title} - ${siteTitle}`;

  const contentWithIds = addHeadingIds(content);
  const toc = extractToc(contentWithIds);
  const hasToc = toc.length > 1;

  const showExport = Boolean(
    exportEnabled && pageSourceDownloadUrl && siteZipDownloadUrl,
  );
  const rightPanel = renderRightPanel(toc, hasToc, showExport, pageSourceDownloadUrl, siteZipDownloadUrl);

  const mermaidBlock =
    includeMermaid && mermaidScriptSrc
      ? `<script src="${escapeHtml(mermaidScriptSrc)}" defer></script>
<script>
(function(){
  function theme(){var t=document.documentElement.dataset.theme;return t==='dark'||t==='light'?t:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}
  function api(){
    var g=typeof globalThis!=='undefined'?globalThis:(typeof window!=='undefined'?window:null);
    if(!g||!g.mermaid)return null;
    var m=g.mermaid;
    return (m.default&&typeof m.default.initialize==='function')?m.default:m;
  }
  function initMermaid(){
    var m=api();if(!m)return;
    m.initialize({startOnLoad:true,theme:theme()==='dark'?'dark':'default'});
    m.run();
  }
  document.addEventListener('DOMContentLoaded',initMermaid);
  document.addEventListener('nrdocs-theme-change',initMermaid);
})();
</script>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-Content-Type-Options" content="nosniff">
<meta http-equiv="X-Frame-Options" content="DENY">
<meta name="referrer" content="no-referrer">
<meta name="generator" content="nrdocs">
<title>${escapeHtml(pageTitle)}</title>
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<script>
(function(){try{var s=localStorage.getItem('nrdocs-theme');if(s==='light'||s==='dark')document.documentElement.dataset.theme=s;}catch(e){}})();
</script>
<style>
:root{
--text:#1a1a1a;--text-muted:#555;--text-footer:#888;
--bg-body:#fff;--bg-sidebar:#fafafa;--bg-hover:#e8e8e8;--bg-active:#e0e7ff;
--border:#e0e0e0;--border-light:#e8e8e8;
--link:#1d4ed8;--link-active:#1d4ed8;
--code-bg:#f3f4f6;--pre-bg:#1e1e1e;--pre-text:#d4d4d4;
--th-bg:#f5f5f5;--blockquote:#555;
--toc-title:#666;--toc-link:#555;
}
@media(prefers-color-scheme:dark){
html:not([data-theme]){
--text:#e5e5e5;--text-muted:#a3a3a3;--text-footer:#737373;
--bg-body:#0a0a0a;--bg-sidebar:#111;--bg-hover:#262626;--bg-active:#1e3a5f;
--border:#333;--border-light:#262626;
--link:#60a5fa;--link-active:#93c5fd;
--code-bg:#262626;--pre-bg:#1a1a1a;--pre-text:#d4d4d4;
--th-bg:#1a1a1a;--blockquote:#a3a3a3;
--toc-title:#a3a3a3;--toc-link:#a3a3a3;
}
}
html[data-theme="dark"]{
--text:#e5e5e5;--text-muted:#a3a3a3;--text-footer:#737373;
--bg-body:#0a0a0a;--bg-sidebar:#111;--bg-hover:#262626;--bg-active:#1e3a5f;
--border:#333;--border-light:#262626;
--link:#60a5fa;--link-active:#93c5fd;
--code-bg:#262626;--pre-bg:#1a1a1a;--pre-text:#d4d4d4;
--th-bg:#1a1a1a;--blockquote:#a3a3a3;
--toc-title:#a3a3a3;--toc-link:#a3a3a3;
}
html[data-theme="light"]{
--text:#1a1a1a;--text-muted:#555;--text-footer:#888;
--bg-body:#fff;--bg-sidebar:#fafafa;--bg-hover:#e8e8e8;--bg-active:#e0e7ff;
--border:#e0e0e0;--border-light:#e8e8e8;
--link:#1d4ed8;--link-active:#1d4ed8;
--code-bg:#f3f4f6;--pre-bg:#1e1e1e;--pre-text:#d4d4d4;
--th-bg:#f5f5f5;--blockquote:#555;
--toc-title:#666;--toc-link:#555;
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:1.0625rem;line-height:1.7;color:var(--text);background:var(--bg-body);display:flex;min-height:100vh}
nav.sidebar{width:260px;padding:1.5rem;border-right:1px solid var(--border);background:var(--bg-sidebar);overflow-y:auto;flex-shrink:0;position:sticky;top:0;height:100vh}
.site-header{margin-bottom:1rem}
nav.sidebar .site-title{font-weight:700;font-size:1.1rem;color:var(--text)}
.toc-toolbar{display:flex;justify-content:flex-end;gap:0.35rem;margin-bottom:1rem}
.icon-btn{width:2.5rem;height:2.5rem;border:1px solid currentColor;border-radius:0.5rem;background:var(--bg-body);color:var(--text);display:inline-grid;place-items:center;cursor:pointer;padding:0;flex-shrink:0}
.icon-btn svg{display:block}
.icon-btn:hover{background:var(--text);color:var(--bg-body)}
.export-menu{position:relative}
#export-menu-list{display:none;position:absolute;right:0;top:calc(100% + 4px);min-width:10rem;background:var(--bg-body);border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.12);z-index:20;padding:0.25rem 0;list-style:none}
#export-menu-list.open{display:block}
#export-menu-list a{color:var(--text);text-decoration:none;font-size:0.85rem;padding:0.4rem 0.75rem;display:block;white-space:nowrap}
#export-menu-list a:hover{background:var(--bg-hover);color:var(--link)}
nav.sidebar ul{list-style:none}
nav.sidebar li{margin-bottom:0.25rem}
nav.sidebar .nav-section{margin-top:0.5rem}
nav.sidebar .nav-section>summary{cursor:pointer;font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--toc-title);padding:0.35rem 0.6rem;list-style:none;border-radius:4px;user-select:none}
nav.sidebar .nav-section>summary::-webkit-details-marker{display:none}
nav.sidebar .nav-section>summary::before{content:"▸";display:inline-block;margin-right:0.35rem;transition:transform 0.15s ease}
nav.sidebar .nav-section[open]>summary::before{transform:rotate(90deg)}
nav.sidebar .nav-section>summary:hover{background:var(--bg-hover);color:var(--text)}
nav.sidebar .nav-section ul{padding-left:0.25rem;margin-top:0.15rem;margin-bottom:0.35rem}
nav.sidebar a{color:var(--text-muted);text-decoration:none;padding:0.3rem 0.6rem;display:block;border-radius:4px;font-size:0.95rem}
nav.sidebar a:hover{background:var(--bg-hover);color:var(--text)}
nav.sidebar a.active{background:var(--bg-active);color:var(--link-active);font-weight:500}
.content-wrapper{flex:1;display:flex;min-width:0}
main{flex:1;padding:2.5rem 3rem;max-width:52rem;min-width:0;overflow-wrap:break-word}
main h1{font-size:2.2rem;margin-bottom:1.2rem;border-bottom:1px solid var(--border);padding-bottom:0.5rem;line-height:1.3;color:var(--text)}
main h2{font-size:1.6rem;margin-top:2.5rem;margin-bottom:0.75rem;line-height:1.3;color:var(--text)}
main h3{font-size:1.3rem;margin-top:1.8rem;margin-bottom:0.5rem;line-height:1.4;color:var(--text)}
main p{margin-bottom:1.1rem}
main a{color:var(--link);text-decoration:underline}
main code{background:var(--code-bg);padding:0.2rem 0.4rem;border-radius:3px;font-size:0.88em;color:var(--text)}
main pre{background:var(--pre-bg);color:var(--pre-text);padding:1.2rem;border-radius:6px;overflow-x:auto;margin-bottom:1.2rem;font-size:0.9rem;line-height:1.5}
main pre code{background:none;padding:0;color:inherit;font-size:inherit}
main pre.mermaid{background:transparent;color:var(--text);padding:0;margin:1.5rem 0;overflow-x:auto}
main table{border-collapse:collapse;width:100%;margin-bottom:1.2rem}
main th,main td{border:1px solid var(--border);padding:0.6rem 0.85rem;text-align:left;color:var(--text)}
main th{background:var(--th-bg);font-weight:600}
main img{max-width:100%;height:auto;border-radius:4px}
main blockquote{border-left:4px solid var(--border);padding-left:1rem;margin-bottom:1.1rem;color:var(--blockquote);font-style:italic}
main ul,main ol{margin-bottom:1.1rem;padding-left:1.5rem}
main li{margin-bottom:0.3rem}
aside.toc-panel{width:220px;padding:1.5rem 1rem;position:sticky;top:0;height:100vh;overflow-y:auto;flex-shrink:0;border-left:1px solid var(--border-light);background:var(--bg-body)}
aside.toc-panel .toc-title{font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--toc-title);margin-bottom:0.75rem}
aside.toc-panel .toc-nav ul{list-style:none}
aside.toc-panel .toc-nav li{margin-bottom:0.3rem}
aside.toc-panel .toc-nav a{color:var(--toc-link);text-decoration:none;font-size:0.85rem;display:block;padding:0.15rem 0;border-radius:2px}
aside.toc-panel .toc-nav a:hover{color:var(--link)}
aside.toc-panel .toc-nav .toc-h3{padding-left:0.75rem}
footer{padding:1.5rem 0;border-top:1px solid var(--border-light);color:var(--text-footer);font-size:0.8rem;text-align:center;margin-top:2rem}
footer a{color:var(--link)}
@media(max-width:1100px){aside.toc-panel .toc-nav{display:none}}
@media(max-width:768px){body{flex-direction:column}nav.sidebar{width:100%;border-right:none;border-bottom:1px solid var(--border);position:static;height:auto}main{padding:1.5rem}}
</style>
</head>
<body>
<nav class="sidebar">
<div class="site-header">
<div class="site-title">${escapeHtml(siteTitle)}</div>
</div>
<ul>
${renderNavTree(nav, baseUrl)}
</ul>
</nav>
<div class="content-wrapper">
<main>
${contentWithIds}
<footer>Generated with <a href="https://github.com/noam-r/nrdocs">nrdocs</a></footer>
</main>
${rightPanel}
</div>
<script>
(function(){
  var key='nrdocs-theme';
  var root=document.documentElement;
  function resolved(){
    var t=root.dataset.theme;
    if(t==='dark'||t==='light')return t;
    return window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  }
  function apply(next){
    root.dataset.theme=next;
    try{localStorage.setItem(key,next);}catch(e){}
    document.dispatchEvent(new CustomEvent('nrdocs-theme-change',{detail:{theme:next}}));
  }
  var btn=document.getElementById('theme-toggle');
  if(btn){
    btn.addEventListener('click',function(){
      apply(resolved()==='dark'?'light':'dark');
    });
  }
  var exportBtn=document.getElementById('export-toggle');
  var exportMenu=document.getElementById('export-menu-list');
  if(exportBtn&&exportMenu){
    exportBtn.addEventListener('click',function(e){
      e.stopPropagation();
      exportMenu.classList.toggle('open');
    });
    document.addEventListener('click',function(){
      exportMenu.classList.remove('open');
    });
    exportMenu.addEventListener('click',function(e){e.stopPropagation();});
  }
})();
</script>
${mermaidBlock}
</body>
</html>`;
}

function renderRightPanel(
  toc: Array<{ id: string; text: string; level: number }>,
  hasToc: boolean,
  showExport: boolean,
  pageSourceDownloadUrl: string | null,
  siteZipDownloadUrl: string | null,
): string {
  const exportControl = showExport
    ? `<div class="export-menu">
<button type="button" class="icon-btn" id="export-toggle" aria-label="Export" aria-haspopup="true">${DOWNLOAD_ICON_SVG}</button>
<ul id="export-menu-list">
<li><a href="${escapeHtml(pageSourceDownloadUrl!)}" download>Page (.md)</a></li>
<li><a href="${escapeHtml(siteZipDownloadUrl!)}" download>Site (.zip)</a></li>
</ul>
</div>`
    : '';

  const tocBlock = hasToc
    ? (() => {
        const items = toc.map((entry) => {
          const cls = entry.level === 3 ? ' class="toc-h3"' : '';
          return `<li${cls}><a href="#${escapeHtml(entry.id)}">${escapeHtml(entry.text)}</a></li>`;
        }).join('\n');
        return `<div class="toc-title">On this page</div>
<div class="toc-nav"><ul>
${items}
</ul></div>`;
      })()
    : '';

  return `<aside class="toc-panel">
<div class="toc-toolbar">
${exportControl}
<button type="button" class="icon-btn" id="theme-toggle" aria-label="Toggle light/dark mode">${MOON_ICON_SVG}</button>
</div>
${tocBlock}
</aside>`;
}

function renderNavTree(entries: NavSidebarEntry[], baseUrl: string): string {
  return entries.map((entry) => renderNavNode(entry, baseUrl)).join('\n');
}

function renderNavNode(entry: NavSidebarEntry, baseUrl: string): string {
  if (entry.kind === 'link') {
    const href = baseUrl + entry.href;
    const activeClass = entry.active ? ' class="active"' : '';
    return `<li><a href="${escapeHtml(href)}"${activeClass}>${escapeHtml(entry.title)}</a></li>`;
  }

  const openAttr = entry.open !== false ? ' open' : '';
  const childItems = entry.children.map((c) => renderNavNode(c, baseUrl)).join('\n');
  return `<li class="nav-section"><details class="nav-details"${openAttr}><summary>${escapeHtml(entry.title)}</summary><ul>
${childItems}
</ul></details></li>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
