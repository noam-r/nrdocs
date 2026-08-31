import { parseSiteId, type SiteId } from './ids.js';
import { assertDirection, assertLanguage, type Direction } from './language.js';
import { assertTitle } from './title.js';

export type NavigationAuto = 'auto';

export type NavigationEntry = {
  title: string;
  file?: string;
  children?: NavigationEntry[];
};

export type ApiConfig = {
  specification: string;
};

export type NrdocsConfig = {
  publish?: { credential: SiteId };
  title: string;
  language: string;
  direction: Direction;
  navigation: NavigationAuto | NavigationEntry[];
  api?: ApiConfig;
};

export type ParseConfigOptions = {
  /** When true, publish.credential is required. */
  requireCredential?: boolean;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseNavigationEntry(raw: unknown, depth: number): NavigationEntry {
  if (depth > 8) throw new Error('navigation depth exceeds 8');
  if (!isPlainObject(raw)) throw new Error('navigation entry must be an object');
  const allowed = new Set(['title', 'file', 'children']);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error(`unknown navigation field: ${key}`);
  }
  const title = assertTitle(raw.title);
  const file = raw.file === undefined ? undefined : String(raw.file);
  if (file !== undefined) {
    if (!file.endsWith('.md')) throw new Error('navigation file must end with .md');
    if (file.includes('\\') || file.startsWith('/') || file.split('/').includes('..')) {
      throw new Error('navigation file path is unsafe');
    }
  }
  let children: NavigationEntry[] | undefined;
  if (raw.children !== undefined) {
    if (!Array.isArray(raw.children) || raw.children.length === 0) {
      throw new Error('navigation children must be a non-empty array');
    }
    children = raw.children.map((c) => parseNavigationEntry(c, depth + 1));
  }
  if (!file && !children) throw new Error('navigation entry requires file and/or children');
  return children
    ? file
      ? { title, file, children }
      : { title, children }
    : { title, file: file! };
}

export function parseNrdocsConfig(raw: unknown, options: ParseConfigOptions = {}): NrdocsConfig {
  if (!isPlainObject(raw)) throw new Error('nrdocs.yml must be a mapping');
  const allowed = new Set(['publish', 'title', 'language', 'direction', 'navigation', 'api']);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error(`unknown nrdocs.yml field: ${key}`);
  }

  const title = assertTitle(raw.title);
  const language = assertLanguage(raw.language);
  const direction = assertDirection(raw.direction);

  let navigation: NrdocsConfig['navigation'];
  if (raw.navigation === undefined) {
    navigation = 'auto';
  } else if (raw.navigation === 'auto') {
    navigation = 'auto';
  } else if (Array.isArray(raw.navigation)) {
    if (raw.navigation.length === 0) throw new Error('explicit navigation must be non-empty');
    navigation = raw.navigation.map((e) => parseNavigationEntry(e, 1));
  } else {
    throw new Error('navigation must be auto or an explicit list');
  }

  let publish: NrdocsConfig['publish'];
  if (raw.publish !== undefined) {
    if (!isPlainObject(raw.publish)) throw new Error('publish must be a mapping');
    for (const key of Object.keys(raw.publish)) {
      if (key !== 'credential') throw new Error(`unknown publish field: ${key}`);
    }
    const siteId = parseSiteId(raw.publish.credential);
    if (!siteId) throw new Error('publish.credential must be a site ID');
    publish = { credential: siteId };
  }

  if (options.requireCredential && !publish) {
    throw new Error('publish.credential is required');
  }

  let api: ApiConfig | undefined;
  if (raw.api !== undefined) {
    if (!isPlainObject(raw.api)) throw new Error('api must be a mapping');
    for (const key of Object.keys(raw.api)) {
      if (key !== 'specification') throw new Error(`unknown api field: ${key}`);
    }
    if (typeof raw.api.specification !== 'string' || raw.api.specification.length === 0) {
      throw new Error('api.specification is required');
    }
    const spec = raw.api.specification;
    if (
      spec.includes('\\') ||
      spec.startsWith('/') ||
      spec.includes('\0') ||
      spec.split('/').some((p) => p === '' || p === '.' || p === '..')
    ) {
      throw new Error('api.specification path is unsafe');
    }
    if (!/\.(ya?ml|json)$/i.test(spec)) {
      throw new Error('api.specification must be a .yaml, .yml, or .json file');
    }
    api = { specification: spec };
  }

  const base = { title, language, direction, navigation };
  const withPublish = publish ? { ...base, publish } : base;
  return api ? { ...withPublish, api } : withPublish;
}

export function navigationDepth(entries: readonly NavigationEntry[], depth = 1): number {
  let max = depth;
  for (const e of entries) {
    if (e.children) max = Math.max(max, navigationDepth(e.children, depth + 1));
  }
  return max;
}
