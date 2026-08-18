import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  sealManifest,
  sha256Hex,
  type ManifestDraft,
  type ManifestV1,
  type SiteId,
} from '@nrdocs/contracts';
import { loadAndNormalizeMarkdown } from './markdown-scan.js';
import { resolveRelativeHref } from './markdown-scan.js';
import { renderArticleHtml } from './mdast-to-html.js';
import { mediaObjectPath, pageObjectPath, routeRelativeHref } from './relative-href.js';
import { assemblePageDocument, flattenNavigablePages } from './shell.js';
import { RendererError, type NormalizedPublicationGraph } from './types.js';

export type RenderedFile = {
  objectPath: string;
  bytes: Uint8Array;
};

export type InMemoryArtifact = {
  manifest: ManifestV1;
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

export async function renderPublication(
  graph: NormalizedPublicationGraph,
  options: RenderOptions,
): Promise<InMemoryArtifact> {
  const ordered = flattenNavigablePages(graph.navTree);
  const pageBySource = new Map(graph.pages.map((p) => [p.sourceFile, p]));
  const assetBySource = new Map(graph.assets.map((a) => [a.sourceFile, a]));
  const attachBySource = new Map(graph.attachments.map((a) => [a.sourceFile, a]));

  const renderedPages: Array<{
    route: string;
    object: string;
    title: string;
    bytes: Uint8Array;
  }> = [];

  for (let i = 0; i < ordered.length; i++) {
    options.onProgress?.({ phase: 'page', current: i + 1, total: ordered.length });
    const meta = ordered[i]!;
    const page = pageBySource.get(meta.sourceFile);
    if (!page) {
      throw new RendererError('missing_page', `Missing page data for:\n  ${meta.sourceFile}`);
    }
    const { tree } = loadAndNormalizeMarkdown(
      new TextEncoder().encode(page.markdownText),
      page.sourceFile,
    );

    const links = {
      resolvePageHref(href: string): string | null {
        const pathOnly = href.split('#')[0]!.split('?')[0]!;
        const frag = href.includes('#') ? `#${href.split('#').slice(1).join('#')}` : '';
        if (!pathOnly.endsWith('.md') && pathOnly !== '') return null;
        let targetFile: string;
        try {
          targetFile = resolveRelativeHref(page.sourceFile, pathOnly || './');
        } catch {
          return null;
        }
        const target = pageBySource.get(targetFile);
        if (!target) return null;
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

    const { html: articleHtml } = renderArticleHtml(tree, page.sourceFile, links);
    const prev = i > 0 ? ordered[i - 1]! : null;
    const next = i < ordered.length - 1 ? ordered[i + 1]! : null;
    const document = assemblePageDocument({
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
    const bytes = new TextEncoder().encode(document);
    if (bytes.byteLength > 2 * 1024 * 1024) {
      throw new RendererError(
        'page_too_large',
        `Rendered page exceeds 2 MiB:\n  ${page.sourceFile}`,
      );
    }
    renderedPages.push({
      route: page.route,
      object: pageObjectPath(page.route),
      title: page.title,
      bytes,
    });
  }

  const files: RenderedFile[] = [];
  const manifestPages = [];
  for (const p of renderedPages) {
    files.push({ objectPath: p.object, bytes: p.bytes });
    manifestPages.push({
      route: p.route,
      object: p.object,
      title: p.title,
      size: p.bytes.byteLength,
      sha256: await fileSha256(p.bytes),
    });
  }

  const manifestAssets = [];
  for (const asset of graph.assets) {
    const abs = path.join(graph.rootDir, asset.sourceFile);
    const bytes = new Uint8Array(await fsp.readFile(abs));
    const object = mediaObjectPath('assets', asset.publicPath);
    files.push({ objectPath: object, bytes });
    manifestAssets.push({
      path: asset.publicPath,
      object,
      media_type: asset.mediaType,
      size: bytes.byteLength,
      sha256: await fileSha256(bytes),
    });
  }

  const manifestAttachments = [];
  for (const att of graph.attachments) {
    const abs = path.join(graph.rootDir, att.sourceFile);
    const bytes = new Uint8Array(await fsp.readFile(abs));
    const object = mediaObjectPath('attachments', att.publicPath);
    files.push({ objectPath: object, bytes });
    manifestAttachments.push({
      path: att.publicPath,
      object,
      media_type: att.mediaType,
      filename: att.filename,
      size: bytes.byteLength,
      sha256: await fileSha256(bytes),
    });
  }

  const file_count = manifestPages.length + manifestAssets.length + manifestAttachments.length;
  const uncompressed_size =
    manifestPages.reduce((s, p) => s + p.size, 0) +
    manifestAssets.reduce((s, a) => s + a.size, 0) +
    manifestAttachments.reduce((s, a) => s + a.size, 0);

  const draft: ManifestDraft = {
    schema_version: 1,
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
    artifact: { file_count, uncompressed_size },
  };

  const manifest = await sealManifest(draft);
  const manifestFile: RenderedFile = {
    objectPath: 'nrdocs-manifest.json',
    bytes: new TextEncoder().encode(JSON.stringify(manifest)),
  };
  const rest = files
    .slice()
    .sort((a, b) => (a.objectPath < b.objectPath ? -1 : a.objectPath > b.objectPath ? 1 : 0));

  return { manifest, files: [manifestFile, ...rest] };
}
