import { describe, expect, it } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { AGENT_ALL_MD_MAX_BYTES } from '@nrdocs/contracts';
import { serializeArticleMarkdown } from './mdast-to-markdown.js';
import { assignHeadingFragments, markdownFragmentFromHeadingText } from './markdown-fragments.js';
import { renderArticleHtml } from './mdast-to-html.js';
import { buildAgentAllMarkdown } from './agent-docs.js';

function parse(text: string) {
  return fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

const passthrough = {
  resolvePageHref: () => null,
  resolveAssetHref: (href: string) => (href.endsWith('.png') ? href : null),
  resolveAttachmentHref: () => null,
};

describe('markdown fragments', () => {
  it('normalizes punctuation, unicode, empty, and duplicates', () => {
    expect(markdownFragmentFromHeadingText('Security Model')).toBe('security-model');
    expect(markdownFragmentFromHeadingText('Hello, World!')).toBe('hello-world');
    expect(markdownFragmentFromHeadingText('***')).toBe('section');
    expect(markdownFragmentFromHeadingText('Café')).toBe('café');
    expect(assignHeadingFragments(['A', 'A', 'B'])).toEqual(['a', 'a-2', 'b']);
  });
});

describe('normalized markdown serializer', () => {
  it('emits LF, one trailing newline, ATX, lists, tasks, tables, mermaid', () => {
    const src = [
      '# Title',
      '',
      'A **bold** and *em* and ~~del~~.',
      '',
      '- item',
      '- [x] done',
      '',
      '1. one',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '```mermaid',
      'flowchart LR',
      '  A-->B',
      '```',
      '',
    ].join('\n');
    const tree = parse(src);
    const md = serializeArticleMarkdown(tree, 'x.md', passthrough);
    const html = renderArticleHtml(tree, 'x.md', passthrough).html;
    expect(md.endsWith('\n')).toBe(true);
    expect(md.includes('\r')).toBe(false);
    expect(md).toContain('# Title');
    expect(md).toContain('- item');
    expect(md).toContain('- [x] done');
    expect(md).toContain('1. one');
    expect(md).toContain('| A | B |');
    expect(md).toContain('```mermaid');
    expect(html).toContain('<h1');
    expect(md).not.toContain('<div');
  });

  it('lengthens fences to contain backtick runs', () => {
    const tree = parse('````\n```\ncode\n```\n````\n');
    const md = serializeArticleMarkdown(tree, 'x.md', passthrough);
    expect(md.startsWith('````')).toBe(true);
  });
});

describe('agent all.md size', () => {
  it('includes all.md just under 5 MiB and omits at the exclusive limit', () => {
    const pageId = 'a'.repeat(32);
    const header = buildAgentAllMarkdown({
      siteTitle: 'S',
      pages: [{ title: 'T', humanRoute: '/', pageId, markdown: 'x' }],
    });
    expect(header).not.toBeNull();
    const overhead = header!.byteLength - 1;
    const justUnder = buildAgentAllMarkdown({
      siteTitle: 'S',
      pages: [
        {
          title: 'T',
          humanRoute: '/',
          pageId,
          markdown: 'x'.repeat(AGENT_ALL_MD_MAX_BYTES - overhead - 1),
        },
      ],
    });
    expect(justUnder).not.toBeNull();
    expect(justUnder!.byteLength).toBe(AGENT_ALL_MD_MAX_BYTES - 1);

    const exact = buildAgentAllMarkdown({
      siteTitle: 'S',
      pages: [
        {
          title: 'T',
          humanRoute: '/',
          pageId,
          markdown: 'x'.repeat(AGENT_ALL_MD_MAX_BYTES - overhead),
        },
      ],
    });
    expect(exact).not.toBeNull();
    expect(exact!.byteLength).toBe(AGENT_ALL_MD_MAX_BYTES);

    const over = buildAgentAllMarkdown({
      siteTitle: 'S',
      pages: [
        {
          title: 'T',
          humanRoute: '/',
          pageId,
          markdown: 'x'.repeat(AGENT_ALL_MD_MAX_BYTES - overhead + 1),
        },
      ],
    });
    expect(over).toBeNull();
  });
});
