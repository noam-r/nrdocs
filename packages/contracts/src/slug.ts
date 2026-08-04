/** Site slug validation — never silently rewritten. */

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

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
