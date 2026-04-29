const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

/**
 * Validate a project slug.
 * Valid: non-empty, lowercase alphanumeric + hyphens, cannot start/end with hyphen.
 */
export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

/**
 * Infer a slug from a repository name.
 * Lowercases, replaces non-alphanumeric chars with hyphens, collapses consecutive hyphens,
 * trims leading/trailing hyphens.
 */
export function inferSlug(repoName: string): string {
  return repoName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Infer a title from a repository name.
 * Replaces hyphens/underscores with spaces, title-cases each word.
 */
export function inferTitle(repoName: string): string {
  return repoName
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
