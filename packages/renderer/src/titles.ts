import { assertTitle, normalizeTitle } from '@nrdocs/contracts';
import { RendererError } from './types.js';

/** Strip a leading two-digit order prefix and separator: `01-overview` → `overview`. */
export function stripOrderPrefix(name: string): string {
  const m = /^(\d{2})-(.+)$/.exec(name);
  return m ? m[2]! : name;
}

/**
 * Humanize a slug-like filename/directory remainder.
 * Spec says "words humanized" without a character-level algorithm; this is the
 * locked Phase 3 implementation: split on `-`, capitalize each word's first scalar.
 */
export function humanizeSlug(slug: string): string {
  const parts = slug.split('-').filter((p) => p.length > 0);
  if (parts.length === 0) return slug;
  return parts
    .map((word) => {
      const chars = [...word];
      if (chars.length === 0) return word;
      return chars[0]!.toLocaleUpperCase('en-US') + chars.slice(1).join('');
    })
    .join(' ');
}

export function titleFromFilename(basename: string): string {
  const withoutExt = basename.endsWith('.md') ? basename.slice(0, -3) : basename;
  const remainder = stripOrderPrefix(withoutExt);
  return assertDerivedTitle(humanizeSlug(remainder));
}

export function titleFromDirectoryName(dirname: string): string {
  const remainder = stripOrderPrefix(dirname);
  return assertDerivedTitle(humanizeSlug(remainder));
}

export function assertDerivedTitle(raw: string): string {
  const normalized = normalizeTitle(raw);
  if (!normalized) {
    throw new RendererError(
      'invalid_title',
      `Derived title is invalid (empty, control characters, or longer than 160 scalars):\n  ${raw}`,
    );
  }
  return normalized;
}

export function assertConfiguredTitle(raw: unknown): string {
  try {
    return assertTitle(raw);
  } catch {
    throw new RendererError('invalid_title', 'Site or navigation title is invalid.');
  }
}
