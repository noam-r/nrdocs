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

/**
 * Extracts a title from Markdown content.
 * Uses the first H1 heading if present, otherwise derives from filename.
 */
export function extractTitle(markdownContent: string, filePath: string): string {
  const match = markdownContent.match(/^#\s+(.+)$/m);
  if (match) {
    return match[1]!.trim();
  }
  // Fallback: derive from filename
  const basename = path.basename(filePath, '.md');
  if (basename === 'index') {
    return 'Home';
  }
  // Convert kebab-case/snake_case to title case
  return basename
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Recursively finds all .md files in a directory.
 */
function findMarkdownFiles(dir: string, relativeTo: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(fullPath, relativeTo));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(path.relative(relativeTo, fullPath));
    }
  }

  return results;
}

/**
 * Converts a .md file path to a clean URL path segment.
 * e.g. "getting-started.md" → "getting-started/"
 *      "index.md" → ""
 */
function mdPathToHref(filePath: string): string {
  const withoutExt = filePath.replace(/\.md$/, '');
  if (withoutExt === 'index') {
    return '';
  }
  // Normalize path separators for URL
  return withoutExt.replace(/\\/g, '/') + '/';
}

/**
 * Auto-discovers navigation from the docs directory.
 * Finds all .md files, sorts them with index.md first,
 * and extracts titles from H1 headings.
 */
export function generateAutoNav(docsDir: string): NavItem[] {
  const files = findMarkdownFiles(docsDir, docsDir);

  // Sort alphabetically, but put index.md first
  files.sort((a, b) => {
    if (a === 'index.md') return -1;
    if (b === 'index.md') return 1;
    return a.localeCompare(b);
  });

  const items: NavItem[] = [];

  for (const file of files) {
    const fullPath = path.join(docsDir, file);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const title = extractTitle(content, file);
    const href = mdPathToHref(file);

    items.push({
      title,
      path: file,
      href,
    });
  }

  return items;
}
