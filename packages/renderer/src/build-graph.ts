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
import { buildOpenApiIntegration, refreshOpenApiArticleHtml } from './openapi/integrate.js';
import { OpenApiError } from './openapi/errors.js';
import {
  MAX_NAV_DEPTH,
  MAX_PUBLISHED_PAGES,
  MAX_PUBLISHED_PAGES_WITH_API,
  RendererError,
  errorLoc,
  type NormalizedPublicationGraph,
  type PublicationDiagnostic,
  type PublicationAsset,
  type PublicationAttachment,
  type PublicationNavNode,
  type PublicationRoot,
  type PublicationPage,
} from './types.js';

function posixDirname(file: string): string {
  const i = file.lastIndexOf('/');
  return i <= 0 ? '' : file.slice(0, i);
}

async function unlistedMarkdownMessage(input: {
  href: string;
  target: string;
  sourceFile: string;
  rootDir: string;
  pageFiles: Set<string>;
}): Promise<string> {
  const exists = await isRealFile(path.join(input.rootDir, input.target));
  const lines = [
    'Link targets an unlisted Markdown page:',
    `  ${input.href}`,
    'resolved:',
    `  ${input.target}`,
    'from:',
    `  ${input.sourceFile}`,
    '',
  ];
  if (exists) {
    lines.push(
      'That file exists but is not listed in nrdocs.yml navigation.',
      '',
      'Add it to navigation, or run:',
      '  nrdocs generate nav --force',
    );
    return lines.join('\n');
  }

  lines.push('That file does not exist on disk.');
  const dir = posixDirname(input.target);
  const listed = [...input.pageFiles].filter((file) => posixDirname(file) === dir).sort();
  if (listed.length > 0) {
    lines.push('', 'Pages listed in that directory:');
    for (const file of listed.slice(0, 12)) {
      lines.push(`  ${file}`);
    }
  }
  const prefix = numberedStemPrefix(input.target);
  const samePrefix =
    prefix === null ? [] : listed.filter((file) => numberedStemPrefix(file) === prefix);
  if (samePrefix.length > 0) {
    lines.push('', 'A listed page in that directory uses the same NN- prefix:');
    for (const file of samePrefix) {
      lines.push(`  ${file}`);
    }
    lines.push('', 'Rename that file, or change the link, so the names match.');
  } else {
    lines.push('', 'Add or rename the Markdown file so that path exists.');
  }
  lines.push(
    '',
    '`nrdocs generate nav --force` only refreshes navigation from files that already exist.',
  );
  return lines.join('\n');
}

function numberedStemPrefix(file: string): string | null {
  const base = file.slice(file.lastIndexOf('/') + 1);
  const match = /^(\d{2})-/.exec(base);
  return match ? match[1]! : null;
}

function firstNavigableRoute(nodes: PublicationNavNode[]): string | null {
  for (const n of nodes) {
    if (n.kind === 'page' && n.route) return n.route;
    const nested = firstNavigableRoute(n.children);
    if (nested) return nested;
  }
  return null;
}

function selectRoot(
  pages: PublicationPage[],
  navTree: PublicationNavNode[],
  hasApi: boolean,
): PublicationRoot {
  if (pages.some((p) => p.route === '/')) return { kind: 'page', route: '/' };
  const markdownPages = pages.filter((p) => p.origin !== 'openapi');
  if (markdownPages.length === 0 && hasApi) {
    return { kind: 'redirect', route: '/api-reference/' };
  }
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
  maxPages: number,
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
      if (pages.length >= maxPages) {
        throw new RendererError(
          'too_many_pages',
          `Publication exceeds the maximum of ${maxPages} pages.`,
        );
      }
      pages.push({ sourceFile, title });
      route = routeForSourceFile(sourceFile);
    }
    const children = entry.children
      ? await validateExplicitTree(rootDir, entry.children, depth + 1, pages, seenFiles, maxPages)
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

function siteRouteFromHref(href: string): string | null {
  const pathPart = href.split('#')[0]!.split('?')[0]!;
  if (!pathPart.startsWith('/') || pathPart.includes('\\') || pathPart.includes('//')) {
    return null;
  }
  if (pathPart === '/api-reference/openapi.json') return pathPart;
  if (pathPart.endsWith('/')) return pathPart;
  // Bare API routes without trailing slash are accepted as page routes.
  if (pathPart.startsWith('/api-reference/')) return `${pathPart}/`;
  return null;
}

async function collectReferences(
  rootDir: string,
  pages: PublicationPage[],
  pageFiles: Set<string>,
  openapiSourcePaths: Set<string> | null,
): Promise<{
  assets: PublicationAsset[];
  attachments: PublicationAttachment[];
  diagnostics: PublicationDiagnostic[];
}> {
  const assets = new Map<string, PublicationAsset>();
  const attachments = new Map<string, PublicationAttachment>();
  const diagnostics: PublicationDiagnostic[] = [];
  const pageRoutes = new Set(pages.map((p) => p.route));
  const openapiDownloadRoute = '/api-reference/openapi.json';

  for (const page of pages) {
    if (page.origin === 'openapi') continue;
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

      const siteRoute = siteRouteFromHref(link.href);
      if (siteRoute) {
        if (siteRoute === openapiDownloadRoute || pageRoutes.has(siteRoute)) {
          continue;
        }
        throw new RendererError(
          'openapi_link_invalid',
          `Link targets an unknown site route:\n  ${link.href}`,
          errorLoc(page.sourceFile, link.line, link.column),
        );
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

      if (openapiSourcePaths?.has(target)) {
        throw new RendererError(
          'openapi_link_invalid',
          `Markdown must not link to OpenAPI source files:\n  ${link.href}`,
          errorLoc(page.sourceFile, link.line, link.column),
        );
      }

      if (link.kind === 'page') {
        if (!pageFiles.has(target)) {
          diagnostics.push({
            code: 'unlisted_markdown',
            message: await unlistedMarkdownMessage({
              href: link.href,
              target,
              sourceFile: page.sourceFile,
              rootDir,
              pageFiles,
            }),
            sourceFile: page.sourceFile,
            ...(link.line !== undefined ? { line: link.line } : {}),
            ...(link.column !== undefined ? { column: link.column } : {}),
          });
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
    diagnostics,
  };
}

function assertPublicationCollisions(graph: NormalizedPublicationGraph): void {
  if (graph.openapi) {
    for (const asset of graph.assets) {
      if (
        asset.publicPath === '/api-reference/openapi.json' ||
        asset.publicPath.startsWith('/api-reference/')
      ) {
        throw new RendererError(
          'openapi_route_collision',
          `Asset path collides with the reserved API Reference prefix:\n  ${asset.sourceFile} → ${asset.publicPath}`,
        );
      }
    }
    for (const att of graph.attachments) {
      if (
        att.publicPath === '/api-reference/openapi.json' ||
        att.publicPath.startsWith('/api-reference/')
      ) {
        throw new RendererError(
          'openapi_route_collision',
          `Attachment path collides with the reserved API Reference prefix:\n  ${att.sourceFile} → ${att.publicPath}`,
        );
      }
    }
  }
  const entries = [
    ...graph.pages.map((p) => ({ collection: 'pages' as const, path: p.route })),
    ...graph.assets.map((a) => ({ collection: 'assets' as const, path: a.publicPath })),
    ...graph.attachments.map((a) => ({
      collection: 'attachments' as const,
      path: a.publicPath,
    })),
    ...(graph.openapi
      ? [{ collection: 'attachments' as const, path: graph.openapi.download.route }]
      : []),
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

function wrapOpenApiError(error: unknown): never {
  if (error instanceof OpenApiError) {
    throw new RendererError(error.code, error.message, {
      ...(error.sourceFile !== undefined ? { sourceFile: error.sourceFile } : {}),
    });
  }
  throw error;
}

export async function buildPublicationGraph(
  rootDir: string,
  config: NrdocsConfig,
): Promise<NormalizedPublicationGraph> {
  const hasApi = Boolean(config.api);
  const maxPages = hasApi ? MAX_PUBLISHED_PAGES_WITH_API : MAX_PUBLISHED_PAGES;

  let navTree: PublicationNavNode[];
  let pageMetas: Array<{ sourceFile: string; title: string }>;
  let explicitNavigation: NavigationEntry[];
  let navigationMode: 'auto' | 'explicit';

  if (config.navigation === 'auto') {
    navigationMode = 'auto';
    try {
      const discovered = await discoverNavigation(rootDir, 'auto', maxPages);
      navTree = discovered.navTree;
      pageMetas = discovered.pages;
      explicitNavigation = discovered.explicitNavigation;
    } catch (error) {
      if (hasApi && error instanceof RendererError && error.code === 'no_pages') {
        navTree = [];
        pageMetas = [];
        explicitNavigation = [];
      } else {
        throw error;
      }
    }
  } else {
    navigationMode = 'explicit';
    pageMetas = [];
    const seen = new Set<string>();
    navTree = await validateExplicitTree(rootDir, config.navigation, 1, pageMetas, seen, maxPages);
    explicitNavigation = config.navigation;
  }

  let pages = await loadPublicationPages(rootDir, pageMetas);
  assertUniqueRoutes(pages.map((p) => ({ route: p.route, sourceFile: p.sourceFile })));

  for (const page of pages) {
    if (page.route === '/api-reference/' || page.route.startsWith('/api-reference/')) {
      throw new RendererError(
        'openapi_route_collision',
        `Markdown page route collides with the reserved API Reference prefix:\n  ${page.sourceFile} → ${page.route}`,
      );
    }
  }

  let openapi: NormalizedPublicationGraph['openapi'];
  let openapiIntegration: Awaited<ReturnType<typeof buildOpenApiIntegration>> | undefined;
  if (config.api) {
    let api;
    try {
      api = await buildOpenApiIntegration(rootDir, config.api.specification, {
        knownPageRoutes: pages.map((p) => p.route),
      });
    } catch (error) {
      wrapOpenApiError(error);
    }
    openapiIntegration = api;
    navTree = [...navTree, api.navSection];
    pages = [...pages, ...api.pages];
    if (pages.length > maxPages) {
      throw new RendererError(
        'too_many_pages',
        `Publication exceeds the maximum of ${maxPages} pages.`,
      );
    }
    assertUniqueRoutes(pages.map((p) => ({ route: p.route, sourceFile: p.sourceFile })));
    openapi = {
      sourcePaths: api.sourcePaths,
      bundledJson: api.bundledJson,
      download: {
        route: api.openapiDownload.route,
        object: api.openapiDownload.object,
        mediaType: api.openapiDownload.mediaType,
        filename: api.openapiDownload.filename,
      },
    };
  }

  if (pages.length === 0) {
    throw new RendererError(
      'no_pages',
      'Publication has no Markdown pages and no API reference to publish.',
    );
  }

  const pageFiles = new Set(pages.map((p) => p.sourceFile));
  const { assets, attachments, diagnostics } = await collectReferences(
    rootDir,
    pages,
    pageFiles,
    openapi?.sourcePaths ?? null,
  );

  if (openapiIntegration) {
    try {
      refreshOpenApiArticleHtml(openapiIntegration, {
        knownPageRoutes: pages.filter((p) => p.origin !== 'openapi').map((p) => p.route),
        knownAttachments: attachments.map((a) => a.publicPath),
      });
    } catch (error) {
      wrapOpenApiError(error);
    }
  }

  const root = selectRoot(pages, navTree, hasApi);

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
    diagnostics,
    ...(openapi ? { openapi } : {}),
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
