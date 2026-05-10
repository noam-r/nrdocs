/**
 * Link rewriting for rendered HTML.
 * Rewrites internal .md links to clean URLs and adds security attributes to external links.
 */

/**
 * Rewrites links in rendered HTML:
 * - Internal .md links → clean canonical URLs under /owner/repo/
 * - External links get rel="noopener noreferrer"
 */
export function rewriteLinks(html: string, basePath: string, owner: string, repo: string): string {
  // Match <a href="..."> tags
  return html.replace(/<a\s+([^>]*?)href="([^"]*)"([^>]*?)>/g, (_match, before: string, href: string, after: string) => {
    // Check if it's an external link
    if (isExternalLink(href)) {
      // Add rel="noopener noreferrer" if not already present
      const existingAttrs = before + after;
      if (!existingAttrs.includes('rel=')) {
        return `<a ${before}href="${href}"${after} rel="noopener noreferrer">`;
      }
      return `<a ${before}href="${href}"${after}>`;
    }

    // Check if it's an internal .md link
    if (href.endsWith('.md') || href.includes('.md#')) {
      const rewritten = rewriteMdLink(href, basePath, owner, repo);
      return `<a ${before}href="${rewritten}"${after}>`;
    }

    // Site-root paths like /assets/logo.png → /owner/repo/assets/logo.png
    if (href.startsWith('/') && !href.startsWith(`/${owner}/${repo}`)) {
      const rewritten = `/${owner}/${repo}${href}`;
      return `<a ${before}href="${rewritten}"${after}>`;
    }

    return `<a ${before}href="${href}"${after}>`;
  });
}

/**
 * Determines if a URL is external (starts with http:// or https://).
 */
function isExternalLink(href: string): boolean {
  return href.startsWith('http://') || href.startsWith('https://');
}

/**
 * Rewrites a .md link to a clean URL.
 * e.g. "./getting-started.md" → "/owner/repo/getting-started/"
 *      "../guide.md" → "/owner/repo/guide/"
 *      "intro.md#section" → "/owner/repo/intro/#section"
 */
function rewriteMdLink(href: string, basePath: string, owner: string, repo: string): string {
  // Split off fragment
  let fragment = '';
  let linkPath = href;
  const hashIdx = linkPath.indexOf('#');
  if (hashIdx !== -1) {
    fragment = linkPath.slice(hashIdx);
    linkPath = linkPath.slice(0, hashIdx);
  }

  // Remove .md extension
  linkPath = linkPath.replace(/\.md$/, '');

  // Resolve relative paths
  // basePath is the directory of the current file relative to docs root
  const parts = [...basePath.split('/').filter(Boolean), ...linkPath.split('/')];
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  const cleanPath = resolved.join('/');
  const prefix = `/${owner}/${repo}`;

  if (cleanPath === 'index' || cleanPath === '') {
    return `${prefix}/${fragment}`;
  }

  return `${prefix}/${cleanPath}/${fragment}`;
}
