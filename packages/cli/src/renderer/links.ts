/**
 * Link rewriting for rendered HTML.
 * Rewrites internal .md links to clean URLs and adds security attributes to external links.
 * Rewrites image src attributes to resolve relative paths and add the site prefix.
 */

/**
 * Rewrites links and images in rendered HTML:
 * - Internal .md links → clean canonical URLs under /owner/repo/
 * - External links get rel="noopener noreferrer"
 * - Image src paths prefixed with /owner/repo/ when site-root or resolved from relative
 */
export function rewriteLinks(html: string, basePath: string, owner: string, repo: string): string {
  // Rewrite <a href="..."> tags
  let result = html.replace(/<a\s+([^>]*?)href="([^"]*)"([^>]*?)>/g, (_match, before: string, href: string, after: string) => {
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

  // Rewrite <img src="..."> tags
  result = rewriteImageSrc(result, basePath, owner, repo);

  return result;
}

/**
 * Rewrites img src attributes so that:
 * - Absolute paths like /assets/foo.png → /owner/repo/assets/foo.png
 * - Relative paths like assets/foo.png or ./assets/foo.png → /owner/repo/{basePath}/assets/foo.png
 * - External URLs (http/https) are left untouched
 */
function rewriteImageSrc(html: string, basePath: string, owner: string, repo: string): string {
  return html.replace(/<img\s+([^>]*?)src="([^"]*)"([^>]*?)\/?>/g, (match, before: string, src: string, after: string) => {
    if (isExternalLink(src)) {
      return match;
    }

    const prefix = `/${owner}/${repo}`;

    // Absolute site-root path: /assets/foo.png → /owner/repo/assets/foo.png
    if (src.startsWith('/')) {
      if (src.startsWith(`${prefix}/`)) {
        return match; // already prefixed
      }
      const rewritten = `${prefix}${src}`;
      return `<img ${before}src="${rewritten}"${after}>`;
    }

    // Relative path: resolve against basePath then prefix
    const resolved = resolveRelativePath(src, basePath);
    const rewritten = `${prefix}/${resolved}`;
    return `<img ${before}src="${rewritten}"${after}>`;
  });
}

/**
 * Determines if a URL is external (starts with http:// or https://).
 */
function isExternalLink(href: string): boolean {
  return href.startsWith('http://') || href.startsWith('https://');
}

/**
 * Resolves a relative path against a base directory path.
 * e.g. resolveRelativePath("./images/foo.png", "guides") → "guides/images/foo.png"
 *      resolveRelativePath("../assets/bar.png", "guides/sub") → "guides/assets/bar.png"
 *      resolveRelativePath("assets/foo.png", "") → "assets/foo.png"
 */
function resolveRelativePath(relativeSrc: string, basePath: string): string {
  const parts = [...basePath.split('/').filter(Boolean), ...relativeSrc.split('/')];
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join('/');
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
