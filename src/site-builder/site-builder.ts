import type { ProjectConfig, NavConfig, NavItem } from '../types.js';
import { validateSlugMatch } from './config-parser.js';
import { parseMarkdownPage, type TocEntry } from './markdown-parser.js';
import { validateNavReferences, generateNavHtml } from './nav-generator.js';

/** A single built artifact ready for upload to R2. */
export interface SiteArtifact {
  path: string;
  content: ArrayBuffer;
  contentType: string;
}

/**
 * Build a map from page path → nav label by walking the nav tree.
 * Used to derive page titles when frontmatter doesn't specify one.
 */
function buildNavLabelMap(items: NavItem[]): Map<string, string> {
  const map = new Map<string, string>();
  function walk(nodes: NavItem[]) {
    for (const item of nodes) {
      if (item.path !== undefined) {
        map.set(item.path, item.label);
      }
      if (item.children) {
        walk(item.children);
      }
    }
  }
  walk(items);
  return map;
}

/**
 * Render the in-page TOC HTML from extracted headings.
 * Returns empty string if there are no headings.
 */
function renderTocHtml(toc: TocEntry[]): string {
  if (toc.length === 0) return '';

  let html = '<aside class="toc"><div class="toc-heading">On this page</div>';
  for (const entry of toc) {
    const cls = entry.level === 3 ? ' class="toc-item toc-item--sub"' : ' class="toc-item"';
    html += `<a${cls} href="#${escapeHtml(entry.id)}">${escapeHtml(entry.text)}</a>`;
  }
  html += '</aside>';
  return html;
}

/**
 * Wrap rendered Markdown content in the standard HTML5 page template
 * with a navigation sidebar, optional right-side TOC, and project title header.
 *
 * Requirements: 11.5, 12.3
 */
export function renderPageHtml(
  pageTitle: string,
  projectTitle: string,
  navHtml: string,
  contentHtml: string,
  toc: TocEntry[],
): string {
  const tocHtml = renderTocHtml(toc);
  const hasToc = toc.length > 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle)} — ${escapeHtml(projectTitle)}</title>
<style>
${CSS}
</style>
</head>
<body>
<aside class="sidebar">
  <div class="sidebar-brand">${escapeHtml(projectTitle)}</div>
  <div class="sidebar-scroll">${navHtml}</div>
</aside>
<div class="wrapper${hasToc ? ' has-toc' : ''}">
  <main class="content">
    <article class="article">${contentHtml}</article>
  </main>
  ${tocHtml}
</div>
</body>
</html>`;
}

// ── CSS ──────────────────────────────────────────────────────────────

const CSS = `
:root {
  --sidebar-w: 272px;
  --content-max: 860px;
  --toc-w: 220px;
  --c-bg: #ffffff;
  --c-surface: #f7f7f8;
  --c-sidebar: #fafafa;
  --c-border: #e4e4e7;
  --c-text: #18181b;
  --c-muted: #71717a;
  --c-accent: #2563eb;
  --c-active-bg: #eff6ff;
  --c-active: #1d4ed8;
  --c-pre-bg: #1c1c27;
  --c-pre-text: #d4d4d8;
  --font: 'Source Serif 4', Georgia, 'Times New Roman', serif;
  --font-mono: 'SFMono-Regular', 'Courier New', Consolas, 'Liberation Mono', Menlo, monospace;
  --text-base: 18px;
  --lh: 1.8;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html {
  font-size: var(--text-base);
  scroll-behavior: smooth;
  -webkit-text-size-adjust: 100%;
}

body {
  font-family: var(--font);
  line-height: var(--lh);
  color: var(--c-text);
  background: var(--c-bg);
  display: flex;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a { color: var(--c-accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* ── Sidebar ─────────────────────────────────────────── */

.sidebar {
  position: fixed;
  top: 0; left: 0;
  width: var(--sidebar-w);
  height: 100vh;
  background: var(--c-sidebar);
  border-right: 1px solid var(--c-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 200;
}

.sidebar-brand {
  padding: 1.25rem 1.25rem 1rem;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--c-text);
  border-bottom: 1px solid var(--c-border);
  background: var(--c-sidebar);
  flex-shrink: 0;
}

.sidebar-scroll {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 2rem;
  scrollbar-width: thin;
  scrollbar-color: var(--c-border) transparent;
}
.sidebar-scroll::-webkit-scrollbar { width: 4px; }
.sidebar-scroll::-webkit-scrollbar-thumb { background: var(--c-border); border-radius: 2px; }

.sidebar nav { padding: 0.75rem 0.75rem; }
.sidebar nav ul { list-style: none; padding: 0; margin: 0; }
.sidebar nav ul ul { padding-left: 0.625rem; }

.sidebar nav a {
  display: block;
  padding: 0.375rem 0.625rem;
  border-radius: 6px;
  font-size: 0.9rem;
  line-height: 1.45;
  color: var(--c-muted);
  text-decoration: none;
  margin-bottom: 1px;
  transition: background 0.12s, color 0.12s;
}
.sidebar nav a:hover {
  background: var(--c-border);
  color: var(--c-text);
  text-decoration: none;
}
.sidebar nav a[aria-current="page"] {
  background: var(--c-active-bg);
  color: var(--c-active);
  font-weight: 600;
}

.sidebar nav > ul > li > span {
  display: block;
  padding: 0.5rem 0.625rem 0.25rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--c-text);
  margin-top: 0.5rem;
}

/* ── Wrapper (content + TOC grid) ────────────────────── */

.wrapper {
  margin-left: var(--sidebar-w);
  flex: 1;
  padding: 2.75rem clamp(1.5rem, 5vw, 3.5rem);
  display: flex;
  gap: 3rem;
  align-items: flex-start;
}

/* ── Content ─────────────────────────────────────────── */

.content {
  flex: 1;
  min-width: 0;
  max-width: var(--content-max);
}

.article { max-width: var(--content-max); }

.article h1 {
  font-size: 2.125rem;
  font-weight: 800;
  letter-spacing: -0.035em;
  line-height: 1.2;
  margin-bottom: 1.125rem;
}

.article h2 {
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.3;
  margin-top: 2.75rem;
  margin-bottom: 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid var(--c-border);
}

.article h3 {
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.35;
  margin-top: 2rem;
  margin-bottom: 0.5rem;
}

.article h4 {
  font-size: 1.05rem;
  font-weight: 700;
  margin-top: 1.5rem;
  margin-bottom: 0.4rem;
}

.article p { margin-bottom: 1.25rem; }

.article ul, .article ol {
  margin-bottom: 1.25rem;
  padding-left: 1.625rem;
}
.article li { margin-bottom: 0.35rem; }
.article li > ul, .article li > ol { margin-top: 0.25rem; margin-bottom: 0.5rem; }

.article code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 4px;
  padding: 0.1em 0.4em;
  word-break: break-word;
}

.article pre {
  background: var(--c-pre-bg);
  color: var(--c-pre-text);
  border-radius: 10px;
  padding: 1.25rem 1.5rem;
  overflow-x: auto;
  margin-bottom: 1.5rem;
  line-height: 1.65;
}
.article pre code {
  background: none;
  border: none;
  padding: 0;
  font-size: 0.9rem;
  color: inherit;
  word-break: normal;
}

.article blockquote {
  margin: 0 0 1.5rem;
  padding: 0.875rem 1.25rem;
  border-left: 3px solid var(--c-accent);
  background: var(--c-active-bg);
  border-radius: 0 8px 8px 0;
}
.article blockquote p:last-child { margin-bottom: 0; }

.article table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.925rem;
  margin-bottom: 1.5rem;
}
.article th {
  font-weight: 700;
  background: var(--c-surface);
  text-align: left;
  padding: 0.625rem 0.875rem;
  border-bottom: 2px solid var(--c-border);
}
.article td {
  padding: 0.575rem 0.875rem;
  border-bottom: 1px solid var(--c-border);
}
.article tr:last-child td { border-bottom: none; }

.article img { max-width: 100%; height: auto; border-radius: 8px; }

.article hr {
  border: none;
  border-top: 1px solid var(--c-border);
  margin: 2rem 0;
}

/* ── TOC (right rail) ────────────────────────────────── */

.toc {
  position: sticky;
  top: 2.75rem;
  width: var(--toc-w);
  max-height: calc(100vh - 5.5rem);
  overflow-y: auto;
  flex-shrink: 0;
  padding-left: 1rem;
  border-left: 1px solid var(--c-border);
  scrollbar-width: thin;
  scrollbar-color: var(--c-border) transparent;
}

.toc-heading {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--c-muted);
  margin-bottom: 0.625rem;
}

.toc-item {
  display: block;
  font-size: 0.84rem;
  color: var(--c-muted);
  text-decoration: none;
  padding: 0.2rem 0;
  line-height: 1.5;
  transition: color 0.12s;
}
.toc-item:hover { color: var(--c-accent); text-decoration: none; }
.toc-item--sub { padding-left: 0.875rem; font-size: 0.82rem; }

/* ── Responsive ──────────────────────────────────────── */

@media (max-width: 1100px) {
  .toc { display: none; }
}

@media (max-width: 768px) {
  .sidebar { display: none; }
  .wrapper { margin-left: 0; padding: 1.5rem 1.125rem; }
  .article h1 { font-size: 1.75rem; }
  .article h2 { font-size: 1.25rem; }
}
`;

/**
 * Find the first leaf page path in the nav tree (used for root redirect).
 */
function findFirstNavPage(items: NavItem[]): string | null {
  for (const item of items) {
    if (item.path !== undefined) return item.path;
    if (item.children) {
      const found = findFirstNavPage(item.children);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Build the complete static site from project config, nav config, and raw
 * Markdown pages. Returns an array of SiteArtifact objects ready for R2 upload.
 */
export function buildSite(
  projectConfig: ProjectConfig,
  navConfig: NavConfig,
  pages: Map<string, string>,
  registeredSlug: string,
): SiteArtifact[] {
  // 1. Validate slug match
  validateSlugMatch(projectConfig, registeredSlug);

  // 2. Parse all Markdown pages
  const parsed = new Map<string, ReturnType<typeof parseMarkdownPage>>();
  for (const [path, content] of pages) {
    parsed.set(path, parseMarkdownPage(content, path));
  }

  // 3. Validate nav references against available pages
  const availablePages = new Set(pages.keys());
  validateNavReferences(navConfig, availablePages);

  // 4. Collect hidden pages
  const hiddenPages = new Set<string>();
  for (const [path, page] of parsed) {
    if (page.frontmatter.hidden === true) {
      hiddenPages.add(path);
    }
  }

  // 5–6. Generate nav and render each page
  const encoder = new TextEncoder();
  const artifacts: SiteArtifact[] = [];
  const projectTitle = projectConfig.title || 'nrdocs';
  const navLabelMap = buildNavLabelMap(navConfig.nav);

  for (const [path, page] of parsed) {
    // Resolve page title: frontmatter title → nav label → fallback to path
    const pageTitle = page.frontmatter.title
      || navLabelMap.get(path)
      || path.split('/').pop() || path;

    const navHtml = generateNavHtml(navConfig, hiddenPages, path);
    const html = renderPageHtml(
      pageTitle,
      projectTitle,
      navHtml,
      page.html,
      page.toc,
    );
    artifacts.push({
      path: `${path}/index.html`,
      content: encoder.encode(html).buffer as ArrayBuffer,
      contentType: 'text/html; charset=utf-8',
    });
  }

  // Generate a root index.html that redirects to the first nav page
  const firstPage = findFirstNavPage(navConfig.nav);
  if (firstPage) {
    const redirectHtml = `<!DOCTYPE html>
<html><head><meta http-equiv="refresh" content="0;url=${firstPage}/index.html"><title>Redirecting…</title></head>
<body><p>Redirecting to <a href="${firstPage}/index.html">${escapeHtml(firstPage)}</a>…</p></body></html>`;
    artifacts.push({
      path: 'index.html',
      content: encoder.encode(redirectHtml).buffer as ArrayBuffer,
      contentType: 'text/html; charset=utf-8',
    });
  }

  return artifacts;
}

// ── Internal helpers ─────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
