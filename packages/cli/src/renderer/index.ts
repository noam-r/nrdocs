/**
 * Site renderer — orchestrates the full rendering pipeline.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderMarkdown, contentHasMermaid } from './markdown.js';
import {
  extractTitle,
  navConfigToNavItems,
  navConfigToSidebar,
  discoverNavEntries,
} from './navigation.js';
import type { NavItem } from './navigation.js';
import type { NavConfigEntry, NavSidebarEntry } from './navigation.js';
import { rewriteLinks } from './links.js';
import { wrapInTemplate } from './template.js';
import { collectAssets } from './assets.js';
import {
  loadMermaidRuntime,
  MERMAID_ARTIFACT_PATH,
  mermaidScriptSrcForOutput,
} from './mermaid-runtime.js';
import { buildSiteZip } from './site-zip.js';
import {
  NRDOCS_EXPORT_SITE_ZIP,
  nrdocsSourceArtifactPath,
} from '@nrdocs/shared';

export type { NavConfigEntry };

export interface RenderOptions {
  docsDir: string;
  siteTitle: string;
  baseUrl: string;
  owner: string;
  repo: string;
  /** Explicit nav from nrdocs.yml; omit or 'auto' for discovery. */
  nav?: NavConfigEntry[] | 'auto';
  indexPath?: string;
  /** When true, non-whitelist asset extensions may be included (operator rule consent). */
  allowUnlistedAssets?: boolean;
  /** When true, bundle Markdown sources and show export UI (default true). */
  exportEnabled?: boolean;
}

export interface RenderedSite {
  files: RenderedFile[];
  manifest: Record<string, unknown>;
}

export interface RenderedFile {
  path: string;
  content: Buffer;
}

function resolveNav(
  resolvedDocsDir: string,
  nav: NavConfigEntry[] | 'auto' | undefined,
  indexPath: string,
): { items: NavItem[]; sidebarConfig: NavConfigEntry[] } {
  if (nav && nav !== 'auto' && Array.isArray(nav)) {
    return {
      items: navConfigToNavItems(nav, resolvedDocsDir),
      sidebarConfig: nav,
    };
  }
  const sidebarConfig = discoverNavEntries(resolvedDocsDir, { indexPath });
  return {
    items: navConfigToNavItems(sidebarConfig, resolvedDocsDir),
    sidebarConfig,
  };
}

/**
 * Renders the full documentation site from Markdown sources.
 */
export async function renderSite(options: RenderOptions): Promise<RenderedSite> {
  const {
    docsDir,
    siteTitle,
    baseUrl,
    owner,
    repo,
    nav,
    indexPath = 'index.md',
    exportEnabled = true,
  } = options;
  const resolvedDocsDir = path.resolve(docsDir);

  const { items: navItems, sidebarConfig } = resolveNav(resolvedDocsDir, nav, indexPath);
  const siteBase = `/${owner}/${repo}/`;
  const siteZipDownloadUrl = exportEnabled ? `${siteBase}${NRDOCS_EXPORT_SITE_ZIP}` : null;

  const renderedFiles: RenderedFile[] = [];
  const zipEntries: Array<{ name: string; data: Buffer }> = [];
  let siteHasMermaid = false;

  for (const navItem of navItems) {
    const filePath = path.join(resolvedDocsDir, navItem.path);
    const markdownContent = fs.readFileSync(filePath, 'utf-8');
    const pageHasMermaid = contentHasMermaid(markdownContent);
    if (pageHasMermaid) siteHasMermaid = true;

    let html = renderMarkdown(markdownContent);

    const fileDir = path.dirname(navItem.path);
    const baseLinkPath = fileDir === '.' ? '' : fileDir;

    html = rewriteLinks(html, baseLinkPath, owner, repo);

    const pageTitle = extractTitle(markdownContent, navItem.path);

    const canonicalUrl = `${baseUrl}${siteBase}${navItem.href}`;

    const sidebar: NavSidebarEntry[] = navConfigToSidebar(sidebarConfig, navItem.path);

    const outputPath = navItem.href === ''
      ? 'index.html'
      : navItem.href.replace(/\/$/, '') + '/index.html';

    const sourceArtifactPath = nrdocsSourceArtifactPath(navItem.path);
    const pageSourceDownloadUrl = exportEnabled
      ? `${siteBase}${sourceArtifactPath.split('/').map(encodeURIComponent).join('/')}`
      : null;

    if (exportEnabled) {
      const sourceContent = fs.readFileSync(filePath);
      renderedFiles.push({
        path: sourceArtifactPath,
        content: sourceContent,
      });
      zipEntries.push({
        name: navItem.path.replace(/\\/g, '/'),
        data: sourceContent,
      });
    }

    const fullHtml = wrapInTemplate({
      title: pageTitle,
      siteTitle,
      content: html,
      nav: sidebar,
      canonicalUrl,
      baseUrl: siteBase,
      includeMermaid: pageHasMermaid,
      mermaidScriptSrc: pageHasMermaid ? mermaidScriptSrcForOutput(outputPath) : null,
      exportEnabled,
      pageSourceDownloadUrl,
      siteZipDownloadUrl,
    });

    renderedFiles.push({
      path: outputPath,
      content: Buffer.from(fullHtml, 'utf-8'),
    });
  }

  if (exportEnabled && zipEntries.length > 0) {
    renderedFiles.push({
      path: NRDOCS_EXPORT_SITE_ZIP,
      content: buildSiteZip(zipEntries),
    });
  }

  if (siteHasMermaid) {
    renderedFiles.push({
      path: MERMAID_ARTIFACT_PATH,
      content: loadMermaidRuntime(),
    });
  }

  const { files: assetFiles, rejected: rejectedAssets } = collectAssets(resolvedDocsDir, {
    allowUnlisted: options.allowUnlistedAssets ?? false,
  });
  if (rejectedAssets.length > 0) {
    const lines = rejectedAssets.map((r) => `  - ${r.path}: ${r.message}`).join('\n');
    throw new Error(
      `Artifact contains files not permitted by extension policy:\n${lines}\n` +
        `Ask your operator: nrdocs rules add 'OWNER/*' --access password --allow-unlisted-files true`,
    );
  }
  renderedFiles.push(...assetFiles);

  const manifest: Record<string, unknown> = {
    version: 1,
    generator: 'nrdocs-cli',
    owner,
    repo,
    siteTitle,
    baseUrl,
    generatedAt: new Date().toISOString(),
    fileCount: renderedFiles.length,
    export: { enabled: exportEnabled },
    pages: navItems.map((item) => ({
      title: item.title,
      path: item.href === '' ? 'index.html' : item.href.replace(/\/$/, '') + '/index.html',
      sourcePath: item.path,
      sourceArtifactPath: exportEnabled ? nrdocsSourceArtifactPath(item.path) : undefined,
    })),
  };

  return { files: renderedFiles, manifest };
}
