import { describe, it, expect } from 'vitest';
import { validateNavReferences, generateNavHtml } from './nav-generator.js';
import type { NavConfig } from '../types.js';

const sampleNav: NavConfig = {
  nav: [
    { label: 'Getting Started', path: 'getting-started' },
    {
      label: 'Guides',
      section: true,
      children: [
        { label: 'Installation', path: 'guides/installation' },
        { label: 'Configuration', path: 'guides/configuration' },
      ],
    },
    { label: 'API Reference', path: 'api-reference' },
  ],
};

describe('validateNavReferences', () => {
  it('does not throw when all referenced pages exist', () => {
    const pages = new Set([
      'getting-started',
      'guides/installation',
      'guides/configuration',
      'api-reference',
    ]);
    expect(() => validateNavReferences(sampleNav, pages)).not.toThrow();
  });

  it('throws listing all missing pages', () => {
    const pages = new Set(['getting-started']);
    expect(() => validateNavReferences(sampleNav, pages)).toThrow(
      'guides/installation, guides/configuration, api-reference',
    );
  });

  it('throws for a single missing page', () => {
    const pages = new Set([
      'getting-started',
      'guides/installation',
      'guides/configuration',
    ]);
    expect(() => validateNavReferences(sampleNav, pages)).toThrow('api-reference');
  });
});

describe('generateNavHtml', () => {
  const noHidden = new Set<string>();

  it('generates a <nav> with nested <ul>/<li> structure', () => {
    const html = generateNavHtml(sampleNav, noHidden, 'getting-started');
    expect(html).toContain('<nav>');
    expect(html).toContain('</nav>');
    expect(html).toContain('Getting Started</a>');
    expect(html).toContain('Installation</a>');
    expect(html).toContain('API Reference</a>');
  });

  it('generates relative links from a top-level page', () => {
    const html = generateNavHtml(sampleNav, noHidden, 'getting-started');
    // From getting-started/index.html, one level up then into target
    expect(html).toContain('href="../getting-started/index.html"');
    expect(html).toContain('href="../guides/installation/index.html"');
    expect(html).toContain('href="../api-reference/index.html"');
  });

  it('generates relative links from a nested page', () => {
    const html = generateNavHtml(sampleNav, noHidden, 'guides/installation');
    // From guides/installation/index.html, two levels up then into target
    expect(html).toContain('href="../../getting-started/index.html"');
    expect(html).toContain('href="../../guides/installation/index.html"');
    expect(html).toContain('href="../../api-reference/index.html"');
  });

  it('falls back to root-relative links when no currentPath', () => {
    const html = generateNavHtml(sampleNav, noHidden);
    expect(html).toContain('href="/getting-started/"');
    expect(html).toContain('href="/guides/installation/"');
  });

  it('renders section items as a heading with nested list', () => {
    const html = generateNavHtml(sampleNav, noHidden, 'getting-started');
    expect(html).toContain('<span>Guides</span>');
    expect(html).toContain('<ul><li><a href="../guides/installation/index.html"');
  });

  it('excludes hidden pages from navigation', () => {
    const hidden = new Set(['guides/installation']);
    const html = generateNavHtml(sampleNav, hidden, 'getting-started');
    expect(html).not.toContain('Installation');
    expect(html).toContain('Configuration');
  });

  it('omits section entirely when all children are hidden', () => {
    const hidden = new Set(['guides/installation', 'guides/configuration']);
    const html = generateNavHtml(sampleNav, hidden, 'getting-started');
    expect(html).not.toContain('Guides');
  });

  it('marks current page with aria-current="page"', () => {
    const html = generateNavHtml(sampleNav, noHidden, 'getting-started');
    expect(html).toContain('aria-current="page">Getting Started</a>');
    expect(html).not.toContain('api-reference/" aria-current');
  });

  it('escapes HTML in labels', () => {
    const nav: NavConfig = {
      nav: [{ label: '<script>alert("xss")</script>', path: 'test' }],
    };
    const html = generateNavHtml(nav, noHidden, 'test');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
