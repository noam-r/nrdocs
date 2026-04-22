import { describe, it, expect } from 'vitest';
import { parseMarkdownPage } from './markdown-parser.js';

describe('parseMarkdownPage', () => {
  it('parses a page with full frontmatter', () => {
    const content = [
      '---',
      'title: "Installation Guide"',
      'order: 1',
      'section: "Guides"',
      'hidden: false',
      'template: default',
      'tags:',
      '  - setup',
      '  - quickstart',
      '---',
      '# Hello',
      '',
      'Some **bold** text.',
    ].join('\n');

    const result = parseMarkdownPage(content, 'content/install.md');

    expect(result.sourcePath).toBe('content/install.md');
    expect(result.frontmatter).toEqual({
      title: 'Installation Guide',
      order: 1,
      section: 'Guides',
      hidden: false,
      template: 'default',
      tags: ['setup', 'quickstart'],
    });
    expect(result.html).toContain('<h1');
    expect(result.html).toContain('Hello');
    expect(result.html).toContain('<strong>bold</strong>');
  });

  it('parses a page with no frontmatter at all', () => {
    const content = '# Just Markdown\n\nSome text.\n';
    const result = parseMarkdownPage(content, 'content/page.md');

    expect(result.frontmatter).toEqual({});
    expect(result.html).toContain('Just Markdown');
    expect(result.html).toContain('Some text.');
  });

  it('parses a page with partial frontmatter (title only)', () => {
    const content = '---\ntitle: "Custom Title"\n---\n# Heading\n\nBody.\n';
    const result = parseMarkdownPage(content, 'content/page.md');

    expect(result.frontmatter.title).toBe('Custom Title');
    expect(result.frontmatter.order).toBeUndefined();
    expect(result.html).toContain('Body.');
  });

  it('parses a page with only hidden flag', () => {
    const content = '---\nhidden: true\n---\n# Secret Page\n\nHidden content.\n';
    const result = parseMarkdownPage(content, 'content/secret.md');

    expect(result.frontmatter.hidden).toBe(true);
    expect(result.frontmatter.title).toBeUndefined();
  });

  it('treats unclosed frontmatter block as no frontmatter', () => {
    const content = '---\ntitle: "Oops"\n# No closing delimiter\n\nBody.\n';
    const result = parseMarkdownPage(content, 'x.md');

    expect(result.frontmatter).toEqual({});
    // The entire content including the --- is treated as markdown body
    expect(result.html).toContain('No closing delimiter');
  });

  it('throws when hidden is not a boolean', () => {
    const content = '---\nhidden: "yes"\n---\nbody\n';
    expect(() => parseMarkdownPage(content, 'x.md')).toThrow('"hidden" must be a boolean');
  });

  it('throws when tags is not an array of strings', () => {
    const content = '---\ntags: "oops"\n---\nbody\n';
    expect(() => parseMarkdownPage(content, 'x.md')).toThrow('"tags" must be an array of strings');
  });

  it('extracts h2 and h3 headings into toc with ids', () => {
    const content = '# Title\n\n## Introduction\n\nText.\n\n### Details\n\nMore text.\n\n## Conclusion\n';
    const result = parseMarkdownPage(content, 'x.md');

    expect(result.toc).toHaveLength(3);
    expect(result.toc[0]).toEqual({ id: 'introduction', text: 'Introduction', level: 2 });
    expect(result.toc[1]).toEqual({ id: 'details', text: 'Details', level: 3 });
    expect(result.toc[2]).toEqual({ id: 'conclusion', text: 'Conclusion', level: 2 });

    expect(result.html).toContain('id="introduction"');
    expect(result.html).toContain('id="details"');
    expect(result.html).toContain('id="conclusion"');
  });

  it('does not include h1 in toc', () => {
    const content = '# Big Title\n\nBody.\n';
    const result = parseMarkdownPage(content, 'x.md');
    expect(result.toc).toHaveLength(0);
  });

  it('handles duplicate heading text with incremented ids', () => {
    const content = '## Setup\n\n## Setup\n\n## Setup\n';
    const result = parseMarkdownPage(content, 'x.md');
    expect(result.toc[0].id).toBe('setup');
    expect(result.toc[1].id).toBe('setup-1');
    expect(result.toc[2].id).toBe('setup-2');
  });

  it('returns empty toc when page has no h2/h3', () => {
    const content = 'Just a paragraph.\n';
    const result = parseMarkdownPage(content, 'x.md');
    expect(result.toc).toEqual([]);
  });
});
