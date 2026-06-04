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
  path: string;
  children?: NavConfigEntry[];
}

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

/**
 * Discovers nav config entries from markdown files (title + path).
 */
export function discoverNavEntries(
  contentDir: string,
  options?: DiscoverNavOptions,
): NavConfigEntry[] {
  const indexPath = (options?.indexPath ?? 'index.md').replace(/\\/g, '/');
  const files = findMarkdownFiles(contentDir, contentDir);
  const sorted = sortNavPaths(files, indexPath);

  return sorted.map((file) => {
    const fullPath = path.join(contentDir, file);
    const content = fs.readFileSync(fullPath, 'utf-8');
    return {
      title: extractTitle(content, file),
      path: file,
    };
  });
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
      const normalizedPath = entry.path.replace(/\\/g, '/');
      items.push({
        title: entry.title,
        path: normalizedPath,
        href: mdPathToHref(normalizedPath),
      });
      if (entry.children?.length) {
        walk(entry.children);
      }
    }
  };

  walk(entries);

  // Verify paths exist
  for (const item of items) {
    const full = path.join(contentDir, item.path);
    if (!fs.existsSync(full)) {
      throw new Error(`Nav path not found: ${item.path}`);
    }
  }

  return items;
}

/**
 * Auto-discovers navigation from the docs directory.
 */
export function generateAutoNav(docsDir: string, indexPath = 'index.md'): NavItem[] {
  const entries = discoverNavEntries(docsDir, { indexPath });
  return entries.map((e) => ({
    title: e.title,
    path: e.path,
    href: mdPathToHref(e.path),
  }));
}

/**
 * Collects all paths from a nav config (flat), for validation.
 */
export function flattenNavPaths(entries: NavConfigEntry[]): string[] {
  const paths: string[] = [];
  const walk = (list: NavConfigEntry[]) => {
    for (const e of list) {
      paths.push(e.path.replace(/\\/g, '/'));
      if (e.children?.length) walk(e.children);
    }
  };
  walk(entries);
  return paths;
}
