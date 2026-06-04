/**
 * Navigation auto-discovery from docs directory.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface NavItem {
  title: string;
  path: string;
  href: string;
  active?: boolean;
}

/** Config nav entry (path + title only; no href). */
export interface NavConfigEntry {
  title: string;
  /** Omitted for section-only entries that only have children. */
  path?: string;
  children?: NavConfigEntry[];
}

/** Sidebar tree node for rendered HTML (links and collapsible sections). */
export type NavSidebarEntry =
  | { kind: 'link'; title: string; path: string; href: string; active?: boolean }
  | { kind: 'section'; title: string; children: NavSidebarEntry[]; open?: boolean };

export interface DiscoverNavOptions {
  /** Home page path relative to content dir (default index.md). */
  indexPath?: string;
}

/**
 * Extracts a title from Markdown content.
 * Uses the first H1 heading if present, otherwise derives from filename.
 */
export function extractTitle(markdownContent: string, filePath: string): string {
  const match = markdownContent.match(/^#\s+(.+)$/m);
  if (match) {
    return match[1]!.trim();
  }
  const basename = path.basename(filePath, '.md');
  if (basename === 'index') {
    return 'Home';
  }
  return basename
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * True for empty or legacy init stub content at docs/index.md (not real docs).
 */
export function isSkippablePlaceholderIndex(
  contentDir: string,
  relativePath: string,
): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  if (path.dirname(normalized) !== '.') return false;

  const full = path.join(contentDir, normalized);
  let text: string;
  try {
    text = fs.readFileSync(full, 'utf-8').trim();
  } catch {
    return false;
  }

  if (text.length === 0) return true;
  if (text.includes('Welcome to your documentation site powered by nrdocs')) return true;
  if (text.includes('Edit this file to add your documentation content')) return true;
  return false;
}

/**
 * Recursively finds all .md files in a directory.
 */
export function findMarkdownFiles(dir: string, relativeTo: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(fullPath, relativeTo));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(path.relative(relativeTo, fullPath).replace(/\\/g, '/'));
    }
  }

  return results;
}

/**
 * Sorts markdown paths: configured index first, then numeric-aware path order.
 */
export function sortNavPaths(files: string[], indexPath = 'index.md'): string[] {
  const normalizedIndex = indexPath.replace(/\\/g, '/');
  const sorted = [...files].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const indexIdx = sorted.indexOf(normalizedIndex);
  if (indexIdx <= 0) return sorted;

  const without = sorted.filter((f) => f !== normalizedIndex);
  return [normalizedIndex, ...without];
}

/**
 * Converts a .md file path to a clean URL path segment.
 */
export function mdPathToHref(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const withoutExt = normalized.replace(/\.md$/, '');
  if (withoutExt === 'index' || withoutExt.endsWith('/index')) {
    const dir = withoutExt === 'index' ? '' : withoutExt.slice(0, -'/index'.length);
    return dir ? `${dir}/` : '';
  }
  return `${withoutExt}/`;
}

function navEntryFromFile(contentDir: string, file: string): NavConfigEntry {
  const fullPath = path.join(contentDir, file);
  const content = fs.readFileSync(fullPath, 'utf-8');
  return {
    title: extractTitle(content, file),
    path: file,
  };
}

/**
 * Humanizes a folder segment for use as a section title.
 */
export function folderSegmentToTitle(segment: string): string {
  if (segment === 'index') return 'Home';
  return segment
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Groups discovered markdown files into nav sections by top-level folder.
 * Root-level pages are top-level links; each first-level directory becomes a section.
 */
export function groupNavEntriesByFolders(
  files: string[],
  contentDir: string,
  indexPath = 'index.md',
): NavConfigEntry[] {
  const sorted = sortNavPaths(files, indexPath);
  const rootLinks: NavConfigEntry[] = [];
  const byFolder = new Map<string, string[]>();

  for (const file of sorted) {
    const dir = path.dirname(file).replace(/\\/g, '/');
    if (dir === '.') {
      rootLinks.push(navEntryFromFile(contentDir, file));
      continue;
    }
    const top = dir.split('/')[0]!;
    const list = byFolder.get(top) ?? [];
    list.push(file);
    byFolder.set(top, list);
  }

  const sections: NavConfigEntry[] = [];
  for (const folder of [...byFolder.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  )) {
    const paths = sortNavPaths(byFolder.get(folder)!, indexPath);
    sections.push({
      title: folderSegmentToTitle(folder),
      children: paths.map((f) => navEntryFromFile(contentDir, f)),
    });
  }

  return [...rootLinks, ...sections];
}

/**
 * Discovers nav config entries from markdown files, grouped by folder sections.
 */
export function discoverNavEntries(
  contentDir: string,
  options?: DiscoverNavOptions,
): NavConfigEntry[] {
  const indexPath = (options?.indexPath ?? 'index.md').replace(/\\/g, '/');
  const files = findMarkdownFiles(contentDir, contentDir).filter(
    (f) => !isSkippablePlaceholderIndex(contentDir, f),
  );
  return groupNavEntriesByFolders(files, contentDir, indexPath);
}

/**
 * Flattens explicit nav config (including nested children) to NavItem list.
 */
export function navConfigToNavItems(
  entries: NavConfigEntry[],
  contentDir: string,
): NavItem[] {
  const items: NavItem[] = [];

  const walk = (list: NavConfigEntry[]) => {
    for (const entry of list) {
      if (entry.path) {
        const normalizedPath = entry.path.replace(/\\/g, '/');
        items.push({
          title: entry.title,
          path: normalizedPath,
          href: mdPathToHref(normalizedPath),
        });
      }
      if (entry.children?.length) {
        walk(entry.children);
      }
    }
  };

  walk(entries);

  if (items.length === 0) {
    throw new Error('Nav has no pages (entries need path or nested children with paths)');
  }

  for (const item of items) {
    const full = path.join(contentDir, item.path);
    if (!fs.existsSync(full)) {
      throw new Error(`Nav path not found: ${item.path}`);
    }
  }

  return items;
}

/**
 * Builds a sidebar tree from nav config (sections, links, active state).
 */
export function navConfigToSidebar(
  entries: NavConfigEntry[],
  activePath?: string,
): NavSidebarEntry[] {
  const normalizedActive = activePath?.replace(/\\/g, '/');

  const mapEntry = (entry: NavConfigEntry): NavSidebarEntry | null => {
    const children = entry.children?.length
      ? entry.children.map(mapEntry).filter((n): n is NavSidebarEntry => n !== null)
      : [];

    if (entry.path) {
      const normalizedPath = entry.path.replace(/\\/g, '/');
      return {
        kind: 'link',
        title: entry.title,
        path: normalizedPath,
        href: mdPathToHref(normalizedPath),
        active: normalizedActive === normalizedPath,
      };
    }

    if (children.length === 0) return null;

    const open = normalizedActive
      ? children.some((c) => sidebarContainsActive(c, normalizedActive))
      : true;

    return { kind: 'section', title: entry.title, children, open };
  };

  return entries.map(mapEntry).filter((n): n is NavSidebarEntry => n !== null);
}

function sidebarContainsActive(entry: NavSidebarEntry, activePath: string): boolean {
  if (entry.kind === 'link') return entry.path === activePath;
  return entry.children.some((c) => sidebarContainsActive(c, activePath));
}

/**
 * Auto-discovers navigation from the docs directory.
 */
export function generateAutoNav(docsDir: string, indexPath = 'index.md'): NavItem[] {
  const entries = discoverNavEntries(docsDir, { indexPath });
  return navConfigToNavItems(entries, docsDir);
}

/**
 * Collects all paths from a nav config (flat), for validation.
 */
export function flattenNavPaths(entries: NavConfigEntry[]): string[] {
  const paths: string[] = [];
  const walk = (list: NavConfigEntry[]) => {
    for (const e of list) {
      if (e.path) paths.push(e.path.replace(/\\/g, '/'));
      if (e.children?.length) walk(e.children);
    }
  };
  walk(entries);
  return paths;
}
