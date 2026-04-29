import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { parse, stringify } from 'yaml';
import { CliUsageError } from '../cli-usage-error';
import { confirm, isInteractive } from '../prompts';
import { inferSlug, inferTitle } from '../slug-validator';
import { requireCleanGitWorktree, switchToImportBranch } from './git';
import type { ImportContext, ImportDetection, Importer, ImportResult } from './types';
import {
  hasFlag,
  isSafeRelativePath,
  isValidPublishBranch,
  parseFlag,
  readText,
  removePathSafely,
  snapshotDirectoryContents,
  stripMarkdownExtension,
  writeDirectorySnapshot,
  writeFilesSafely,
} from './utils';

interface MkDocsConfig {
  site_name?: unknown;
  site_description?: unknown;
  docs_dir?: unknown;
  nav?: unknown;
  plugins?: unknown;
  theme?: unknown;
  extra_css?: unknown;
  extra_javascript?: unknown;
  markdown_extensions?: unknown;
  redirects?: unknown;
  extra?: unknown;
}

function parseMkDocsYml(rawText: string): MkDocsConfig {
  // MkDocs configs sometimes use custom tags like:
  //   key: !ENV [VAR, default]
  //   key: !ENV VAR
  //
  // The `yaml` package treats unknown tags as YAMLWarning. For import we don't need
  // to evaluate env vars; we just need parsing to succeed quietly so we can read
  // nav/docs_dir/site_name/etc. We therefore replace `!ENV ...` with the provided
  // default (or empty string) before parsing.
  const normalized = rawText
    // !ENV [NAME, default]  -> default
    .replace(/!ENV\s*\[\s*[^,\]\r\n]+\s*,\s*([^\]\r\n]+)\s*\]/g, '$1')
    // !ENV [NAME] -> ""
    .replace(/!ENV\s*\[\s*[^\]\r\n]+\s*\]/g, '""')
    // !ENV NAME -> ""
    .replace(/!ENV\s+[^\s\r\n]+/g, '""');

  return parse(normalized) as MkDocsConfig;
}

interface NrdocsNavItem {
  label: string;
  path?: string;
  section?: true;
  children?: NrdocsNavItem[];
}

interface NavConversion {
  nav: NrdocsNavItem[];
  warnings: string[];
}

function titleFromPath(path: string): string {
  const base = basename(path).replace(/\.md$/i, '') || path;
  if (base.toLowerCase() === 'index') return 'Home';
  return inferTitle(base);
}

function mkdocsPathToNrdocsPath(path: string): string {
  return stripMarkdownExtension(path.split('#')[0]);
}

function convertNavEntry(entry: unknown, warnings: string[], location: string): NrdocsNavItem | null {
  if (typeof entry === 'string') {
    if (/^https?:\/\//i.test(entry)) {
      warnings.push(`${location}: external URL nav entry skipped: ${entry}`);
      return null;
    }
    return { label: titleFromPath(entry), path: mkdocsPathToNrdocsPath(entry) };
  }

  if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
    warnings.push(`${location}: unsupported nav entry skipped`);
    return null;
  }

  const pairs = Object.entries(entry as Record<string, unknown>);
  if (pairs.length !== 1) {
    warnings.push(`${location}: nav object should have one label; extra labels skipped`);
  }

  const [label, value] = pairs[0];
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) {
      warnings.push(`${location}: external URL nav entry skipped: ${label}`);
      return null;
    }
    return { label, path: mkdocsPathToNrdocsPath(value) };
  }

  if (Array.isArray(value)) {
    const children = value
      .map((child, idx) => convertNavEntry(child, warnings, `${location} > ${label}[${idx}]`))
      .filter((child): child is NrdocsNavItem => child !== null);
    if (children.length === 0) {
      warnings.push(`${location}: section "${label}" has no supported children and was skipped`);
      return null;
    }
    return { label, section: true, children };
  }

  warnings.push(`${location}: unsupported nav value skipped for "${label}"`);
  return null;
}

export function convertMkDocsNav(rawNav: unknown): NavConversion {
  const warnings: string[] = [];
  if (!Array.isArray(rawNav)) {
    return { nav: [], warnings: ['mkdocs.yml has no nav array; generated nav from Markdown files instead.'] };
  }

  const nav = rawNav
    .map((entry, idx) => convertNavEntry(entry, warnings, `nav[${idx}]`))
    .filter((entry): entry is NrdocsNavItem => entry !== null);

  return { nav, warnings };
}

function discoverMarkdownNav(sourceDir: string): NrdocsNavItem[] {
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const st = statSync(path);
      if (st.isDirectory()) {
        walk(path);
      } else if (st.isFile() && entry.endsWith('.md')) {
        files.push(relative(sourceDir, path).replace(/\\/g, '/'));
      }
    }
  }
  walk(sourceDir);
  return files.sort().map((file) => ({
    label: titleFromPath(file),
    path: stripMarkdownExtension(file),
  }));
}

function themeCustomDir(config: MkDocsConfig): unknown {
  if (config.theme == null || typeof config.theme !== 'object' || Array.isArray(config.theme)) {
    return undefined;
  }
  return (config.theme as Record<string, unknown>).custom_dir;
}

function warnUnsupported(config: MkDocsConfig): string[] {
  const warnings: string[] = [];
  if (config.plugins !== undefined) warnings.push('MkDocs plugins are not imported; review generated Markdown output.');
  if (themeCustomDir(config) !== undefined) warnings.push('MkDocs theme.custom_dir is not imported; custom templates/assets must be recreated for nrdocs.');
  if (config.theme !== undefined) warnings.push('MkDocs theme settings are not imported; nrdocs uses its own theme.');
  if (config.extra_css !== undefined) warnings.push('extra_css is not imported into nrdocs.');
  if (config.extra_javascript !== undefined) warnings.push('extra_javascript is not imported into nrdocs.');
  if (config.markdown_extensions !== undefined) warnings.push('MkDocs markdown_extensions may not all be supported by nrdocs.');
  if (config.redirects !== undefined) warnings.push('MkDocs redirects are not imported into nrdocs.');
  if (config.extra !== undefined) warnings.push('MkDocs extra configuration is not imported into nrdocs.');
  return warnings;
}

async function requireUnsupportedApproval(warnings: string[], args: string[]): Promise<void> {
  if (warnings.length === 0 || hasFlag(args, '--accept-unsupported-customizations')) {
    return;
  }

  const message = [
    'This MkDocs project uses customization that nrdocs import will not import:',
    ...warnings.map((warning) => `  - ${warning}`),
    '',
    'Continue with Markdown/nav conversion only?',
  ].join('\n');

  if (!isInteractive()) {
    throw new CliUsageError(
      `${message}\n\nRe-run with --accept-unsupported-customizations to acknowledge this in non-interactive mode.`,
    );
  }

  const approved = await confirm(message, false);
  if (!approved) {
    throw new CliUsageError('Import cancelled. No files were changed.');
  }
}

function projectYml(config: { slug: string; title: string; description: string }): string {
  return stringify({
    slug: config.slug,
    title: config.title,
    description: config.description,
    publish_enabled: true,
    access_mode: 'public',
  });
}

function printMkDocsHelp(): void {
  console.log(`Usage: nrdocs import mkdocs [options]

Convert a MkDocs repository into nrdocs local files. This does not create a
remote project or install GitHub secrets; run nrdocs init afterward.

Options:
  --mkdocs-file <path>       MkDocs config file (default: mkdocs.yml)
  --docs-dir <path>          Override MkDocs docs_dir
  --branch <value>           Git branch to create/switch for nrdocs output (default: nrdocs)
  --out-dir <path>           Output docs directory on the target branch (default: docs)
  --publish-branch <value>   Git branch that triggers publishing (default: --branch value)
  --slug <value>             Project slug override
  --title <value>            Project title override
  --description <value>      Project description override
  --accept-unsupported-customizations
                            Continue when MkDocs customizations cannot be imported
  --force                    Switch to an existing target branch and overwrite generated files that differ
  --help, -h                 Show this help message`);
}

export const mkdocsImporter: Importer = {
  name: 'mkdocs',
  displayName: 'MkDocs',
  summary: 'Convert mkdocs.yml + docs_dir into nrdocs files',
  async detect(context: ImportContext): Promise<ImportDetection> {
    const file = join(context.cwd, 'mkdocs.yml');
    if (existsSync(file)) return { confidence: 'matched', reason: 'mkdocs.yml found' };
    return { confidence: 'none', reason: 'mkdocs.yml not found' };
  },
  async run(context: ImportContext, args: string[]): Promise<ImportResult> {
    const force = hasFlag(args, '--force');
    const targetBranch = parseFlag(args, '--branch') ?? 'nrdocs';
    if (!isValidPublishBranch(targetBranch)) {
      throw new CliUsageError('Invalid import branch. Use a branch name like "nrdocs", "docs", or "docs/site".');
    }

    requireCleanGitWorktree(context.cwd);

    const mkdocsFile = join(context.cwd, parseFlag(args, '--mkdocs-file') ?? 'mkdocs.yml');
    if (!existsSync(mkdocsFile)) {
      throw new CliUsageError(`MkDocs config not found: ${mkdocsFile}`);
    }

    const raw = parseMkDocsYml(readText(mkdocsFile)) as MkDocsConfig | null;
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new CliUsageError('mkdocs.yml must be a YAML mapping');
    }
    const unsupportedWarnings = warnUnsupported(raw);
    await requireUnsupportedApproval(unsupportedWarnings, args);

    const docsDir = parseFlag(args, '--docs-dir') ?? (
      typeof raw.docs_dir === 'string' && raw.docs_dir.trim() ? raw.docs_dir : 'docs'
    );
    const outDir = parseFlag(args, '--out-dir') ?? 'docs';
    if (!isSafeRelativePath(outDir)) {
      throw new CliUsageError('Invalid --out-dir. Use a relative directory such as "docs" or "site/docs".');
    }

    const publishBranch = parseFlag(args, '--publish-branch') ?? targetBranch;
    if (!isValidPublishBranch(publishBranch)) {
      throw new CliUsageError('Invalid publish branch. Use a branch name like "main", "docs", or "docs/site".');
    }

    const sourceDir = join(context.cwd, docsDir);
    if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
      throw new CliUsageError(`MkDocs docs_dir not found: ${sourceDir}`);
    }
    const sourceFiles = snapshotDirectoryContents(sourceDir);

    const title = parseFlag(args, '--title') ?? (
      typeof raw.site_name === 'string' && raw.site_name.trim() ? raw.site_name : inferTitle(basename(context.cwd))
    );
    const description = parseFlag(args, '--description') ?? (
      typeof raw.site_description === 'string' ? raw.site_description : ''
    );
    const slug = parseFlag(args, '--slug') ?? inferSlug(title);
    if (!slug) {
      throw new CliUsageError('Could not infer a valid slug. Pass --slug <value>.');
    }

    const { nav: convertedNav, warnings: navWarnings } = convertMkDocsNav(raw.nav);
    const nav = convertedNav.length > 0 ? convertedNav : discoverMarkdownNav(sourceDir);
    if (nav.length === 0) {
      throw new CliUsageError(`No Markdown pages found in ${sourceDir}`);
    }

    const branchResult = switchToImportBranch(context.cwd, targetBranch, force);

    const outRoot = join(context.cwd, outDir);
    const contentDir = join(outRoot, 'content');

    if (branchResult.created || force) {
      removePathSafely(outRoot);
    }

    const written = writeFilesSafely([
      { path: join(outRoot, 'project.yml'), content: projectYml({ slug, title, description }) },
      { path: join(outRoot, 'nav.yml'), content: stringify({ nav }) },
    ], force);
    const copied = writeDirectorySnapshot(sourceFiles, contentDir, force);
    const initCommand = [
      'nrdocs init --token <bootstrap-token>',
      `--docs-dir ${outDir}`,
      ...(publishBranch === targetBranch ? [] : [`--publish-branch ${publishBranch}`]),
      `--slug ${slug}`,
      `--title "${title}"`,
    ].join(' ');

    return {
      generatedFiles: [...written, ...copied],
      warnings: [...navWarnings, ...unsupportedWarnings],
      nextSteps: [
        `Review the generated nrdocs files on branch '${targetBranch}'.`,
        `Run ${initCommand}`,
        `Commit and push branch '${targetBranch}': git push -u origin ${targetBranch}`,
        `The GitHub Actions publish workflow runs on pushes to '${publishBranch}'. A pull request is not required for publishing.`,
        `Do not merge '${targetBranch}' back to your development branch unless you intentionally want generated nrdocs files there.`,
      ],
    };
  },
  printHelp: printMkDocsHelp,
};
