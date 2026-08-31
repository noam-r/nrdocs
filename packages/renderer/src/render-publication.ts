import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Root } from 'mdast';
import {
  AGENT_ALL_MD_MAX_BYTES,
  AGENT_ALL_MD_MAX_BYTES_V3,
  AGENT_PAGE_MARKDOWN_MAX_BYTES,
  agentAssetRoute,
  agentAttachmentRoute,
  agentIdFromCanonicalPath,
  sealManifestV2,
  sealManifestV3,
  sha256Hex,
  type ManifestDraftV2,
  type ManifestDraftV3,
  type ManifestV2,
  type ManifestV3,
  type SiteId,
} from '@nrdocs/contracts';
import { loadAndNormalizeMarkdown } from './markdown-scan.js';
import { resolveRelativeHref } from './markdown-scan.js';
import { renderArticleHtml } from './mdast-to-html.js';
import { serializeArticleMarkdown } from './mdast-to-markdown.js';
import {
  assignHeadingFragments,
  headingPlainTextFromChildren,
  markdownFragmentFromHeadingText,
} from './markdown-fragments.js';
import { mediaObjectPath, pageObjectPath, routeRelativeHref } from './relative-href.js';
import { assemblePageDocumentV2, assemblePageDocumentV3, flattenNavigablePages } from './shell.js';
import {
  buildAgentAllMarkdown,
  buildAgentIndexMarkdown,
  buildAgentNavigation,
  sealAgentManifestFile,
} from './agent-docs.js';
import { RendererError, type NormalizedPublicationGraph, type PublicationPage } from './types.js';
import type { Content, Heading } from 'mdast';

export type RenderedFile = {
  objectPath: string;
  bytes: Uint8Array;
};

export type InMemoryArtifact = {
  manifest: ManifestV2 | ManifestV3;
  files: RenderedFile[];
};

export type RenderProgress = {
  phase: 'page';
  current: number;
  total: number;
};

export type RenderOptions = {
  siteId: SiteId;
  generatorVersion: string;
  onProgress?: (progress: RenderProgress) => void;
};

async function fileSha256(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes);
}

function splitHref(href: string): { pathOnly: string; fragment: string } {
  const hash = href.indexOf('#');
  if (hash === -1) return { pathOnly: href.split('?')[0]!, fragment: '' };
  return { pathOnly: href.slice(0, hash).split('?')[0]!, fragment: href.slice(hash + 1) };
}

function headingFragmentsForTree(tree: Root): { texts: string[]; slugs: string[] } {
  const texts: string[] = [];
  const walk = (nodes: Content[]) => {
    for (const n of nodes) {
      if (n.type === 'heading') {
        texts.push(headingPlainTextFromChildren((n as Heading).children as Content[]));
      } else if ('children' in n && Array.isArray((n as { children?: Content[] }).children)) {
        walk((n as { children: Content[] }).children);
      }
    }
  };
  walk(tree.children as Content[]);
  return { texts, slugs: assignHeadingFragments(texts) };
}

function rewriteFragment(fragment: string, slugs: string[], texts: string[]): string {
  if (slugs.includes(fragment)) return fragment;
  const generated = markdownFragmentFromHeadingText(decodeURIComponent(fragment));
  const byText = texts.findIndex((t) => markdownFragmentFromHeadingText(t) === generated);
  if (byText >= 0) return slugs[byText]!;
  if (slugs.includes(generated)) return generated;
  return generated;
}

export async function renderPublication(
  graph: NormalizedPublicationGraph,
  options: RenderOptions,
): Promise<InMemoryArtifact> {
  const ordered = flattenNavigablePages(graph.navTree);
  const pageBySource = new Map(graph.pages.map((p) => [p.sourceFile, p]));
  const assetBySource = new Map(graph.assets.map((a) => [a.sourceFile, a]));
  const attachBySource = new Map(graph.attachments.map((a) => [a.sourceFile, a]));

  const pageIdByRoute = new Map<string, string>();
  const pageIdBySource = new Map<string, string>();
  for (const page of graph.pages) {
    const id = await agentIdFromCanonicalPath(page.route);
    if ([...pageIdByRoute.values()].includes(id) && pageIdByRoute.get(page.route) !== id) {
      throw new RendererError(
        'page_id_collision',
        `Page identifier collision for:\n  ${page.route}`,
      );
    }
    if (pageIdByRoute.has(page.route) === false) {
      for (const [route, existing] of pageIdByRoute) {
        if (existing === id && route !== page.route) {
          throw new RendererError(
            'page_id_collision',
            `Page identifier collision for:\n  ${page.route}`,
          );
        }
      }
    }
    pageIdByRoute.set(page.route, id);
    pageIdBySource.set(page.sourceFile, id);
  }
  const uniqueIds = new Set(pageIdByRoute.values());
  if (uniqueIds.size !== pageIdByRoute.size) {
    throw new RendererError('page_id_collision', 'Page identifier collision.');
  }

  const parsed = new Map<
    string,
    { page: PublicationPage; tree: Root; headings: ReturnType<typeof headingFragmentsForTree> }
  >();
  for (const page of graph.pages) {
    if (page.origin === 'openapi') continue;
    const { tree } = loadAndNormalizeMarkdown(
      new TextEncoder().encode(page.markdownText),
      page.sourceFile,
    );
    parsed.set(page.sourceFile, { page, tree, headings: headingFragmentsForTree(tree) });
  }

  const assemblePage = graph.openapi ? assemblePageDocumentV3 : assemblePageDocumentV2;

  const assetAgent = new Map<string, { id: string; route: string }>();
  const seenMedia = new Set<string>();
  for (const asset of graph.assets) {
    const id = await agentIdFromCanonicalPath(asset.publicPath);
    if (seenMedia.has(id)) {
      throw new RendererError(
        'media_id_collision',
        `Agent media identifier collision:\n  ${asset.publicPath}`,
      );
    }
    seenMedia.add(id);
    assetAgent.set(asset.sourceFile, { id, route: agentAssetRoute(id, asset.publicPath) });
  }
  for (const att of graph.attachments) {
    const id = await agentIdFromCanonicalPath(att.publicPath);
    if (seenMedia.has(id)) {
      throw new RendererError(
        'media_id_collision',
        `Agent media identifier collision:\n  ${att.publicPath}`,
      );
    }
    seenMedia.add(id);
    assetAgent.set(`att:${att.sourceFile}`, {
      id,
      route: agentAttachmentRoute(id, att.publicPath),
    });
  }

  const renderedPages: Array<{
    route: string;
    htmlObject: string;
    mdObject: string;
    title: string;
    htmlBytes: Uint8Array;
    mdBytes: Uint8Array;
    id: string;
    markdownText: string;
  }> = [];

  for (let i = 0; i < ordered.length; i++) {
    options.onProgress?.({ phase: 'page', current: i + 1, total: ordered.length });
    const meta = ordered[i]!;
    const page = pageBySource.get(meta.sourceFile);
    if (!page) {
      throw new RendererError('missing_page', `Missing page data for:\n  ${meta.sourceFile}`);
    }
    const pageId = pageIdBySource.get(page.sourceFile)!;
    const prev = i > 0 ? ordered[i - 1]! : null;
    const next = i < ordered.length - 1 ? ordered[i + 1]! : null;

    if (page.origin === 'openapi' && page.articleHtml) {
      const mdBytes = new TextEncoder().encode(page.markdownText);
      if (mdBytes.byteLength > AGENT_PAGE_MARKDOWN_MAX_BYTES) {
        throw new RendererError(
          'page_too_large',
          `Normalized Markdown page exceeds 1 MiB:\n  ${page.sourceFile}`,
        );
      }
      const document = assemblePage({
        language: graph.site.language,
        direction: graph.site.direction,
        siteTitle: graph.site.title,
        pageTitle: page.title,
        pageRoute: page.route,
        articleHtml: page.articleHtml,
        navTree: graph.navTree,
        prev: prev ? { title: prev.title, route: prev.route } : null,
        next: next ? { title: next.title, route: next.route } : null,
      });
      const htmlBytes = new TextEncoder().encode(document);
      if (htmlBytes.byteLength > 2 * 1024 * 1024) {
        throw new RendererError(
          'page_too_large',
          `Rendered page exceeds 2 MiB:\n  ${page.sourceFile}`,
        );
      }
      renderedPages.push({
        route: page.route,
        htmlObject: pageObjectPath(page.route),
        mdObject: `agent/pages/${pageId}.md`,
        title: page.title,
        htmlBytes,
        mdBytes,
        id: pageId,
        markdownText: page.markdownText,
      });
      continue;
    }

    const loaded = parsed.get(meta.sourceFile);
    if (!loaded) {
      throw new RendererError('missing_page', `Missing page data for:\n  ${meta.sourceFile}`);
    }
    const { tree, headings } = loaded;

    const htmlLinks = {
      resolvePageHref(href: string): string | null {
        const { pathOnly, fragment } = splitHref(href);
        if (pathOnly.startsWith('/')) {
          let route = pathOnly;
          if (route !== '/api-reference/openapi.json' && !route.endsWith('/')) {
            route = `${route}/`;
          }
          if (route === '/api-reference/openapi.json') {
            return routeRelativeHref(page.route, route) + (fragment ? `#${fragment}` : '');
          }
          const target = graph.pages.find((p) => p.route === route);
          if (target) {
            return routeRelativeHref(page.route, target.route) + (fragment ? `#${fragment}` : '');
          }
          return null;
        }
        if (!pathOnly.endsWith('.md') && pathOnly !== '') return null;
        let targetFile: string;
        try {
          targetFile = resolveRelativeHref(page.sourceFile, pathOnly || './');
        } catch {
          return null;
        }
        const target = pageBySource.get(targetFile);
        if (!target) return null;
        const frag = fragment ? `#${fragment}` : '';
        return routeRelativeHref(page.route, target.route) + frag;
      },
      resolveAssetHref(href: string): string | null {
        let targetFile: string;
        try {
          targetFile = resolveRelativeHref(page.sourceFile, href);
        } catch {
          return null;
        }
        const asset = assetBySource.get(targetFile);
        if (!asset) return null;
        return routeRelativeHref(page.route, asset.publicPath);
      },
      resolveAttachmentHref(href: string): string | null {
        let targetFile: string;
        try {
          targetFile = resolveRelativeHref(page.sourceFile, href);
        } catch {
          return null;
        }
        const att = attachBySource.get(targetFile);
        if (!att) return null;
        return routeRelativeHref(page.route, att.publicPath);
      },
    };

    const mdLinks = {
      resolvePageHref(href: string): string | null {
        const { pathOnly, fragment } = splitHref(href);
        if (!pathOnly.endsWith('.md') && pathOnly !== '') return null;
        let targetFile: string;
        try {
          targetFile = resolveRelativeHref(page.sourceFile, pathOnly || './');
        } catch {
          return null;
        }
        const target = pageBySource.get(targetFile);
        if (!target) return null;
        const targetId = pageIdBySource.get(target.sourceFile)!;
        const targetHeadings = parsed.get(target.sourceFile)?.headings;
        let out = `${targetId}.md`;
        if (fragment) {
          const slug = targetHeadings
            ? rewriteFragment(fragment, targetHeadings.slugs, targetHeadings.texts)
            : markdownFragmentFromHeadingText(fragment);
          out += `#${slug}`;
        }
        return out;
      },
      resolveAssetHref(href: string): string | null {
        let targetFile: string;
        try {
          targetFile = resolveRelativeHref(page.sourceFile, href);
        } catch {
          return null;
        }
        const asset = assetBySource.get(targetFile);
        if (!asset) return null;
        const agent = assetAgent.get(asset.sourceFile);
        if (!agent) return null;
        return `../${agent.route}`;
      },
      resolveAttachmentHref(href: string): string | null {
        let targetFile: string;
        try {
          targetFile = resolveRelativeHref(page.sourceFile, href);
        } catch {
          return null;
        }
        const att = attachBySource.get(targetFile);
        if (!att) return null;
        const agent = assetAgent.get(`att:${att.sourceFile}`);
        if (!agent) return null;
        return `../${agent.route}`;
      },
      rewriteFragment(fragment: string): string {
        return rewriteFragment(fragment, headings.slugs, headings.texts);
      },
    };

    const { html: articleHtml } = renderArticleHtml(tree, page.sourceFile, htmlLinks);
    const markdown = serializeArticleMarkdown(tree, page.sourceFile, mdLinks);
    const mdBytes = new TextEncoder().encode(markdown);
    if (mdBytes.byteLength > AGENT_PAGE_MARKDOWN_MAX_BYTES) {
      throw new RendererError(
        'page_too_large',
        `Normalized Markdown page exceeds 1 MiB:\n  ${page.sourceFile}`,
      );
    }

    const document = assemblePage({
      language: graph.site.language,
      direction: graph.site.direction,
      siteTitle: graph.site.title,
      pageTitle: page.title,
      pageRoute: page.route,
      articleHtml,
      navTree: graph.navTree,
      prev: prev ? { title: prev.title, route: prev.route } : null,
      next: next ? { title: next.title, route: next.route } : null,
    });
    const htmlBytes = new TextEncoder().encode(document);
    if (htmlBytes.byteLength > 2 * 1024 * 1024) {
      throw new RendererError(
        'page_too_large',
        `Rendered page exceeds 2 MiB:\n  ${page.sourceFile}`,
      );
    }
    renderedPages.push({
      route: page.route,
      htmlObject: pageObjectPath(page.route),
      mdObject: `agent/pages/${pageId}.md`,
      title: page.title,
      htmlBytes,
      mdBytes,
      id: pageId,
      markdownText: markdown,
    });
  }

  const files: RenderedFile[] = [];
  const manifestPages: ManifestDraftV2['pages'] = [];
  for (const p of renderedPages) {
    files.push({ objectPath: p.htmlObject, bytes: p.htmlBytes });
    files.push({ objectPath: p.mdObject, bytes: p.mdBytes });
    manifestPages.push({
      id: p.id,
      route: p.route,
      title: p.title,
      html: {
        object: p.htmlObject,
        size: p.htmlBytes.byteLength,
        sha256: await fileSha256(p.htmlBytes),
      },
      markdown: {
        object: p.mdObject,
        size: p.mdBytes.byteLength,
        sha256: await fileSha256(p.mdBytes),
      },
    });
  }

  const manifestAssets: ManifestDraftV2['assets'] = [];
  for (const asset of graph.assets) {
    const abs = path.join(graph.rootDir, asset.sourceFile);
    const bytes = new Uint8Array(await fsp.readFile(abs));
    const object = mediaObjectPath('assets', asset.publicPath);
    files.push({ objectPath: object, bytes });
    const agent = assetAgent.get(asset.sourceFile)!;
    manifestAssets.push({
      path: asset.publicPath,
      object,
      media_type: asset.mediaType,
      size: bytes.byteLength,
      sha256: await fileSha256(bytes),
      agent,
    });
  }

  const manifestAttachments: ManifestDraftV2['attachments'] = [];
  for (const att of graph.attachments) {
    const abs = path.join(graph.rootDir, att.sourceFile);
    const bytes = new Uint8Array(await fsp.readFile(abs));
    const object = mediaObjectPath('attachments', att.publicPath);
    files.push({ objectPath: object, bytes });
    const agent = assetAgent.get(`att:${att.sourceFile}`)!;
    manifestAttachments.push({
      path: att.publicPath,
      object,
      media_type: att.mediaType,
      filename: att.filename,
      size: bytes.byteLength,
      sha256: await fileSha256(bytes),
      agent,
    });
  }

  const pageTitleById = new Map(renderedPages.map((p) => [p.id, p.title]));
  const navigation = await buildAgentNavigation(graph.navTree, pageIdByRoute);
  const rootRoute = graph.root.kind === 'page' ? '/' : graph.root.route;

  const allBytes = buildAgentAllMarkdown({
    siteTitle: graph.site.title,
    pages: renderedPages.map((p) => ({
      title: p.title,
      humanRoute: p.route,
      pageId: p.id,
      markdown: p.markdownText,
    })),
    maxBytes: graph.openapi ? AGENT_ALL_MD_MAX_BYTES_V3 : AGENT_ALL_MD_MAX_BYTES,
  });

  const indexText = buildAgentIndexMarkdown({
    siteTitle: graph.site.title,
    language: graph.site.language,
    direction: graph.site.direction,
    rootRoute,
    hasAll: allBytes !== null,
    navigation,
    pageTitleById,
  });
  const indexBytes = new TextEncoder().encode(indexText);
  const indexSha = await fileSha256(indexBytes);
  files.push({ objectPath: 'agent/index.md', bytes: indexBytes });

  let allSha: string | null = null;
  if (allBytes) {
    allSha = await fileSha256(allBytes);
    files.push({ objectPath: 'agent/all.md', bytes: allBytes });
  }

  const agentPages = renderedPages.map((p, i) => ({
    id: p.id,
    title: p.title,
    human_route: p.route,
    markdown_path: `pages/${p.id}.md`,
    markdown_size: p.mdBytes.byteLength,
    markdown_sha256: manifestPages[i]!.markdown.sha256,
    previous_id: i === 0 ? null : renderedPages[i - 1]!.id,
    next_id: i === renderedPages.length - 1 ? null : renderedPages[i + 1]!.id,
    order: i,
  }));

  const { bytes: agentManifestBytes } = await sealAgentManifestFile({
    siteTitle: graph.site.title,
    language: graph.site.language,
    direction: graph.site.direction,
    rootRoute,
    pages: agentPages,
    assets: manifestAssets.map((a) => ({
      id: a.agent.id,
      path: a.agent.route,
      media_type: a.media_type,
      size: a.size,
      sha256: a.sha256,
    })),
    attachments: manifestAttachments.map((a) => ({
      id: a.agent.id,
      path: a.agent.route,
      media_type: a.media_type,
      filename: a.filename,
      size: a.size,
      sha256: a.sha256,
    })),
    navigation,
    indexSha256: indexSha,
    allSha256: allSha,
    hasAll: allBytes !== null,
    allSize: allBytes ? allBytes.byteLength : null,
  });
  files.push({ objectPath: 'agent/manifest.json', bytes: agentManifestBytes });

  const extra = 2 + (allBytes ? 1 : 0);
  const openapiBytes = graph.openapi?.bundledJson;
  const openapiExtra = openapiBytes ? 1 : 0;
  const file_count =
    renderedPages.length * 2 +
    manifestAssets.length +
    manifestAttachments.length +
    extra +
    openapiExtra;
  const uncompressed_size =
    renderedPages.reduce((s, p) => s + p.htmlBytes.byteLength + p.mdBytes.byteLength, 0) +
    manifestAssets.reduce((s, a) => s + a.size, 0) +
    manifestAttachments.reduce((s, a) => s + a.size, 0) +
    indexBytes.byteLength +
    agentManifestBytes.byteLength +
    (allBytes ? allBytes.byteLength : 0) +
    (openapiBytes ? openapiBytes.byteLength : 0);

  if (openapiBytes && graph.openapi) {
    files.push({ objectPath: graph.openapi.download.object, bytes: openapiBytes });
    const draft: ManifestDraftV3 = {
      schema_version: 3,
      page_schema_version: 3,
      site_id: options.siteId,
      generator: { name: 'nrdocs', version: options.generatorVersion },
      site: {
        title: graph.site.title,
        language: graph.site.language,
        direction: graph.site.direction,
        root: graph.root,
      },
      pages: manifestPages,
      assets: manifestAssets,
      attachments: manifestAttachments,
      agent: {
        schema_version: 1,
        index: {
          object: 'agent/index.md',
          size: indexBytes.byteLength,
          sha256: indexSha,
        },
        manifest: {
          object: 'agent/manifest.json',
          size: agentManifestBytes.byteLength,
          sha256: await fileSha256(agentManifestBytes),
        },
        all: allBytes
          ? {
              object: 'agent/all.md',
              size: allBytes.byteLength,
              sha256: allSha!,
            }
          : null,
      },
      openapi_download: {
        route: graph.openapi.download.route,
        object: graph.openapi.download.object,
        media_type: graph.openapi.download.mediaType,
        filename: graph.openapi.download.filename,
        size: openapiBytes.byteLength,
        sha256: await fileSha256(openapiBytes),
      },
      artifact: { file_count, uncompressed_size },
    };
    const manifest = await sealManifestV3(draft);
    const manifestFile: RenderedFile = {
      objectPath: 'nrdocs-manifest.json',
      bytes: new TextEncoder().encode(JSON.stringify(manifest)),
    };
    const rest = files
      .slice()
      .sort((a, b) => (a.objectPath < b.objectPath ? -1 : a.objectPath > b.objectPath ? 1 : 0));
    return { manifest, files: [manifestFile, ...rest] };
  }

  const draft: ManifestDraftV2 = {
    schema_version: 2,
    page_schema_version: 2,
    site_id: options.siteId,
    generator: { name: 'nrdocs', version: options.generatorVersion },
    site: {
      title: graph.site.title,
      language: graph.site.language,
      direction: graph.site.direction,
      root: graph.root,
    },
    pages: manifestPages,
    assets: manifestAssets,
    attachments: manifestAttachments,
    agent: {
      schema_version: 1,
      index: {
        object: 'agent/index.md',
        size: indexBytes.byteLength,
        sha256: indexSha,
      },
      manifest: {
        object: 'agent/manifest.json',
        size: agentManifestBytes.byteLength,
        sha256: await fileSha256(agentManifestBytes),
      },
      all: allBytes
        ? {
            object: 'agent/all.md',
            size: allBytes.byteLength,
            sha256: allSha!,
          }
        : null,
    },
    artifact: { file_count, uncompressed_size },
  };

  const manifest = await sealManifestV2(draft);
  const manifestFile: RenderedFile = {
    objectPath: 'nrdocs-manifest.json',
    bytes: new TextEncoder().encode(JSON.stringify(manifest)),
  };
  const rest = files
    .slice()
    .sort((a, b) => (a.objectPath < b.objectPath ? -1 : a.objectPath > b.objectPath ? 1 : 0));

  return { manifest, files: [manifestFile, ...rest] };
}
