import type { NavConfig, NavItem } from '../types.js';

/**
 * Validate that every leaf page referenced in the nav config exists in the
 * available pages set. Throws with a descriptive error listing all missing pages.
 *
 * Requirements: 12.4
 */
export function validateNavReferences(navConfig: NavConfig, availablePages: Set<string>): void {
  const missing: string[] = [];
  collectMissingPaths(navConfig.nav, availablePages, missing);

  if (missing.length > 0) {
    throw new Error(
      `nav.yml references pages that do not exist in /content: ${missing.join(', ')}`
    );
  }
}

/**
 * Generate an HTML `<nav>` element with nested `<ul>/<li>` structure from the
 * nav config. Leaf items become links; section items become headings with
 * nested lists. Items whose path is in `hiddenPages` are excluded.
 * The current page (if provided) receives `aria-current="page"`.
 *
 * Links are generated relative to the current page so they work both
 * when served by the Delivery Worker (under `/<slug>/`) and when opened
 * directly from the filesystem (`file://`).
 *
 * Requirements: 12.1, 12.2, 12.3, 11.4
 */
export function generateNavHtml(
  navConfig: NavConfig,
  hiddenPages: Set<string>,
  currentPath?: string,
): string {
  const inner = renderItems(navConfig.nav, hiddenPages, currentPath);
  return `<nav><ul>${inner}</ul></nav>`;
}

// ── Internal helpers ─────────────────────────────────────────────────

function collectMissingPaths(
  items: NavItem[],
  availablePages: Set<string>,
  missing: string[],
): void {
  for (const item of items) {
    if (item.path !== undefined) {
      if (!availablePages.has(item.path)) {
        missing.push(item.path);
      }
    }
    if (item.children) {
      collectMissingPaths(item.children, availablePages, missing);
    }
  }
}

/**
 * Compute a relative URL from the current page to a target page.
 *
 * Both `currentPath` and `targetPath` are content keys like
 * `getting-started` or `guides/installation`. Each page is served at
 * `<path>/index.html`, so the "directory" of the current page is
 * `<currentPath>/`.
 *
 * Examples (currentPath → targetPath → result):
 *   getting-started → api-reference        → ../api-reference/
 *   getting-started → guides/installation  → ../guides/installation/
 *   guides/installation → getting-started  → ../../getting-started/
 *   guides/installation → guides/config    → ../config/
 */
function relativePath(currentPath: string | undefined, targetPath: string): string {
  if (currentPath === undefined) {
    // No current page context — fall back to root-relative
    return `/${targetPath}/`;
  }

  // The current page lives at <currentPath>/index.html, so its
  // "directory" has depth = number of segments in currentPath + 1
  // (the extra +1 is for the page's own directory).
  const currentSegments = currentPath.split('/');
  const ups = currentSegments.length; // one ".." per segment

  const prefix = '../'.repeat(ups);
  return `${prefix}${targetPath}/index.html`;
}

function renderItems(
  items: NavItem[],
  hiddenPages: Set<string>,
  currentPath?: string,
): string {
  let html = '';

  for (const item of items) {
    // Leaf item
    if (item.path !== undefined) {
      if (hiddenPages.has(item.path)) {
        continue;
      }
      const href = relativePath(currentPath, item.path);
      const ariaCurrent = currentPath !== undefined && item.path === currentPath
        ? ' aria-current="page"'
        : '';
      html += `<li><a href="${href}"${ariaCurrent}>${escapeHtml(item.label)}</a></li>`;
      continue;
    }

    // Section item
    if (item.section && item.children) {
      const childrenHtml = renderItems(item.children, hiddenPages, currentPath);
      // If all children were hidden, skip the section entirely
      if (childrenHtml === '') {
        continue;
      }
      html += `<li><span>${escapeHtml(item.label)}</span><ul>${childrenHtml}</ul></li>`;
    }
  }

  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
