import path from 'node:path';
import fsp from 'node:fs/promises';
import type { NavigationEntry } from '@nrdocs/contracts';
import {
  directoryContainsMarkdown,
  isRealDirectory,
  isRealFile,
  isSymlink,
  toPosix,
} from './paths.js';
import { titleFromDirectoryName, titleFromFilename, assertDerivedTitle } from './titles.js';
import { extractFirstH1, loadAndNormalizeMarkdown } from './markdown-scan.js';
import { routeForSourceFile } from './routes.js';
import {
  MAX_NAV_DEPTH,
  MAX_PUBLISHED_PAGES,
  RendererError,
  type PublicationNavNode,
  type PublicationPage,
} from './types.js';

const INDEX = 'index.md';
const NUMBERED_FILE = /^(\d{2})-(.+)\.md$/;
const NUMBERED_DIR = /^(\d{2})-(.+)$/;

export type DiscoveredPage = {
  sourceFile: string;
  title: string;
  depth: number;
};

export type DiscoveryResult = {
  navTree: PublicationNavNode[];
  pages: Array<{ sourceFile: string; title: string }>;
  explicitNavigation: NavigationEntry[];
};

async function readPageTitle(rootDir: string, rel: string): Promise<string> {
  const abs = path.join(rootDir, rel);
  const bytes = new Uint8Array(await fsp.readFile(abs));
  const { text } = loadAndNormalizeMarkdown(bytes, rel);
  const h1 = extractFirstH1(text, rel);
  if (h1) return assertDerivedTitle(h1);
  return titleFromFilename(path.posix.basename(toPosix(rel)));
}

function pushPage(
  pages: Array<{ sourceFile: string; title: string }>,
  sourceFile: string,
  title: string,
): void {
  if (pages.length >= MAX_PUBLISHED_PAGES) {
    throw new RendererError(
      'too_many_pages',
      `Publication exceeds the maximum of ${MAX_PUBLISHED_PAGES} pages.`,
    );
  }
  pages.push({ sourceFile, title });
}

type ChildKind =
  | { kind: 'index'; name: string }
  | { kind: 'page'; name: string; prefix: number }
  | { kind: 'section'; name: string; prefix: number }
  | { kind: 'symlink_candidate'; name: string }
  | { kind: 'nonconforming_md'; name: string }
  | { kind: 'nonconforming_dir'; name: string };

async function classifyChildren(
  rootDir: string,
  relDir: string,
  mode: 'auto' | 'generate',
): Promise<ChildKind[]> {
  const absDir = relDir ? path.join(rootDir, relDir) : rootDir;
  const names = await fsp.readdir(absDir);
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out: ChildKind[] = [];

  for (const name of names) {
    const abs = path.join(absDir, name);
    const symlink = await isSymlink(abs);
    const looksIndex = name === INDEX;
    const fileMatch = NUMBERED_FILE.exec(name);
    const dirMatch = NUMBERED_DIR.exec(name);

    if (symlink) {
      if (looksIndex || fileMatch || dirMatch) {
        out.push({ kind: 'symlink_candidate', name });
      }
      continue;
    }

    if (looksIndex && (await isRealFile(abs))) {
      out.push({ kind: 'index', name });
      continue;
    }

    if (fileMatch && (await isRealFile(abs))) {
      out.push({ kind: 'page', name, prefix: Number(fileMatch[1]) });
      continue;
    }

    if (dirMatch && (await isRealDirectory(abs))) {
      const hasMd = await directoryContainsMarkdown(abs);
      if (hasMd) {
        out.push({ kind: 'section', name, prefix: Number(dirMatch[1]) });
      }
      // asset-only dirs ignored for navigation
      continue;
    }

    if (mode === 'auto') {
      if (name.endsWith('.md') && (await isRealFile(abs))) {
        out.push({ kind: 'nonconforming_md', name });
        continue;
      }
      if (await isRealDirectory(abs)) {
        if (await directoryContainsMarkdown(abs)) {
          out.push({ kind: 'nonconforming_dir', name });
        }
      }
    } else {
      // generate mode: include nonconforming markdown files
      if (name.endsWith('.md') && (await isRealFile(abs)) && name !== INDEX) {
        out.push({ kind: 'page', name, prefix: Number.MAX_SAFE_INTEGER });
      } else if (await isRealDirectory(abs)) {
        if (await directoryContainsMarkdown(abs)) {
          // treat as section without requiring NN- prefix; order after numbered
          out.push({ kind: 'section', name, prefix: Number.MAX_SAFE_INTEGER });
        }
      }
    }
  }

  return out;
}

function orderNumbered<T extends { prefix: number; name: string }>(items: T[]): T[] {
  const byPrefix = new Map<number, T[]>();
  for (const item of items) {
    const list = byPrefix.get(item.prefix) ?? [];
    list.push(item);
    byPrefix.set(item.prefix, list);
  }
  for (const [prefix, list] of byPrefix) {
    if (prefix !== Number.MAX_SAFE_INTEGER && list.length > 1) {
      throw new RendererError(
        'duplicate_prefix',
        `Duplicate numeric prefix ${String(prefix).padStart(2, '0')} in one directory:\n  ${list.map((i) => i.name).join('\n  ')}`,
      );
    }
  }
  return [...items].sort((a, b) => {
    if (a.prefix !== b.prefix) return a.prefix - b.prefix;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

async function walkDir(
  rootDir: string,
  relDir: string,
  depth: number,
  mode: 'auto' | 'generate',
  pages: Array<{ sourceFile: string; title: string }>,
): Promise<{ nodes: PublicationNavNode[]; entries: NavigationEntry[] }> {
  if (depth > MAX_NAV_DEPTH) {
    throw new RendererError(
      'nav_depth',
      `Navigation depth exceeds ${MAX_NAV_DEPTH} at:\n  ${relDir || '.'}`,
    );
  }

  const children = await classifyChildren(rootDir, relDir, mode);
  for (const c of children) {
    if (c.kind === 'symlink_candidate') {
      throw new RendererError(
        'symlink',
        `Symbolic-link navigation candidate is invalid:\n  ${joinRel(relDir, c.name)}`,
      );
    }
    if (c.kind === 'nonconforming_md') {
      throw new RendererError(
        'nonconforming',
        `Automatic navigation cannot order:\n  ${joinRel(relDir, c.name)}\n\nRename it using the NN-slug.md convention, or run:\n  nrdocs generate nav`,
      );
    }
    if (c.kind === 'nonconforming_dir') {
      throw new RendererError(
        'nonconforming',
        `Automatic navigation cannot order directory:\n  ${joinRel(relDir, c.name)}\n\nRename it using the NN-slug/ convention, or run:\n  nrdocs generate nav`,
      );
    }
  }

  const index = children.find((c) => c.kind === 'index');
  const numbered = orderNumbered(
    children.filter(
      (c): c is Extract<ChildKind, { kind: 'page' | 'section' }> =>
        c.kind === 'page' || c.kind === 'section',
    ),
  );

  const nodes: PublicationNavNode[] = [];
  const entries: NavigationEntry[] = [];

  if (index) {
    const sourceFile = joinRel(relDir, INDEX);
    const title = await readPageTitle(rootDir, sourceFile);
    // For nested section index, this is handled by parent; at root we emit a page node.
    if (depth === 1 && relDir === '') {
      pushPage(pages, sourceFile, title);
      nodes.push({
        kind: 'page',
        title,
        depth,
        sourceFile,
        route: routeForSourceFile(sourceFile),
        children: [],
      });
      entries.push({ title, file: sourceFile });
    }
  } else if (mode === 'auto' && relDir === '' && depth === 1) {
    // Missing root index is allowed; redirect later. But we still need at least one page overall.
  }

  for (const item of numbered) {
    if (item.kind === 'page') {
      const sourceFile = joinRel(relDir, item.name);
      const title = await readPageTitle(rootDir, sourceFile);
      pushPage(pages, sourceFile, title);
      const childDepth = relDir === '' ? 1 : depth;
      // When under a section, depth is section depth; pages at root are depth 1
      const pageDepth = relDir === '' ? 1 : depth;
      if (pageDepth > MAX_NAV_DEPTH) {
        throw new RendererError('nav_depth', `Navigation depth exceeds ${MAX_NAV_DEPTH}.`);
      }
      nodes.push({
        kind: 'page',
        title,
        depth: pageDepth,
        sourceFile,
        route: routeForSourceFile(sourceFile),
        children: [],
      });
      entries.push({ title, file: sourceFile });
      void childDepth;
    } else {
      const childRel = joinRel(relDir, item.name);
      const sectionDepth = relDir === '' ? 1 : depth;
      const childWalkDepth = sectionDepth + 1;
      if (childWalkDepth > MAX_NAV_DEPTH + 1) {
        throw new RendererError(
          'nav_depth',
          `Navigation depth exceeds ${MAX_NAV_DEPTH} under:\n  ${childRel}`,
        );
      }
      // Children of this section are at sectionDepth+1; if that would be > 8, fail
      if (sectionDepth >= MAX_NAV_DEPTH) {
        throw new RendererError(
          'nav_depth',
          `Navigation depth exceeds ${MAX_NAV_DEPTH} under:\n  ${childRel}`,
        );
      }

      const sectionIndexRel = joinRel(childRel, INDEX);
      const hasIndex = await isRealFile(path.join(rootDir, sectionIndexRel));

      let sectionTitle: string;
      let sectionEntry: NavigationEntry;
      let sectionNode: PublicationNavNode;

      if (hasIndex) {
        sectionTitle = await readPageTitle(rootDir, sectionIndexRel);
        pushPage(pages, sectionIndexRel, sectionTitle);
        const nested = await walkDir(rootDir, childRel, sectionDepth + 1, mode, pages);
        sectionNode = {
          kind: 'page',
          title: sectionTitle,
          depth: sectionDepth,
          sourceFile: sectionIndexRel,
          route: routeForSourceFile(sectionIndexRel),
          children: nested.nodes,
        };
        sectionEntry = {
          title: sectionTitle,
          file: sectionIndexRel,
          ...(nested.entries.length > 0 ? { children: nested.entries } : {}),
        };
      } else {
        sectionTitle = titleFromDirectoryName(item.name);
        const nested = await walkDir(rootDir, childRel, sectionDepth + 1, mode, pages);
        sectionNode = {
          kind: 'section-heading',
          title: sectionTitle,
          depth: sectionDepth,
          children: nested.nodes,
        };
        if (nested.entries.length === 0) {
          throw new RendererError('empty_section', `Section has no pages:\n  ${childRel}`);
        }
        sectionEntry = {
          title: sectionTitle,
          children: nested.entries,
        };
      }

      nodes.push(sectionNode);
      entries.push(sectionEntry);
    }
  }

  return { nodes, entries };
}

function joinRel(dir: string, name: string): string {
  return dir ? `${toPosix(dir)}/${name}` : name;
}

/**
 * Discover navigation for `navigation: auto` (strict) or `generate nav` (permissive).
 */
export async function discoverNavigation(
  rootDir: string,
  mode: 'auto' | 'generate',
): Promise<DiscoveryResult> {
  const pages: Array<{ sourceFile: string; title: string }> = [];
  const { nodes, entries } = await walkDir(rootDir, '', 1, mode, pages);

  if (pages.length === 0) {
    throw new RendererError(
      'no_pages',
      'No Markdown pages were discovered under the publication root.',
    );
  }

  // Deduplicate pages list if section index was double-counted — use unique by sourceFile
  const uniquePages: Array<{ sourceFile: string; title: string }> = [];
  const seen = new Set<string>();
  for (const p of pages) {
    if (seen.has(p.sourceFile)) continue;
    seen.add(p.sourceFile);
    uniquePages.push(p);
  }
  if (uniquePages.length > MAX_PUBLISHED_PAGES) {
    throw new RendererError(
      'too_many_pages',
      `Publication exceeds the maximum of ${MAX_PUBLISHED_PAGES} pages.`,
    );
  }

  return {
    navTree: nodes,
    pages: uniquePages,
    explicitNavigation: entries,
  };
}

export async function loadPublicationPages(
  rootDir: string,
  pageMetas: Array<{ sourceFile: string; title: string }>,
): Promise<PublicationPage[]> {
  const out: PublicationPage[] = [];
  for (const meta of pageMetas) {
    const abs = path.join(rootDir, meta.sourceFile);
    const bytes = new Uint8Array(await fsp.readFile(abs));
    const { text } = loadAndNormalizeMarkdown(bytes, meta.sourceFile);
    out.push({
      sourceFile: meta.sourceFile,
      route: routeForSourceFile(meta.sourceFile),
      title: meta.title,
      markdownText: text,
    });
  }
  return out;
}
