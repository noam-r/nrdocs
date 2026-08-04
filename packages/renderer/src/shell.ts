import { escapeAttr, escapeHtml } from './escape.js';
import { routeRelativeHref } from './relative-href.js';
import type { PublicationNavNode } from './types.js';

export type ShellInput = {
  language: string;
  direction: string;
  siteTitle: string;
  pageTitle: string;
  pageRoute: string;
  articleHtml: string;
  navTree: PublicationNavNode[];
  prev: { title: string; route: string } | null;
  next: { title: string; route: string } | null;
};

function renderNavList(
  nodes: PublicationNavNode[],
  currentRoute: string,
  pageRoute: string,
): string {
  if (nodes.length === 0) return '';
  const items = nodes
    .map((n) => {
      if (n.kind === 'section-heading') {
        const nested = renderNavList(n.children, currentRoute, pageRoute);
        return `<li class="nr-nav-item"><span class="nr-nav-section">${escapeHtml(n.title)}</span>${nested}</li>`;
      }
      const href = routeRelativeHref(pageRoute, n.route!);
      const current = n.route === currentRoute ? ' aria-current="page"' : '';
      const nested = renderNavList(n.children, currentRoute, pageRoute);
      return `<li class="nr-nav-item"><a href="${escapeAttr(href)}"${current}>${escapeHtml(n.title)}</a>${nested}</li>`;
    })
    .join('\n');
  return `<ul class="nr-nav-list">\n${items}\n</ul>`;
}

function renderPagination(
  pageRoute: string,
  prev: ShellInput['prev'],
  next: ShellInput['next'],
): string {
  if (!prev && !next) return '';
  const parts: string[] = [];
  if (prev) {
    parts.push(
      `<a class="nr-prev" href="${escapeAttr(routeRelativeHref(pageRoute, prev.route))}">${escapeHtml(prev.title)}</a>`,
    );
  }
  if (next) {
    parts.push(
      `<a class="nr-next" href="${escapeAttr(routeRelativeHref(pageRoute, next.route))}">${escapeHtml(next.title)}</a>`,
    );
  }
  return `<nav class="nr-pagination" aria-label="Page navigation">\n${parts.join('\n')}\n</nav>`;
}

/** Assemble a complete fixed-shell HTML5 document with LF and two-space indentation. */
export function assemblePageDocument(input: ShellInput): string {
  const title = `${input.pageTitle} · ${input.siteTitle}`;
  const siteRootHref = routeRelativeHref(input.pageRoute, '/');
  const nav = renderNavList(input.navTree, input.pageRoute, input.pageRoute);
  const pagination = renderPagination(input.pageRoute, input.prev, input.next);

  // Indent article content by 8 spaces for stable snapshot formatting
  const articleBody = input.articleHtml
    .trimEnd()
    .split('\n')
    .map((line) => (line.length ? `        ${line}` : ''))
    .join('\n');

  const lines = [
    '<!doctype html>',
    `<html lang="${escapeAttr(input.language)}" dir="${escapeAttr(input.direction)}">`,
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width,initial-scale=1">',
    `  <title>${escapeHtml(title)}</title>`,
    '  <link rel="stylesheet" href="/_nrdocs/v1/reader.css">',
    '  <script type="module" src="/_nrdocs/v1/reader.js"></script>',
    '</head>',
    '<body>',
    '  <a class="nr-skip" href="#nr-content">Skip to content</a>',
    '  <header class="nr-header">',
    '    <button class="nr-nav-toggle" type="button" aria-controls="nr-nav" aria-expanded="false">Menu</button>',
    `    <a class="nr-site-title" href="${escapeAttr(siteRootHref)}">${escapeHtml(input.siteTitle)}</a>`,
    '    <button class="nr-theme-toggle" type="button" aria-label="Change color theme">Theme</button>',
    '  </header>',
    '  <div class="nr-layout">',
    '    <aside class="nr-sidebar" id="nr-nav">',
    '      <nav class="nr-nav" aria-label="Documentation">',
    ...nav
      .split('\n')
      .filter((l) => l.length)
      .map((l) => `        ${l}`),
    '      </nav>',
    '    </aside>',
    '    <main class="nr-main" id="nr-content" tabindex="-1">',
    '      <article class="nr-article">',
    articleBody,
    ...(pagination
      ? pagination
          .split('\n')
          .filter((l) => l.length)
          .map((l) => `        ${l}`)
      : []),
    '      </article>',
    '    </main>',
    '  </div>',
    '  <footer class="nr-footer">Published with nrdocs</footer>',
    '</body>',
    '</html>',
    '',
  ];
  return lines.join('\n');
}

/** Flatten navigable pages in nav order for prev/next. */
export function flattenNavigablePages(
  nodes: PublicationNavNode[],
): Array<{ title: string; route: string; sourceFile: string }> {
  const out: Array<{ title: string; route: string; sourceFile: string }> = [];
  const walk = (list: PublicationNavNode[]) => {
    for (const n of list) {
      if (n.kind === 'page' && n.route && n.sourceFile) {
        out.push({ title: n.title, route: n.route, sourceFile: n.sourceFile });
      }
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
