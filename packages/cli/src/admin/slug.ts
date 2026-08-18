import { foldSlugInput, parseSlug } from '@nrdocs/contracts';
import { usageError } from '../errors.js';

export const SITE_SLUG_RULES =
  'Use 1–63 characters: letters, digits, and hyphens; start and end with a letter or digit. Uppercase letters are stored lowercase. Do not use _nrdocs.';

/** Fold CLI slug input to the stored form (trim + ASCII lowercase). */
export function foldSiteSlugInput(raw: string): string {
  return foldSlugInput(raw);
}

export function requireSiteSlug(raw: string, label = 'site slug'): string {
  const folded = foldSlugInput(raw);
  const slug = parseSlug(folded);
  if (slug) return slug;
  throw usageError(
    [`Invalid or reserved ${label}: ${raw.trim() || '(empty)'}`, '', SITE_SLUG_RULES].join('\n'),
  );
}
