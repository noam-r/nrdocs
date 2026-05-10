/**
 * Site renderer — orchestrates the full rendering pipeline.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderMarkdown } from './markdown.js';
import { generateAutoNav, extractTitle } from './navigation.js';
import type { NavItem } from './navigation.js';
import { rewriteLinks } from './links.js';
import { wrapInTemplate } from './template.js';
import { collectAssets } from './assets.js';

export interface RenderOptions {
  docsDir: string;
  siteTitle: string;
  baseUrl: string;
  owner: string;
  repo: string;
  nav?: 'auto' | NavEntry[];
}

export interface NavEntry {
  title: string;
  path: string;
  children?: NavEntry[];
}

export interface RenderedSite {
  files: RenderedFile[];
  manifest: Record<string, unknown>;
}

export interface RenderedFile {
  path: string;
  content: Buffer;
}

/**
 * Renders the full documentation site from Markdown sources.
 */
export async function renderSite(options: RenderOptions): Promise<RenderedSite> {
  const { docsDir, siteTitle, baseUrl, owner, repo } = options;
  const resolvedDocsDir = path.resolve(docsDir);

  // Generate navigation
  const navItems = generateAutoNav(resolvedDocsDir);
  const siteBase = `/${owner}/${repo}/`;

  const renderedFiles: RenderedFile[] = [];

  // Render each markdown file
  for (const navItem of navItems) {
    const filePath = path.join(resolvedDocsDir, navItem.path);
    const markdownContent = fs.readFileSync(filePath, 'utf-8');

    // Render markdown to HTML
    let html = renderMarkdown(markdownContent);

    // Determine the base path for link resolution (directory of current file)
    const fileDir = path.dirname(navItem.path);
    const baseLinkPath = fileDir === '.' ? '' : fileDir;

    // Rewrite links
    html = rewriteLinks(html, baseLinkPath, owner, repo);

    // Determine page title
    const pageTitle = extractTitle(markdownContent, navItem.path);

    // Build canonical URL
    const canonicalUrl = `${baseUrl}${siteBase}${navItem.href}`;

    // Mark active nav item
    const navWithActive: NavItem[] = navItems.map((item) => ({
      ...item,
      active: item.path === navItem.path,
    }));

    // Wrap in template
    const fullHtml = wrapInTemplate({
      title: pageTitle,
      siteTitle,
      content: html,
      nav: navWithActive,
      canonicalUrl,
      baseUrl: siteBase,
    });

    // Determine output path
    const outputPath = navItem.href === ''
      ? 'index.html'
      : navItem.href.replace(/\/$/, '') + '/index.html';

    renderedFiles.push({
      path: outputPath,
      content: Buffer.from(fullHtml, 'utf-8'),
    });
  }

  // Collect static assets
  const assets = collectAssets(resolvedDocsDir);
  renderedFiles.push(...assets);

  // Build manifest
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
