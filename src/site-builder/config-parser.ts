import { parse } from 'yaml';
import type { ProjectConfig, NavConfig, NavItem, AllowedListConfig, AccessMode } from '../types.js';

const VALID_ACCESS_MODES: AccessMode[] = ['public', 'password'];

const PROJECT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

/**
 * Validate a site slug (lowercase alphanumeric + internal hyphens).
 * Matches CLI `isValidSlug` rules.
 */
export function isValidProjectSlug(slug: string): boolean {
  return typeof slug === 'string' && slug.length > 0 && PROJECT_SLUG_PATTERN.test(slug);
}

/**
 * Parse and validate a `project.yml` file.
 *
 * Required fields: slug, title, description, publish_enabled, access_mode.
 * Throws descriptive errors for missing or invalid fields.
 */
export function parseProjectConfig(yamlContent: string): ProjectConfig {
  const raw = parse(yamlContent);

  if (raw == null || typeof raw !== 'object') {
    throw new Error('project.yml must be a YAML mapping');
  }

  const missing: string[] = [];
  for (const field of ['slug', 'title', 'description', 'publish_enabled', 'access_mode']) {
    if (raw[field] === undefined || raw[field] === null) {
      missing.push(field);
    }
  }
  if (missing.length > 0) {
    throw new Error(`project.yml is missing required fields: ${missing.join(', ')}`);
  }

  if (typeof raw.slug !== 'string' || raw.slug.trim() === '') {
    throw new Error('project.yml: slug must be a non-empty string');
  }
  if (typeof raw.title !== 'string' || raw.title.trim() === '') {
    throw new Error('project.yml: title must be a non-empty string');
  }
  if (typeof raw.description !== 'string') {
    throw new Error('project.yml: description must be a string');
  }
  if (typeof raw.publish_enabled !== 'boolean') {
    throw new Error('project.yml: publish_enabled must be a boolean');
  }
  if (!VALID_ACCESS_MODES.includes(raw.access_mode as AccessMode)) {
    throw new Error(
      `project.yml: access_mode must be one of: ${VALID_ACCESS_MODES.join(', ')}; got "${raw.access_mode}"`
    );
  }

  return {
    slug: raw.slug,
    title: raw.title,
    description: raw.description,
    publish_enabled: raw.publish_enabled,
    access_mode: raw.access_mode as AccessMode,
  };
}


/**
 * Validate a single nav item. A nav item must have a `label` and either:
 * - a `path` (leaf page), or
 * - `section: true` with a non-empty `children` array (section grouping).
 */
function validateNavItem(item: unknown, location: string): NavItem {
  if (item == null || typeof item !== 'object') {
    throw new Error(`${location}: nav item must be an object`);
  }

  const obj = item as Record<string, unknown>;

  if (typeof obj.label !== 'string' || obj.label.trim() === '') {
    throw new Error(`${location}: nav item must have a non-empty "label" string`);
  }

  const hasPath = obj.path !== undefined;
  const hasSection = obj.section === true;
  const hasChildren = Array.isArray(obj.children);

  if (!hasPath && !hasSection) {
    throw new Error(
      `${location} "${obj.label}": nav item must have either "path" or "section: true" with "children"`
    );
  }

  if (hasPath && hasSection) {
    throw new Error(
      `${location} "${obj.label}": nav item cannot have both "path" and "section: true"`
    );
  }

  if (hasPath) {
    if (typeof obj.path !== 'string' || obj.path.trim() === '') {
      throw new Error(`${location} "${obj.label}": path must be a non-empty string`);
    }
    return { label: obj.label, path: obj.path };
  }

  // Section item
  if (!hasChildren || (obj.children as unknown[]).length === 0) {
    throw new Error(
      `${location} "${obj.label}": section nav item must have a non-empty "children" array`
    );
  }

  const children = (obj.children as unknown[]).map((child, i) =>
    validateNavItem(child, `${location} > "${obj.label}" > children[${i}]`)
  );

  return { label: obj.label as string, section: true, children };
}

/**
 * Parse and validate a `nav.yml` file.
 *
 * Must contain a top-level `nav` array of nav items.
 */
export function parseNavConfig(yamlContent: string): NavConfig {
  const raw = parse(yamlContent);

  if (raw == null || typeof raw !== 'object') {
    throw new Error('nav.yml must be a YAML mapping');
  }

  if (!Array.isArray(raw.nav)) {
    throw new Error('nav.yml must contain a "nav" array');
  }

  if (raw.nav.length === 0) {
    throw new Error('nav.yml: "nav" array must not be empty');
  }

  const nav: NavItem[] = raw.nav.map((item: unknown, i: number) =>
    validateNavItem(item, `nav[${i}]`)
  );

  return { nav };
}

/**
 * Parse and validate an `allowed-list.yml` file.
 *
 * Must contain a top-level `allow` array of email/domain pattern strings.
 * An empty or absent file returns an empty allow list.
 */
export function parseAllowedListConfig(yamlContent: string): AllowedListConfig {
  const raw = parse(yamlContent);

  // Empty file or null content → empty allow list
  if (raw == null) {
    return { allow: [] };
  }

  if (typeof raw !== 'object') {
    throw new Error('allowed-list.yml must be a YAML mapping');
  }

  // Missing `allow` key → empty allow list
  if (raw.allow === undefined || raw.allow === null) {
    return { allow: [] };
  }

  if (!Array.isArray(raw.allow)) {
    throw new Error('allowed-list.yml: "allow" must be an array');
  }

  for (let i = 0; i < raw.allow.length; i++) {
    const entry = raw.allow[i];
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new Error(`allowed-list.yml: allow[${i}] must be a non-empty string`);
    }
  }

  return { allow: raw.allow as string[] };
}

/**
 * Validate that the slug declared in `project.yml` matches the registered slug.
 *
 * Throws if there is a mismatch (Requirement 10.5, 10.6).
 */
export function validateSlugMatch(config: ProjectConfig, registeredSlug: string): void {
  if (config.slug !== registeredSlug) {
    throw new Error(
      `Slug mismatch: project.yml declares slug "${config.slug}" but the registered slug is "${registeredSlug}"`
    );
  }
}
