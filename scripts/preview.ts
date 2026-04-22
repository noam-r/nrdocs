#!/usr/bin/env npx tsx
/**
 * Local preview script — builds a docs site from a sample repo directory
 * and writes the output HTML to a local folder you can open in a browser.
 *
 * Usage:
 *   npx tsx scripts/preview.ts [input-dir] [output-dir]
 *
 * Defaults:
 *   input-dir:  sample-docs/
 *   output-dir: dist-preview/
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { parseProjectConfig, parseNavConfig } from '../src/site-builder/config-parser.js';
import { buildSite } from '../src/site-builder/site-builder.js';

const inputDir = process.argv[2] || 'docs';
const outputDir = process.argv[3] || 'dist-preview';

// ── Read config files ────────────────────────────────────────────────

function readRequired(name: string): string {
  const path = join(inputDir, name);
  if (!existsSync(path)) {
    console.error(`Missing required file: ${path}`);
    process.exit(1);
  }
  return readFileSync(path, 'utf-8');
}

const projectYml = readRequired('project.yml');
const navYml = readRequired('nav.yml');

// ── Parse configs ────────────────────────────────────────────────────

const projectConfig = parseProjectConfig(projectYml);
const navConfig = parseNavConfig(navYml);

console.log(`Project: ${projectConfig.title} (slug: ${projectConfig.slug})`);

// ── Collect Markdown pages from content/ ─────────────────────────────

const contentDir = join(inputDir, 'content');
if (!existsSync(contentDir)) {
  console.error(`Missing content directory: ${contentDir}`);
  process.exit(1);
}

function collectMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(full));
    } else if (entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

const mdFiles = collectMarkdownFiles(contentDir);
const pages = new Map<string, string>();

for (const file of mdFiles) {
  // content/guides/installation.md → guides/installation
  const rel = relative(contentDir, file).replace(/\.md$/, '').replace(/\\/g, '/');
  pages.set(rel, readFileSync(file, 'utf-8'));
}

console.log(`Found ${pages.size} page(s): ${[...pages.keys()].join(', ')}`);

// ── Build ────────────────────────────────────────────────────────────

let artifacts;
try {
  artifacts = buildSite(projectConfig, navConfig, pages, projectConfig.slug);
} catch (err) {
  console.error(`Build failed: ${(err as Error).message}`);
  process.exit(1);
}

// ── Write output ─────────────────────────────────────────────────────

const decoder = new TextDecoder();

for (const artifact of artifacts) {
  const outPath = join(outputDir, artifact.path);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, decoder.decode(artifact.content));
}

console.log(`\nWrote ${artifacts.length} file(s) to ${outputDir}/`);
console.log(`\nOpen in browser:`);
for (const artifact of artifacts) {
  console.log(`  file://${join(process.cwd(), outputDir, artifact.path)}`);
}
