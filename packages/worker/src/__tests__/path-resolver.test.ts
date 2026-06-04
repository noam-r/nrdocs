import { describe, it, expect } from 'vitest';
import { resolveServingPath, isReservedPath } from '../path-resolver.js';

describe('resolveServingPath', () => {
  const owner = 'acme';
  const repo = 'docs';

  describe('canonical redirects', () => {
    it('redirects /owner/repo to /owner/repo/', () => {
      const result = resolveServingPath('/acme/docs', owner, repo);
      expect(result).toEqual({ type: 'redirect', location: '/acme/docs/' });
    });

    it('redirects /owner/repo/page.html to /owner/repo/page/', () => {
      const result = resolveServingPath('/acme/docs/page.html', owner, repo);
      expect(result).toEqual({ type: 'redirect', location: '/acme/docs/page/' });
    });

    it('redirects /owner/repo/index.html to /owner/repo/', () => {
      const result = resolveServingPath('/acme/docs/index.html', owner, repo);
      expect(result).toEqual({ type: 'redirect', location: '/acme/docs/' });
    });

    it('redirects /owner/repo/page/index.html to /owner/repo/page/', () => {
      const result = resolveServingPath('/acme/docs/page/index.html', owner, repo);
      expect(result).toEqual({ type: 'redirect', location: '/acme/docs/page/' });
    });

    it('redirects /owner/repo/page to /owner/repo/page/', () => {
      const result = resolveServingPath('/acme/docs/page', owner, repo);
      expect(result).toEqual({ type: 'redirect', location: '/acme/docs/page/' });
    });

    it('redirects /owner/repo/nested/page to /owner/repo/nested/page/', () => {
      const result = resolveServingPath('/acme/docs/nested/page', owner, repo);
      expect(result).toEqual({ type: 'redirect', location: '/acme/docs/nested/page/' });
    });

    it('redirects /owner/repo/nested/page.html to /owner/repo/nested/page/', () => {
      const result = resolveServingPath('/acme/docs/nested/page.html', owner, repo);
      expect(result).toEqual({ type: 'redirect', location: '/acme/docs/nested/page/' });
    });
  });

  describe('serving paths', () => {
    it('serves index.html for /owner/repo/', () => {
      const result = resolveServingPath('/acme/docs/', owner, repo);
      expect(result).toEqual({ type: 'serve', filePath: 'index.html' });
    });

    it('serves page/index.html for /owner/repo/page/', () => {
      const result = resolveServingPath('/acme/docs/page/', owner, repo);
      expect(result).toEqual({ type: 'serve', filePath: 'page/index.html' });
    });

    it('serves nested/page/index.html for /owner/repo/nested/page/', () => {
      const result = resolveServingPath('/acme/docs/nested/page/', owner, repo);
      expect(result).toEqual({ type: 'serve', filePath: 'nested/page/index.html' });
    });
  });

  describe('asset paths (no redirect)', () => {
    it('serves CSS files directly', () => {
      const result = resolveServingPath('/acme/docs/assets/style.css', owner, repo);
      expect(result).toEqual({ type: 'serve', filePath: 'assets/style.css' });
    });

    it('serves PNG files directly', () => {
      const result = resolveServingPath('/acme/docs/images/logo.png', owner, repo);
      expect(result).toEqual({ type: 'serve', filePath: 'images/logo.png' });
    });

    it('serves SVG files directly', () => {
      const result = resolveServingPath('/acme/docs/icons/arrow.svg', owner, repo);
      expect(result).toEqual({ type: 'serve', filePath: 'icons/arrow.svg' });
    });

    it('serves JSON files directly', () => {
      const result = resolveServingPath('/acme/docs/data/config.json', owner, repo);
      expect(result).toEqual({ type: 'serve', filePath: 'data/config.json' });
    });

    it('serves PDF files directly', () => {
      const result = resolveServingPath('/acme/docs/files/manual.pdf', owner, repo);
      expect(result).toEqual({ type: 'serve', filePath: 'files/manual.pdf' });
    });

    it('serves ICO files directly', () => {
      const result = resolveServingPath('/acme/docs/favicon.ico', owner, repo);
      expect(result).toEqual({ type: 'serve', filePath: 'favicon.ico' });
    });

    it('serves JPEG files directly', () => {
      const result = resolveServingPath('/acme/docs/photo.jpg', owner, repo);
      expect(result).toEqual({ type: 'serve', filePath: 'photo.jpg' });
    });

    it('serves WebP files directly', () => {
      const result = resolveServingPath('/acme/docs/image.webp', owner, repo);
      expect(result).toEqual({ type: 'serve', filePath: 'image.webp' });
    });

    it('serves TXT files directly', () => {
      const result = resolveServingPath('/acme/docs/readme.txt', owner, repo);
      expect(result).toEqual({ type: 'serve', filePath: 'readme.txt' });
    });

    it('serves platform mermaid runtime directly', () => {
      const result = resolveServingPath('/acme/docs/_nrdocs/mermaid.min.js', owner, repo);
      expect(result).toEqual({ type: 'serve', filePath: '_nrdocs/mermaid.min.js' });
    });

    it('serves platform runtime even with trailing slash', () => {
      const result = resolveServingPath('/acme/docs/_nrdocs/mermaid.min.js/', owner, repo);
      expect(result).toEqual({ type: 'serve', filePath: '_nrdocs/mermaid.min.js' });
    });

    it('does not serve repo .js as asset', () => {
      const result = resolveServingPath('/acme/docs/assets/app.js', owner, repo);
      expect(result).toEqual({ type: 'redirect', location: '/acme/docs/assets/app.js/' });
    });
  });

  describe('edge cases', () => {
    it('returns not_found for paths not matching the prefix', () => {
      const result = resolveServingPath('/other/repo/', owner, repo);
      expect(result).toEqual({ type: 'not_found' });
    });

    it('serves paths with non-html extensions as static assets', () => {
      const result = resolveServingPath('/acme/docs/file.xyz', owner, repo);
      expect(result).toEqual({ type: 'serve', filePath: 'file.xyz' });
    });
  });
});

describe('isReservedPath', () => {
  it('detects /api/ paths as reserved', () => {
    expect(isReservedPath('/api/status')).toBe(true);
    expect(isReservedPath('/api/repos')).toBe(true);
    expect(isReservedPath('/api/')).toBe(true);
  });

  it('detects /_nrdocs/ paths as reserved', () => {
    expect(isReservedPath('/_nrdocs/login')).toBe(true);
    expect(isReservedPath('/_nrdocs/')).toBe(true);
  });

  it('detects /favicon.ico as reserved', () => {
    expect(isReservedPath('/favicon.ico')).toBe(true);
  });

  it('detects /robots.txt as reserved', () => {
    expect(isReservedPath('/robots.txt')).toBe(true);
  });

  it('detects /.well-known/ paths as reserved', () => {
    expect(isReservedPath('/.well-known/security.txt')).toBe(true);
  });

  it('does not flag normal repo paths as reserved', () => {
    expect(isReservedPath('/acme/docs/')).toBe(false);
    expect(isReservedPath('/owner/repo/page/')).toBe(false);
  });

  it('does not flag paths that start with api but are not /api/', () => {
    expect(isReservedPath('/apiary/docs/')).toBe(false);
  });
});
