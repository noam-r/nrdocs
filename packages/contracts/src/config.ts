import { parseSiteId, type SiteId } from './ids.js';
import { assertDirection, assertLanguage, type Direction } from './language.js';
import { assertTitle } from './title.js';

export type NavigationAuto = 'auto';

export type NavigationEntry = {
  title: string;
  file?: string;
  children?: NavigationEntry[];
};

export type NrdocsConfig = {
  publish?: { credential: SiteId };
  title: string;
  language: string;
  direction: Direction;
  navigation: NavigationAuto | NavigationEntry[];
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
  const allowed = new Set(['publish', 'title', 'language', 'direction', 'navigation']);
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

  return publish
    ? { publish, title, language, direction, navigation }
    : { title, language, direction, navigation };
}

export function navigationDepth(entries: readonly NavigationEntry[], depth = 1): number {
  let max = depth;
  for (const e of entries) {
    if (e.children) max = Math.max(max, navigationDepth(e.children, depth + 1));
  }
  return max;
}
