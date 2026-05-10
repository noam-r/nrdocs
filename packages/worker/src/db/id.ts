/**
 * ID generation for nrdocs entities.
 * Uses crypto.randomUUID() with entity-specific prefixes.
 */

const VALID_PREFIXES = ['repo_', 'build_', 'cred_', 'rule_', 'evt_'] as const;

export type IdPrefix = (typeof VALID_PREFIXES)[number];

export function generateId(prefix: IdPrefix): string {
  return `${prefix}${crypto.randomUUID().replace(/-/g, '')}`;
}
