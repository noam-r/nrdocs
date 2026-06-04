/**
 * HTML template generation for rendered documentation pages.
 */
import type { NavItem } from './navigation.js';

export interface TemplateOptions {
  title: string;
  siteTitle: string;
  content: string;
  nav: NavItem[];
  canonicalUrl: string;
  baseUrl: string;
  /** Page contains mermaid diagrams */
  includeMermaid?: boolean;
  /** Relative src to _nrdocs/mermaid.min.js from this page */
  mermaidScriptSrc?: string | null;
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
  } = options;
  const pageTitle = title === siteTitle ? siteTitle : `${title} - ${siteTitle}`;

  const contentWithIds = addHeadingIds(content);
  const toc = extractToc(contentWithIds);
  const hasToc = toc.length > 1;

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
.site-header{display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin-bottom:1rem}
nav.sidebar .site-title{font-weight:700;font-size:1.1rem;color:var(--text);flex:1;min-width:0}
#theme-toggle{background:var(--bg-hover);border:1px solid var(--border);border-radius:6px;padding:0.35rem 0.5rem;cursor:pointer;font-size:1rem;line-height:1;color:var(--text);flex-shrink:0}
#theme-toggle:hover{background:var(--bg-active)}
nav.sidebar ul{list-style:none}
nav.sidebar li{margin-bottom:0.25rem}
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
aside.toc{width:220px;padding:1.5rem 1rem;position:sticky;top:0;height:100vh;overflow-y:auto;flex-shrink:0;border-left:1px solid var(--border-light);background:var(--bg-body)}
aside.toc .toc-title{font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--toc-title);margin-bottom:0.75rem}
aside.toc ul{list-style:none}
aside.toc li{margin-bottom:0.3rem}
aside.toc a{color:var(--toc-link);text-decoration:none;font-size:0.85rem;display:block;padding:0.15rem 0;border-radius:2px}
aside.toc a:hover{color:var(--link)}
aside.toc .toc-h3{padding-left:0.75rem}
footer{padding:1.5rem 0;border-top:1px solid var(--border-light);color:var(--text-footer);font-size:0.8rem;text-align:center;margin-top:2rem}
footer a{color:var(--link)}
@media(max-width:1100px){aside.toc{display:none}}
@media(max-width:768px){body{flex-direction:column}nav.sidebar{width:100%;border-right:none;border-bottom:1px solid var(--border);position:static;height:auto}main{padding:1.5rem}}
</style>
</head>
<body>
<nav class="sidebar">
<div class="site-header">
<div class="site-title">${escapeHtml(siteTitle)}</div>
<button type="button" id="theme-toggle" aria-label="Toggle color theme" title="Toggle light/dark mode">&#9789;</button>
</div>
<ul>
${renderNavItems(nav, baseUrl)}
</ul>
</nav>
<div class="content-wrapper">
<main>
${contentWithIds}
<footer>Generated with <a href="https://github.com/noam-r/nrdocs">nrdocs</a></footer>
</main>
${hasToc ? renderToc(toc) : ''}
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
    var btn=document.getElementById('theme-toggle');
    if(btn)btn.textContent=next==='dark'?'\\u2600':'\\u263E';
  }
  var btn=document.getElementById('theme-toggle');
  if(btn){
    btn.textContent=resolved()==='dark'?'\\u2600':'\\u263E';
    btn.addEventListener('click',function(){
      apply(resolved()==='dark'?'light':'dark');
    });
  }
})();
</script>
${mermaidBlock}
</body>
</html>`;
}

function renderToc(toc: Array<{ id: string; text: string; level: number }>): string {
  const items = toc.map((entry) => {
    const cls = entry.level === 3 ? ' class="toc-h3"' : '';
    return `<li${cls}><a href="#${escapeHtml(entry.id)}">${escapeHtml(entry.text)}</a></li>`;
  }).join('\n');

  return `<aside class="toc">
<div class="toc-title">On this page</div>
<ul>
${items}
</ul>
</aside>`;
}

function renderNavItems(items: NavItem[], baseUrl: string): string {
  return items
    .map((item) => {
      const href = baseUrl + item.href;
      const activeClass = item.active ? ' class="active"' : '';
      return `<li><a href="${escapeHtml(href)}"${activeClass}>${escapeHtml(item.title)}</a></li>`;
    })
    .join('\n');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
