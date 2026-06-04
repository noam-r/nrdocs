import * as fs from 'node:fs';
import * as path from 'node:path';
import { discoverNavEntries, flattenNavPaths } from '../renderer/navigation.js';
import {
  loadDocsConfig,
  hasExplicitNav,
  generateNavInConfig,
  formatNavYaml,
} from '../config/docs-config.js';

export interface NavGenerateOptions {
  docsDir?: string;
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

/**
 * Parses nav generate flags from args.
 */
export function parseNavGenerateArgs(args: string[]): NavGenerateOptions {
  const opts: NavGenerateOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--docs-dir' && i + 1 < args.length) {
      opts.docsDir = args[++i];
    } else if (arg === '--force') {
      opts.force = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--json') {
      opts.json = true;
    }
  }
  return opts;
}

/**
 * Handles `nrdocs nav generate`.
 */
export async function handleNavGenerate(args: string[]): Promise<void> {
  const opts = parseNavGenerateArgs(args);
  const docsDir = path.resolve(opts.docsDir ?? 'docs');
  const configPath = path.join(docsDir, 'nrdocs.yml');

  if (!fs.existsSync(configPath)) {
    console.error(`Error: Config file not found: ${configPath}`);
    console.error('Run: nrdocs init');
    process.exit(10);
  }

  let loaded;
  try {
    loaded = loadDocsConfig(docsDir);
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(10);
  }

  if (hasExplicitNav(loaded.config) && !opts.force) {
    console.error('Error: content.nav is already an explicit list in nrdocs.yml.');
    console.error('Use --force to overwrite, or edit the file manually.');
    process.exit(2);
  }

  const indexPath = loaded.config.content?.index ?? 'index.md';
  const entries = discoverNavEntries(loaded.contentDir, { indexPath });

  if (entries.length === 0) {
    console.error(`Error: No markdown files found in ${loaded.contentDir}`);
    process.exit(10);
  }

  const pageCount = flattenNavPaths(entries).length;

  if (opts.json) {
    console.log(JSON.stringify({ nav: entries, pages: pageCount }, null, 2));
    if (opts.dryRun) return;
  } else if (opts.dryRun) {
    console.log('# Dry run — content.nav that would be written:\n');
    console.log(formatNavYaml(entries));
    return;
  }

  generateNavInConfig(docsDir, { generatedBy: 'nrdocs nav generate', indexPath });

  if (!opts.json) {
    console.log(
      `Updated content.nav (${pageCount} page(s)) in ${path.relative(process.cwd(), configPath)}`,
    );
    console.log('Only nrdocs.yml was changed — no markdown files are created or modified.');
    console.log('Edit content.nav to reorder, then publish via GitHub Actions.');
  }
}
