import { describe, it, expect } from 'vitest';
import { renderPageHtml, buildSite } from './site-builder.js';
import type { ProjectConfig, NavConfig } from '../types.js';

// ── renderPageHtml ───────────────────────────────────────────────────

describe('renderPageHtml', () => {
  it('produces a valid HTML5 document with title, nav, and content', () => {
    const html = renderPageHtml('My Page', 'My Project', '<nav>NAV</nav>', '<p>Hello</p>', []);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>My Page — My Project</title>');
    expect(html).toContain('<nav>NAV</nav>');
    expect(html).toContain('<p>Hello</p>');
  });

  it('includes the project title in the sidebar brand', () => {
    const html = renderPageHtml('Page', 'Acme Docs', '<nav>N</nav>', '<p>C</p>', []);
    expect(html).toContain('<div class="sidebar-brand">Acme Docs</div>');
  });

  it('escapes HTML entities in the title', () => {
    const html = renderPageHtml('A <b>&</b> "test"', 'Proj', '', '', []);
    expect(html).toContain('A &lt;b&gt;&amp;&lt;/b&gt; &quot;test&quot; — Proj');
  });

  it('places nav in sidebar and content in main', () => {
    const html = renderPageHtml('T', 'P', '<nav>sidebar</nav>', '<p>body</p>', []);
    expect(html).toContain('class="sidebar-scroll"><nav>sidebar</nav>');
    expect(html).toContain('<article class="article"><p>body</p></article>');
  });

  it('renders a TOC when headings are provided', () => {
    const toc = [
      { id: 'intro', text: 'Introduction', level: 2 as const },
      { id: 'details', text: 'Details', level: 3 as const },
    ];
    const html = renderPageHtml('T', 'P', '', '', toc);
    expect(html).toContain('class="toc"');
    expect(html).toContain('On this page');
    expect(html).toContain('href="#intro"');
    expect(html).toContain('href="#details"');
    expect(html).toContain('toc-item--sub');
    expect(html).toContain('has-toc');
  });

  it('omits the TOC when no headings exist', () => {
    const html = renderPageHtml('T', 'P', '', '', []);
    expect(html).not.toContain('class="toc"');
    expect(html).not.toContain('has-toc');
  });
});

// ── buildSite ────────────────────────────────────────────────────────

const baseProjectConfig: ProjectConfig = {
  slug: 'my-project',
  title: 'My Project',
  description: 'Docs',
  publish_enabled: true,
  access_mode: 'public',
};

const baseNavConfig: NavConfig = {
  nav: [
    { label: 'Getting Started', path: 'getting-started' },
    { label: 'Guide', path: 'guide' },
  ],
};

describe('buildSite', () => {
  it('produces one artifact per page plus a root index.html redirect', () => {
    const pages = new Map([
      ['getting-started', '# Getting Started\n\nHello.'],
      ['guide', '# Guide\n\nWorld.'],
    ]);

    const artifacts = buildSite(baseProjectConfig, baseNavConfig, pages, 'my-project');

    expect(artifacts).toHaveLength(3); // 2 pages + root redirect
    const paths = artifacts.map((a) => a.path).sort();
    expect(paths).toEqual(['getting-started/index.html', 'guide/index.html', 'index.html']);
  });

  it('derives page title from nav label when no frontmatter', () => {
    const pages = new Map([
      ['getting-started', '# Hello\n\nContent.'],
      ['guide', '# World\n\nContent.'],
    ]);
    const artifacts = buildSite(baseProjectConfig, baseNavConfig, pages, 'my-project');
    const decoder = new TextDecoder();
    const html = decoder.decode(artifacts[0].content);
    // Title should come from nav label "Getting Started"
    expect(html).toContain('<title>Getting Started — My Project</title>');
  });

  it('uses frontmatter title when provided, overriding nav label', () => {
    const pages = new Map([
      ['getting-started', '---\ntitle: "Custom Title"\n---\n# Hello\n\nContent.'],
      ['guide', '# World\n\nContent.'],
    ]);
    const artifacts = buildSite(baseProjectConfig, baseNavConfig, pages, 'my-project');
    const decoder = new TextDecoder();
    const html = decoder.decode(artifacts[0].content);
    expect(html).toContain('<title>Custom Title — My Project</title>');
  });

  it('includes the project title in the sidebar brand', () => {
    const pages = new Map([
      ['getting-started', '# GS\n\nContent.'],
      ['guide', '# G\n\nContent.'],
    ]);
    const artifacts = buildSite(baseProjectConfig, baseNavConfig, pages, 'my-project');
    const decoder = new TextDecoder();
    const html = decoder.decode(artifacts[0].content);
    expect(html).toContain('<div class="sidebar-brand">My Project</div>');
  });

  it('sets contentType to text/html for every artifact', () => {
    const pages = new Map([
      ['getting-started', '# GS'],
      ['guide', '# G'],
    ]);
    const artifacts = buildSite(baseProjectConfig, baseNavConfig, pages, 'my-project');
    for (const a of artifacts) {
      expect(a.contentType).toBe('text/html; charset=utf-8');
    }
  });

  it('artifact content is a valid ArrayBuffer containing the rendered HTML', () => {
    const pages = new Map([
      ['getting-started', '# GS'],
      ['guide', '# G'],
    ]);
    const artifacts = buildSite(baseProjectConfig, baseNavConfig, pages, 'my-project');
    const decoder = new TextDecoder();
    // Check page artifacts (skip root redirect)
    const pageArtifacts = artifacts.filter((a) => a.path !== 'index.html');
    for (const a of pageArtifacts) {
      const html = decoder.decode(a.content);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<article class="article">');
    }
  });

  it('throws on slug mismatch', () => {
    const pages = new Map([
      ['getting-started', '# GS'],
      ['guide', '# G'],
    ]);
    expect(() => buildSite(baseProjectConfig, baseNavConfig, pages, 'wrong-slug')).toThrow(
      /Slug mismatch/,
    );
  });

  it('throws when nav references a missing page', () => {
    const pages = new Map([['getting-started', '# GS']]);
    expect(() => buildSite(baseProjectConfig, baseNavConfig, pages, 'my-project')).toThrow(
      /do not exist/,
    );
  });

  it('excludes hidden pages from navigation but still builds them', () => {
    const navConfig: NavConfig = {
      nav: [
        { label: 'Visible', path: 'visible' },
        { label: 'Hidden', path: 'hidden-page' },
      ],
    };
    const pages = new Map([
      ['visible', '# Visible\n\nContent.'],
      ['hidden-page', '---\nhidden: true\n---\n# Hidden\n\nSecret content.'],
    ]);

    const artifacts = buildSite(baseProjectConfig, navConfig, pages, 'my-project');

    // 2 pages + root redirect = 3
    expect(artifacts).toHaveLength(3);

    const decoder = new TextDecoder();
    const visibleArtifact = artifacts.find((a) => a.path === 'visible/index.html')!;
    const visibleHtml = decoder.decode(visibleArtifact.content);
    expect(visibleHtml).toContain('Visible');
    expect(visibleHtml).not.toContain('hidden-page');
  });
});
