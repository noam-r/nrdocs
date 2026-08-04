import path from 'node:path';
import fsp from 'node:fs/promises';
import type { NavigationEntry, NrdocsConfig } from '@nrdocs/contracts';
import { findPathCollisions } from '@nrdocs/contracts';
import { assertContainedRealPath, isRealFile, toPosix } from './paths.js';
import { assertConfiguredTitle } from './titles.js';
import { routeForSourceFile, assertUniqueRoutes, publicPathForAsset } from './routes.js';
import {
  collectLinks,
  loadAndNormalizeMarkdown,
  resolveRelativeHref,
  mediaTypeForExtension,
  normalizeExtension,
  isImageExtension,
  isAttachmentExtension,
  isForbiddenWebExtension,
} from './markdown-scan.js';
import { discoverNavigation, loadPublicationPages } from './discover.js';
import {
  MAX_NAV_DEPTH,
  MAX_PUBLISHED_PAGES,
  RendererError,
  errorLoc,
  type NormalizedPublicationGraph,
  type PublicationAsset,
  type PublicationAttachment,
  type PublicationNavNode,
  type PublicationRoot,
  type PublicationPage,
} from './types.js';

function firstNavigableRoute(nodes: PublicationNavNode[]): string | null {
  for (const n of nodes) {
    if (n.kind === 'page' && n.route) return n.route;
    const nested = firstNavigableRoute(n.children);
    if (nested) return nested;
  }
  return null;
}

function selectRoot(pages: PublicationPage[], navTree: PublicationNavNode[]): PublicationRoot {
  if (pages.some((p) => p.route === '/')) return { kind: 'page', route: '/' };
  const first = firstNavigableRoute(navTree) ?? pages[0]?.route;
  if (!first) throw new RendererError('no_pages', 'No navigable page exists for the site root.');
  return { kind: 'redirect', route: first };
}

async function validateExplicitTree(
  rootDir: string,
  entries: NavigationEntry[],
  depth: number,
  pages: Array<{ sourceFile: string; title: string }>,
  seenFiles: Set<string>,
): Promise<PublicationNavNode[]> {
  if (depth > MAX_NAV_DEPTH) {
    throw new RendererError('nav_depth', `Explicit navigation depth exceeds ${MAX_NAV_DEPTH}.`);
  }
  const nodes: PublicationNavNode[] = [];
  for (const entry of entries) {
    const title = assertConfiguredTitle(entry.title);
    let sourceFile: string | undefined;
    let route: string | undefined;
    if (entry.file) {
      sourceFile = toPosix(entry.file);
      await assertContainedRealPath(rootDir, sourceFile, 'Navigation file');
      if (!(await isRealFile(path.join(rootDir, sourceFile)))) {
        throw new RendererError('missing_path', `Navigation file was not found:\n  ${sourceFile}`);
      }
      if (seenFiles.has(sourceFile)) {
        throw new RendererError(
          'duplicate_file',
          `Navigation lists the same file more than once:\n  ${sourceFile}`,
        );
      }
      seenFiles.add(sourceFile);
      if (pages.length >= MAX_PUBLISHED_PAGES) {
        throw new RendererError(
          'too_many_pages',
          `Publication exceeds the maximum of ${MAX_PUBLISHED_PAGES} pages.`,
        );
      }
      pages.push({ sourceFile, title });
      route = routeForSourceFile(sourceFile);
    }
    const children = entry.children
      ? await validateExplicitTree(rootDir, entry.children, depth + 1, pages, seenFiles)
      : [];
    if (sourceFile && route) {
      nodes.push({
        kind: 'page',
        title,
        depth,
        sourceFile,
        route,
        children,
      });
    } else {
      nodes.push({
        kind: 'section-heading',
        title,
        depth,
        children,
      });
    }
  }
  return nodes;
}

async function collectReferences(
  rootDir: string,
  pages: PublicationPage[],
  pageFiles: Set<string>,
): Promise<{ assets: PublicationAsset[]; attachments: PublicationAttachment[] }> {
  const assets = new Map<string, PublicationAsset>();
  const attachments = new Map<string, PublicationAttachment>();

  for (const page of pages) {
    const bytes = new TextEncoder().encode(page.markdownText);
    const { tree } = loadAndNormalizeMarkdown(bytes, page.sourceFile);
    const links = collectLinks(tree);
    for (const link of links) {
      if (link.kind === 'fragment' || link.kind === 'external') {
        if (link.kind === 'external') {
          try {
            const u = new URL(link.href);
            if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'mailto:') {
              throw new RendererError(
                'unsupported_link',
                `Unsupported link scheme:\n  ${link.href}`,
                errorLoc(page.sourceFile, link.line, link.column),
              );
            }
          } catch (error) {
            if (error instanceof RendererError) throw error;
          }
        }
        continue;
      }

      let target: string;
      try {
        target = resolveRelativeHref(page.sourceFile, link.href);
      } catch (error) {
        if (error instanceof RendererError) {
          throw new RendererError(
            error.code,
            error.message,
            errorLoc(page.sourceFile, link.line, link.column),
          );
        }
        throw error;
      }

      if (link.kind === 'page') {
        if (!pageFiles.has(target)) {
          throw new RendererError(
            'unlisted_markdown',
            `Link targets an unlisted Markdown page:\n  ${link.href}\nfrom:\n  ${page.sourceFile}`,
            errorLoc(page.sourceFile, link.line, link.column),
          );
        }
        continue;
      }

      await assertContainedRealPath(rootDir, target, 'Referenced file');
      const ext = normalizeExtension(target);
      if (!ext) {
        throw new RendererError(
          'unsupported_extension',
          `Referenced file has no supported extension:\n  ${target}`,
          errorLoc(page.sourceFile, link.line, link.column),
        );
      }
      if (isForbiddenWebExtension(ext) || (!isImageExtension(ext) && !isAttachmentExtension(ext))) {
        throw new RendererError(
          'unsupported_extension',
          `Referenced file extension is not allowed:\n  ${target}`,
          errorLoc(page.sourceFile, link.line, link.column),
        );
      }
      const mediaType = mediaTypeForExtension(ext)!;
      const publicPath = publicPathForAsset(target);

      if (isImageExtension(ext) && (link.kind === 'image' || link.kind === 'attachment')) {
        // Prefer image classification for image extensions even from links
        const existing = assets.get(target);
        if (existing) {
          if (!existing.referencedFrom.includes(page.sourceFile)) {
            existing.referencedFrom.push(page.sourceFile);
          }
        } else {
          assets.set(target, {
            sourceFile: target,
            publicPath,
            mediaType,
            referencedFrom: [page.sourceFile],
          });
        }
      } else if (isAttachmentExtension(ext)) {
        const filename = path.posix.basename(target);
        const existing = attachments.get(target);
        if (existing) {
          if (!existing.referencedFrom.includes(page.sourceFile)) {
            existing.referencedFrom.push(page.sourceFile);
          }
        } else {
          attachments.set(target, {
            sourceFile: target,
            publicPath,
            mediaType,
            filename,
            referencedFrom: [page.sourceFile],
          });
        }
      } else if (isImageExtension(ext)) {
        const existing = assets.get(target);
        if (existing) {
          if (!existing.referencedFrom.includes(page.sourceFile)) {
            existing.referencedFrom.push(page.sourceFile);
          }
        } else {
          assets.set(target, {
            sourceFile: target,
            publicPath,
            mediaType,
            referencedFrom: [page.sourceFile],
          });
        }
      }
    }
  }

  return {
    assets: [...assets.values()],
    attachments: [...attachments.values()],
  };
}

function assertPublicationCollisions(graph: NormalizedPublicationGraph): void {
  const entries = [
    ...graph.pages.map((p) => ({ collection: 'pages' as const, path: p.route })),
    ...graph.assets.map((a) => ({ collection: 'assets' as const, path: a.publicPath })),
    ...graph.attachments.map((a) => ({
      collection: 'attachments' as const,
      path: a.publicPath,
    })),
    ...graph.pages.map((p) => ({ collection: 'source' as const, path: p.sourceFile })),
    ...graph.assets.map((a) => ({ collection: 'source' as const, path: a.sourceFile })),
    ...graph.attachments.map((a) => ({ collection: 'source' as const, path: a.sourceFile })),
  ];
  const collisions = findPathCollisions(entries);
  if (collisions.length > 0) {
    const c = collisions[0]!;
    throw new RendererError(
      'path_collision',
      `Publication paths collide (${c.key}):\n  ${c.left.collection}: ${c.left.path}\n  ${c.right.collection}: ${c.right.path}`,
    );
  }
}

export async function buildPublicationGraph(
  rootDir: string,
  config: NrdocsConfig,
): Promise<NormalizedPublicationGraph> {
  let navTree: PublicationNavNode[];
  let pageMetas: Array<{ sourceFile: string; title: string }>;
  let explicitNavigation: NavigationEntry[];
  let navigationMode: 'auto' | 'explicit';

  if (config.navigation === 'auto') {
    navigationMode = 'auto';
    const discovered = await discoverNavigation(rootDir, 'auto');
    navTree = discovered.navTree;
    pageMetas = discovered.pages;
    explicitNavigation = discovered.explicitNavigation;
  } else {
    navigationMode = 'explicit';
    pageMetas = [];
    const seen = new Set<string>();
    navTree = await validateExplicitTree(rootDir, config.navigation, 1, pageMetas, seen);
    explicitNavigation = config.navigation;
  }

  const pages = await loadPublicationPages(rootDir, pageMetas);
  assertUniqueRoutes(pages.map((p) => ({ route: p.route, sourceFile: p.sourceFile })));

  const pageFiles = new Set(pages.map((p) => p.sourceFile));
  const { assets, attachments } = await collectReferences(rootDir, pages, pageFiles);
  const root = selectRoot(pages, navTree);

  const graph: NormalizedPublicationGraph = {
    rootDir,
    site: {
      title: config.title,
      language: config.language,
      direction: config.direction,
    },
    navigationMode,
    explicitNavigation,
    navTree,
    pages,
    root,
    assets,
    attachments,
  };
  assertPublicationCollisions(graph);
  return graph;
}

/** Discover pages for generate-nav without requiring an existing config. */
export async function generateNavigationEntries(rootDir: string): Promise<NavigationEntry[]> {
  const discovered = await discoverNavigation(rootDir, 'generate');
  return discovered.explicitNavigation;
}

export async function readFileBytes(abs: string): Promise<Uint8Array> {
  return new Uint8Array(await fsp.readFile(abs));
}
