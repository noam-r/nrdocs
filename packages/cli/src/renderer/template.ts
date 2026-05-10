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
    if (attrs.includes('id=')) return _match; // already has an id
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
  const { title, siteTitle, content, nav, canonicalUrl, baseUrl } = options;
  const pageTitle = title === siteTitle ? siteTitle : `${title} - ${siteTitle}`;

  // Add IDs to headings and extract TOC
  const contentWithIds = addHeadingIds(content);
  const toc = extractToc(contentWithIds);
  const hasToc = toc.length > 1;

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
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:1.0625rem;line-height:1.7;color:#1a1a1a;display:flex;min-height:100vh}
nav.sidebar{width:260px;padding:1.5rem;border-right:1px solid #e0e0e0;background:#fafafa;overflow-y:auto;flex-shrink:0;position:sticky;top:0;height:100vh}
nav.sidebar .site-title{font-weight:700;font-size:1.1rem;margin-bottom:1rem;color:#111}
nav.sidebar ul{list-style:none}
nav.sidebar li{margin-bottom:0.25rem}
nav.sidebar a{color:#333;text-decoration:none;padding:0.3rem 0.6rem;display:block;border-radius:4px;font-size:0.95rem}
nav.sidebar a:hover{background:#e8e8e8}
nav.sidebar a.active{background:#e0e7ff;color:#1d4ed8;font-weight:500}
.content-wrapper{flex:1;display:flex;min-width:0}
main{flex:1;padding:2.5rem 3rem;max-width:52rem;min-width:0;overflow-wrap:break-word}
main h1{font-size:2.2rem;margin-bottom:1.2rem;border-bottom:1px solid #e0e0e0;padding-bottom:0.5rem;line-height:1.3}
main h2{font-size:1.6rem;margin-top:2.5rem;margin-bottom:0.75rem;line-height:1.3}
main h3{font-size:1.3rem;margin-top:1.8rem;margin-bottom:0.5rem;line-height:1.4}
main p{margin-bottom:1.1rem}
main a{color:#1d4ed8;text-decoration:underline}
main code{background:#f3f4f6;padding:0.2rem 0.4rem;border-radius:3px;font-size:0.88em}
main pre{background:#1e1e1e;color:#d4d4d4;padding:1.2rem;border-radius:6px;overflow-x:auto;margin-bottom:1.2rem;font-size:0.9rem;line-height:1.5}
main pre code{background:none;padding:0;color:inherit;font-size:inherit}
main table{border-collapse:collapse;width:100%;margin-bottom:1.2rem}
main th,main td{border:1px solid #d0d0d0;padding:0.6rem 0.85rem;text-align:left}
main th{background:#f5f5f5;font-weight:600}
main img{max-width:100%;height:auto;border-radius:4px}
main blockquote{border-left:4px solid #d0d0d0;padding-left:1rem;margin-bottom:1.1rem;color:#555;font-style:italic}
main ul,main ol{margin-bottom:1.1rem;padding-left:1.5rem}
main li{margin-bottom:0.3rem}
aside.toc{width:220px;padding:1.5rem 1rem;position:sticky;top:0;height:100vh;overflow-y:auto;flex-shrink:0;border-left:1px solid #e8e8e8}
aside.toc .toc-title{font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#666;margin-bottom:0.75rem}
aside.toc ul{list-style:none}
aside.toc li{margin-bottom:0.3rem}
aside.toc a{color:#555;text-decoration:none;font-size:0.85rem;display:block;padding:0.15rem 0;border-radius:2px}
aside.toc a:hover{color:#1d4ed8}
aside.toc .toc-h3{padding-left:0.75rem}
footer{padding:1.5rem 3rem;border-top:1px solid #e8e8e8;color:#888;font-size:0.8rem;text-align:center}
@media(max-width:1100px){aside.toc{display:none}}
@media(max-width:768px){body{flex-direction:column}nav.sidebar{width:100%;border-right:none;border-bottom:1px solid #e0e0e0;position:static;height:auto}main{padding:1.5rem}}
</style>
</head>
<body>
<nav class="sidebar">
<div class="site-title">${escapeHtml(siteTitle)}</div>
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
