/**
 * Parse and update docs/nrdocs.yml (repo owner config).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import YAML from 'yaml';
import { parseApiUrlFromConfig, parseApiUrlFromWorkflow } from '../errors.js';
import {
  discoverNavEntries,
  flattenNavPaths,
  type NavConfigEntry,
} from '../renderer/navigation.js';

export type NavConfig = 'auto' | NavConfigEntry[];

export interface DocsConfig {
  /** When false, disables Markdown export UI and omits source files from artifacts. Default true when omitted. */
  export?: boolean;
  site?: {
    title?: string;
    description?: string;
    api_url?: string;
    requested_access?: string;
  };
  content?: {
    source_dir?: string;
    index?: string;
    nav?: NavConfig;
  };
  request?: {
    access?: string;
  };
}

/**
 * Returns whether Markdown export is enabled for this repo (default true).
 */
export function isExportEnabled(config: DocsConfig): boolean {
  return config.export !== false;
}

export interface LoadDocsConfigResult {
  config: DocsConfig;
  configPath: string;
  contentDir: string;
}

export interface DocsConfigValidation {
  valid: boolean;
  error?: string;
  title?: string;
  apiUrl?: string;
}

export interface DocsApiUrlSources {
  flag?: string;
  env?: string;
  configPath?: string;
  workflowPath?: string;
  profileUrl?: string;
}

export interface BuildDocsConfigOptions {
  title: string;
  apiUrl: string;
  requestedAccess?: string;
  exportEnabled?: boolean;
  sourceDir?: string;
  nav?: NavConfig;
  index?: string;
  description?: string;
}

/**
 * Validates parsed docs/nrdocs.yml structure required for publish.
 */
export function validateDocsConfig(config: DocsConfig): DocsConfigValidation {
  const errors: string[] = [];

  if (!config.site || typeof config.site !== 'object') {
    errors.push('missing "site:" section');
  } else {
    if (!config.site.title?.trim()) {
      errors.push('site.title is required');
    }
    if (!config.site.api_url?.trim()) {
      errors.push('site.api_url is required');
    }
  }

  if (!config.content || typeof config.content !== 'object') {
    errors.push('missing "content:" section');
  }

  if (errors.length > 0) {
    return { valid: false, error: errors.join('; ') };
  }

  return {
    valid: true,
    title: config.site!.title!.trim(),
    apiUrl: config.site!.api_url!.trim(),
  };
}

/**
 * Parses docs/nrdocs.yml from disk without throwing.
 */
export function parseDocsConfigFile(configPath: string): DocsConfig | null {
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const parsed = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed as DocsConfig;
  } catch {
    return null;
  }
}

/**
 * Loads and validates docs/nrdocs.yml from disk.
 */
export function validateDocsConfigFile(configPath: string): DocsConfigValidation {
  if (!fs.existsSync(configPath)) {
    return { valid: false, error: `Config file not found: ${configPath}` };
  }

  const config = parseDocsConfigFile(configPath);
  if (!config) {
    return { valid: false, error: `Invalid YAML: ${configPath}` };
  }

  return validateDocsConfig(config);
}

/**
 * Extracts salvageable fields from a parsed (possibly invalid) config.
 */
export function salvageDocsFields(
  config: DocsConfig & Record<string, unknown>,
): {
  title?: string;
  description?: string;
  apiUrl?: string;
  exportEnabled: boolean;
  requestedAccess?: string;
} {
  const title =
    config.site?.title?.trim() ||
    (typeof config.title === 'string' ? config.title.trim() : undefined);
  const description =
    config.site?.description?.trim() ||
    (typeof config.description === 'string' ? config.description.trim() : undefined);
  const apiUrl = config.site?.api_url?.trim();
  const requestedAccess =
    config.request?.access?.trim() ||
    config.site?.requested_access?.trim() ||
    (typeof config.requested_access === 'string' ? config.requested_access.trim() : undefined);

  return {
    title,
    description,
    apiUrl,
    exportEnabled: config.export !== false,
    requestedAccess,
  };
}

/**
 * Resolves the publish API URL from known local sources (no prompts).
 */
export function resolveDocsApiUrl(sources: DocsApiUrlSources): string | undefined {
  const pick = (value?: string) => {
    const trimmed = value?.trim();
    return trimmed || undefined;
  };

  const fromFlag = pick(sources.flag);
  if (fromFlag) return fromFlag;

  const fromEnv = pick(sources.env);
  if (fromEnv) return fromEnv;

  if (sources.configPath && fs.existsSync(sources.configPath)) {
    const validation = validateDocsConfigFile(sources.configPath);
    if (validation.apiUrl) return validation.apiUrl;

    const content = fs.readFileSync(sources.configPath, 'utf-8');
    const fromRegex = pick(parseApiUrlFromConfig(content));
    if (fromRegex) return fromRegex;
  }

  if (sources.workflowPath && fs.existsSync(sources.workflowPath)) {
    const workflow = fs.readFileSync(sources.workflowPath, 'utf-8');
    const fromWorkflow = pick(parseApiUrlFromWorkflow(workflow));
    if (fromWorkflow) return fromWorkflow;
  }

  return pick(sources.profileUrl);
}

/**
 * Builds a valid docs/nrdocs.yml object.
 */
export function buildDocsConfig(options: BuildDocsConfigOptions): DocsConfig {
  const config: DocsConfig = {
    export: options.exportEnabled !== false,
    site: {
      title: options.title,
      api_url: options.apiUrl,
    },
    content: {
      source_dir: options.sourceDir ?? '.',
      nav: options.nav ?? 'auto',
    },
  };

  if (options.description) {
    config.site!.description = options.description;
  }
  if (options.index) {
    config.content!.index = options.index;
  }
  if (options.requestedAccess) {
    config.request = { access: options.requestedAccess };
  }

  return config;
}

/**
 * Writes docs/nrdocs.yml to disk.
 */
export function writeDocsConfigFile(configPath: string, config: DocsConfig): void {
  const doc = new YAML.Document(config);
  const body = doc.toString();
  fs.writeFileSync(configPath, `# nrdocs site configuration\n${body}`, 'utf-8');
}

/**
 * Loads and parses docs/nrdocs.yml.
 */
export function loadDocsConfig(docsDir: string): LoadDocsConfigResult {
  const configPath = path.resolve(docsDir, 'nrdocs.yml');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const config = YAML.parse(raw) as DocsConfig;
  if (!config || typeof config !== 'object') {
    throw new Error(`Invalid config: ${configPath}`);
  }

  const sourceDir = config.content?.source_dir ?? '.';
  const contentDir = path.resolve(docsDir, sourceDir);

  return { config, configPath, contentDir };
}

/**
 * Returns true if nav is an explicit list (not auto).
 */
export function hasExplicitNav(config: DocsConfig): boolean {
  return Array.isArray(config.content?.nav);
}

/**
 * Normalizes parsed nav from YAML into NavConfigEntry[].
 */
export function parseNavEntries(nav: unknown): NavConfigEntry[] {
  if (!Array.isArray(nav)) {
    throw new Error('content.nav must be a list or "auto"');
  }
  const entries: NavConfigEntry[] = [];
  for (const item of nav) {
    if (!item || typeof item !== 'object') {
      throw new Error('Each nav entry must be an object with title');
    }
    const rec = item as Record<string, unknown>;
    if (typeof rec['title'] !== 'string') {
      throw new Error('Each nav entry must have a title string');
    }
    const hasPath = typeof rec['path'] === 'string';
    const hasChildren = Array.isArray(rec['children']) && rec['children'].length > 0;
    if (!hasPath && !hasChildren) {
      throw new Error('Each nav entry needs path and/or children');
    }
    const entry: NavConfigEntry = { title: rec['title'] };
    if (hasPath) {
      entry.path = (rec['path'] as string).replace(/\\/g, '/');
    }
    if (Array.isArray(rec['children'])) {
      entry.children = parseNavEntries(rec['children']);
    }
    entries.push(entry);
  }
  return entries;
}

/**
 * Gets nav as explicit entries, or null if auto/missing.
 */
export function getExplicitNav(config: DocsConfig): NavConfigEntry[] | null {
  const nav = config.content?.nav;
  if (nav === undefined || nav === 'auto') return null;
  if (Array.isArray(nav)) return parseNavEntries(nav);
  throw new Error('content.nav must be "auto" or a list of entries');
}

/**
 * Validates explicit nav paths exist and are unique.
 */
export function validateNavPaths(
  entries: NavConfigEntry[],
  contentDir: string,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const seen = new Set<string>();

  const walk = (list: NavConfigEntry[]) => {
    for (const e of list) {
      if (!e.path && !e.children?.length) {
        errors.push(`Nav entry "${e.title}" has no path or children`);
        continue;
      }
      if (e.path) {
        const p = e.path.replace(/\\/g, '/');
        if (seen.has(p)) {
          errors.push(`Duplicate nav path: ${p}`);
        }
        seen.add(p);

        const full = path.join(contentDir, p);
        if (!fs.existsSync(full)) {
          errors.push(`Nav path not found: ${p}`);
        }
      }
      if (e.children?.length) walk(e.children);
    }
  };

  walk(entries);
  return { valid: errors.length === 0, errors };
}

export interface WriteNavOptions {
  /** Comment header source (e.g. nrdocs init, nrdocs nav generate). */
  generatedBy?: string;
  /** Preferred home page path; falls back to first nav entry. */
  indexPath?: string;
}

/**
 * Picks content.index from nav entries (index.md if present, else first page).
 */
export function resolveContentIndex(
  navEntries: NavConfigEntry[],
  indexPath = 'index.md',
): string {
  const paths = flattenNavPaths(navEntries);
  const preferred = indexPath.replace(/\\/g, '/');
  if (paths.includes(preferred)) return preferred;
  return paths[0]!;
}

/**
 * Writes nav list into docs/nrdocs.yml, preserving other keys.
 */
export function writeNavToConfig(
  configPath: string,
  navEntries: NavConfigEntry[],
  options?: WriteNavOptions,
): void {
  const generatedBy = options?.generatedBy ?? 'nrdocs nav generate';
  let raw = fs.readFileSync(configPath, 'utf-8');
  raw = raw.replace(/^# content\.nav generated by: .+\n/gm, '');

  const config = YAML.parse(raw) as DocsConfig;
  if (!config || typeof config !== 'object') {
    throw new Error(`Invalid config: ${configPath}`);
  }

  if (!config.content) {
    config.content = {};
  }
  config.content.nav = navEntries;
  config.content.index = resolveContentIndex(navEntries, options?.indexPath);

  const doc = new YAML.Document(config);
  const header = `# content.nav generated by: ${generatedBy}\n`;
  const body = doc.toString();
  fs.writeFileSync(configPath, header + body, 'utf-8');
}

/**
 * Discovers markdown under docs/ and writes explicit content.nav (returns page count).
 */
export function generateNavInConfig(
  docsDir: string,
  options?: WriteNavOptions,
): number {
  const loaded = loadDocsConfig(docsDir);
  const indexPath = options?.indexPath ?? loaded.config.content?.index ?? 'index.md';
  const entries = discoverNavEntries(loaded.contentDir, { indexPath });
  const pageCount = flattenNavPaths(entries).length;
  if (pageCount === 0) return 0;
  writeNavToConfig(loaded.configPath, entries, { ...options, indexPath });
  return pageCount;
}

/**
 * Serializes nav entries for dry-run output.
 */
export function formatNavYaml(navEntries: NavConfigEntry[]): string {
  const partial: DocsConfig = {
    content: {
      nav: navEntries,
    },
  };
  return YAML.stringify(partial).trimEnd();
}
