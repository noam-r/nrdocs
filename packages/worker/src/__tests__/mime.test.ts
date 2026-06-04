import { describe, it, expect } from 'vitest';
import { getMimeType, getSecurityHeaders } from '../mime.js';

describe('getMimeType', () => {
  it('returns correct MIME type for .html', () => {
    expect(getMimeType('index.html')).toBe('text/html; charset=utf-8');
  });

  it('returns correct MIME type for .css', () => {
    expect(getMimeType('style.css')).toBe('text/css; charset=utf-8');
  });

  it('returns correct MIME type for .json', () => {
    expect(getMimeType('data.json')).toBe('application/json; charset=utf-8');
  });

  it('returns correct MIME type for .svg', () => {
    expect(getMimeType('icon.svg')).toBe('image/svg+xml');
  });

  it('returns correct MIME type for .png', () => {
    expect(getMimeType('image.png')).toBe('image/png');
  });

  it('returns correct MIME type for .jpg', () => {
    expect(getMimeType('photo.jpg')).toBe('image/jpeg');
  });

  it('returns correct MIME type for .jpeg', () => {
    expect(getMimeType('photo.jpeg')).toBe('image/jpeg');
  });

  it('returns correct MIME type for .gif', () => {
    expect(getMimeType('anim.gif')).toBe('image/gif');
  });

  it('returns correct MIME type for .webp', () => {
    expect(getMimeType('image.webp')).toBe('image/webp');
  });

  it('returns correct MIME type for .ico', () => {
    expect(getMimeType('favicon.ico')).toBe('image/x-icon');
  });

  it('returns correct MIME type for .txt', () => {
    expect(getMimeType('readme.txt')).toBe('text/plain; charset=utf-8');
  });

  it('returns correct MIME type for .pdf', () => {
    expect(getMimeType('doc.pdf')).toBe('application/pdf');
  });

  it('returns correct MIME type for textual schema extensions', () => {
    expect(getMimeType('openapi.yaml')).toBe('text/yaml; charset=utf-8');
    expect(getMimeType('openapi.yml')).toBe('text/yaml; charset=utf-8');
    expect(getMimeType('data.jsonp')).toBe('text/plain; charset=utf-8');
    expect(getMimeType('config.toml')).toBe('text/plain; charset=utf-8');
  });

  it('returns correct MIME type for .zip when served', () => {
    expect(getMimeType('bundle.zip')).toBe('application/zip');
  });

  it('returns correct MIME type for .js', () => {
    expect(getMimeType('_nrdocs/mermaid.min.js')).toBe('text/javascript; charset=utf-8');
    expect(getMimeType('file.js')).toBe('text/javascript; charset=utf-8');
  });

  it('returns null for unknown extensions', () => {
    expect(getMimeType('file.exe')).toBeNull();
  });

  it('returns null for files without extensions', () => {
    expect(getMimeType('Makefile')).toBeNull();
  });

  it('handles nested paths correctly', () => {
    expect(getMimeType('docs/api/index.html')).toBe('text/html; charset=utf-8');
    expect(getMimeType('assets/images/logo.png')).toBe('image/png');
  });

  it('is case-insensitive', () => {
    expect(getMimeType('FILE.HTML')).toBe('text/html; charset=utf-8');
    expect(getMimeType('IMAGE.PNG')).toBe('image/png');
  });

  it('handles paths with dots in directory names', () => {
    expect(getMimeType('v1.0/index.html')).toBe('text/html; charset=utf-8');
  });
});

describe('getSecurityHeaders', () => {
  it('always includes X-Content-Type-Options: nosniff', () => {
    expect(getSecurityHeaders('index.html')['X-Content-Type-Options']).toBe('nosniff');
    expect(getSecurityHeaders('style.css')['X-Content-Type-Options']).toBe('nosniff');
    expect(getSecurityHeaders('image.png')['X-Content-Type-Options']).toBe('nosniff');
  });

  it('adds CSP headers for SVG files', () => {
    const headers = getSecurityHeaders('icon.svg');
    expect(headers['Content-Security-Policy']).toBe(
      "script-src 'none'; object-src 'none'; base-uri 'none'",
    );
  });

  it('does not add CSP headers for non-SVG files', () => {
    expect(getSecurityHeaders('index.html')['Content-Security-Policy']).toBeUndefined();
    expect(getSecurityHeaders('style.css')['Content-Security-Policy']).toBeUndefined();
    expect(getSecurityHeaders('image.png')['Content-Security-Policy']).toBeUndefined();
  });

  it('handles nested SVG paths', () => {
    const headers = getSecurityHeaders('assets/icons/logo.svg');
    expect(headers['Content-Security-Policy']).toBe(
      "script-src 'none'; object-src 'none'; base-uri 'none'",
    );
  });
});
