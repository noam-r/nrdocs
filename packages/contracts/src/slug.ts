/** Site slug validation — never silently rewritten. Callers may ASCII-case-fold first. */

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Trim and ASCII-lowercase. Does not insert hyphens, drop characters, or otherwise rewrite. */
export function foldSlugInput(value: string): string {
  return value.trim().toLowerCase();
}

export const RESERVED_ROOT_SEGMENTS = Object.freeze(['_nrdocs'] as const);

export function isReservedSlug(slug: string): boolean {
  return (RESERVED_ROOT_SEGMENTS as readonly string[]).includes(slug);
}

export function parseSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length < 1 || value.length > 63) return null;
  if (!SLUG_RE.test(value)) return null;
  if (isReservedSlug(value)) return null;
  return value;
}

export function assertSlug(value: unknown): string {
  const slug = parseSlug(value);
  if (!slug) {
    throw new Error('invalid or reserved site slug');
  }
  return slug;
}
