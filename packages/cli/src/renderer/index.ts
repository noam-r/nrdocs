/**
 * Site renderer — orchestrates the full rendering pipeline.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderMarkdown, contentHasMermaid } from './markdown.js';
import {
  generateAutoNav,
  extractTitle,
  navConfigToNavItems,
} from './navigation.js';
import type { NavItem } from './navigation.js';
import type { NavConfigEntry } from './navigation.js';
import { rewriteLinks } from './links.js';
import { wrapInTemplate } from './template.js';
import { collectAssets } from './assets.js';
import {
  loadMermaidRuntime,
  MERMAID_ARTIFACT_PATH,
  mermaidScriptSrcForOutput,
} from './mermaid-runtime.js';

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
}

export interface RenderedSite {
  files: RenderedFile[];
  manifest: Record<string, unknown>;
}

export interface RenderedFile {
  path: string;
  content: Buffer;
}

function resolveNavItems(
  resolvedDocsDir: string,
  nav: NavConfigEntry[] | 'auto' | undefined,
  indexPath: string,
): NavItem[] {
  if (nav && nav !== 'auto' && Array.isArray(nav)) {
    return navConfigToNavItems(nav, resolvedDocsDir);
  }
  return generateAutoNav(resolvedDocsDir, indexPath);
}

/**
 * Renders the full documentation site from Markdown sources.
 */
export async function renderSite(options: RenderOptions): Promise<RenderedSite> {
  const { docsDir, siteTitle, baseUrl, owner, repo, nav, indexPath = 'index.md' } = options;
  const resolvedDocsDir = path.resolve(docsDir);

  const navItems = resolveNavItems(resolvedDocsDir, nav, indexPath);
  const siteBase = `/${owner}/${repo}/`;

  const renderedFiles: RenderedFile[] = [];
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

    const navWithActive: NavItem[] = navItems.map((item) => ({
      ...item,
      active: item.path === navItem.path,
    }));

    const outputPath = navItem.href === ''
      ? 'index.html'
      : navItem.href.replace(/\/$/, '') + '/index.html';

    const fullHtml = wrapInTemplate({
      title: pageTitle,
      siteTitle,
      content: html,
      nav: navWithActive,
      canonicalUrl,
      baseUrl: siteBase,
      includeMermaid: pageHasMermaid,
      mermaidScriptSrc: pageHasMermaid ? mermaidScriptSrcForOutput(outputPath) : null,
    });

    renderedFiles.push({
      path: outputPath,
      content: Buffer.from(fullHtml, 'utf-8'),
    });
  }

  if (siteHasMermaid) {
    renderedFiles.push({
      path: MERMAID_ARTIFACT_PATH,
      content: loadMermaidRuntime(),
    });
  }

  const assets = collectAssets(resolvedDocsDir);
  renderedFiles.push(...assets);

  const manifest: Record<string, unknown> = {
    version: 1,
    generator: 'nrdocs-cli',
    owner,
    repo,
    siteTitle,
    baseUrl,
    generatedAt: new Date().toISOString(),
    fileCount: renderedFiles.length,
    pages: navItems.map((item) => ({
      title: item.title,
      path: item.href === '' ? 'index.html' : item.href.replace(/\/$/, '') + '/index.html',
      sourcePath: item.path,
    })),
  };

  return { files: renderedFiles, manifest };
}
