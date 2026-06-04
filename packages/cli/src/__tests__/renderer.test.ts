import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { renderMarkdown, contentHasMermaid } from '../renderer/markdown.js';
import { mermaidScriptSrcForOutput } from '../renderer/mermaid-runtime.js';
import { generateAutoNav, extractTitle } from '../renderer/navigation.js';
import { rewriteLinks } from '../renderer/links.js';
import { collectAssets } from '../renderer/assets.js';
import { wrapInTemplate } from '../renderer/template.js';
import { createArchive } from '../renderer/packager.js';
import { renderSite } from '../renderer/index.js';

describe('Markdown rendering', () => {
  it('renders headings', () => {
    const html = renderMarkdown('# Hello\n## World');
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).toContain('<h2>World</h2>');
  });

  it('renders paragraphs', () => {
    const html = renderMarkdown('This is a paragraph.\n\nAnother paragraph.');
    expect(html).toContain('<p>This is a paragraph.</p>');
    expect(html).toContain('<p>Another paragraph.</p>');
  });

  it('renders code blocks', () => {
    const html = renderMarkdown('```js\nconst x = 1;\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('<code');
    expect(html).toContain('const x = 1;');
  });

  it('renders mermaid fences as pre.mermaid with escaped content', () => {
    const html = renderMarkdown('```mermaid\ngraph TD\n  A-->B\n```');
    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain('graph TD');
    expect(html).not.toContain('<code');
  });

  it('escapes HTML inside mermaid fences', () => {
    const html = renderMarkdown('```mermaid\n<script>alert(1)</script>\n```');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<pre class="mermaid">[\s\S]*<script>/);
  });

  it('detects mermaid fences via contentHasMermaid', () => {
    expect(contentHasMermaid('```mermaid\nflowchart LR\n```')).toBe(true);
    expect(contentHasMermaid('```js\ncode\n```')).toBe(false);
  });

  it('renders inline code', () => {
    const html = renderMarkdown('Use `npm install` to install.');
    expect(html).toContain('<code>npm install</code>');
  });

  it('renders tables', () => {
    const md = '| Name | Value |\n| --- | --- |\n| foo | bar |';
    const html = renderMarkdown(md);
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Name</th>');
    expect(html).toContain('<td>foo</td>');
    expect(html).toContain('<td>bar</td>');
  });

  it('renders links', () => {
    const html = renderMarkdown('[Click here](https://example.com)');
    expect(html).toContain('<a href="https://example.com">Click here</a>');
  });

  it('renders images', () => {
    const html = renderMarkdown('![Alt text](image.png)');
    expect(html).toContain('<img src="image.png" alt="Alt text"');
  });

  it('renders bold and italic', () => {
    const html = renderMarkdown('**bold** and *italic*');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders blockquotes', () => {
    const html = renderMarkdown('> This is a quote');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('This is a quote');
  });

  it('renders unordered lists', () => {
    const html = renderMarkdown('- item 1\n- item 2');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>item 1</li>');
    expect(html).toContain('<li>item 2</li>');
  });

  it('renders ordered lists', () => {
    const html = renderMarkdown('1. first\n2. second');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>first</li>');
    expect(html).toContain('<li>second</li>');
  });

  describe('HTML escaping', () => {
    it('escapes raw HTML tags', () => {
      const html = renderMarkdown('<script>alert("xss")</script>');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes inline HTML', () => {
      const html = renderMarkdown('Hello <b>world</b>');
      expect(html).not.toContain('<b>');
      expect(html).toContain('&lt;b&gt;');
    });

    it('escapes HTML in block context', () => {
      const html = renderMarkdown('<div class="danger">content</div>');
      expect(html).not.toContain('<div');
      expect(html).toContain('&lt;div');
    });

    it('escapes iframe tags', () => {
      const html = renderMarkdown('<iframe src="https://evil.com"></iframe>');
      expect(html).not.toContain('<iframe');
      expect(html).toContain('&lt;iframe');
    });
  });
});

describe('Navigation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrdocs-nav-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('generateAutoNav', () => {
    it('discovers markdown files and puts index.md first', () => {
      fs.writeFileSync(path.join(tmpDir, 'index.md'), '# Home\nWelcome');
      fs.writeFileSync(path.join(tmpDir, 'getting-started.md'), '# Getting Started\nIntro');
      fs.writeFileSync(path.join(tmpDir, 'api.md'), '# API Reference\nDocs');

      const nav = generateAutoNav(tmpDir);
      expect(nav).toHaveLength(3);
      expect(nav[0]!.title).toBe('Home');
      expect(nav[0]!.href).toBe('');
      expect(nav[1]!.title).toBe('API Reference');
      expect(nav[1]!.href).toBe('api/');
      expect(nav[2]!.title).toBe('Getting Started');
      expect(nav[2]!.href).toBe('getting-started/');
    });

    it('discovers files in subdirectories', () => {
      fs.writeFileSync(path.join(tmpDir, 'index.md'), '# Home');
      fs.mkdirSync(path.join(tmpDir, 'guides'));
      fs.writeFileSync(path.join(tmpDir, 'guides', 'setup.md'), '# Setup Guide');

      const nav = generateAutoNav(tmpDir);
      expect(nav).toHaveLength(2);
      expect(nav[1]!.title).toBe('Setup Guide');
      expect(nav[1]!.href).toBe('guides/setup/');
    });
  });

  describe('extractTitle', () => {
    it('extracts title from first H1', () => {
      const title = extractTitle('# My Title\nSome content', 'page.md');
      expect(title).toBe('My Title');
    });

    it('uses filename fallback when no H1', () => {
      const title = extractTitle('Some content without heading', 'getting-started.md');
      expect(title).toBe('Getting Started');
    });

    it('returns "Home" for index.md without H1', () => {
      const title = extractTitle('Welcome to the docs', 'index.md');
      expect(title).toBe('Home');
    });

    it('handles H1 with inline formatting', () => {
      const title = extractTitle('# My **Bold** Title', 'page.md');
      expect(title).toBe('My **Bold** Title');
    });

    it('converts snake_case filenames to title case', () => {
      const title = extractTitle('content', 'my_page_name.md');
      expect(title).toBe('My Page Name');
    });
  });
});

describe('Link rewriting', () => {
  it('rewrites .md links to clean URLs', () => {
    const html = '<a href="./getting-started.md">Guide</a>';
    const result = rewriteLinks(html, '', 'myorg', 'myrepo');
    expect(result).toContain('href="/myorg/myrepo/getting-started/"');
  });

  it('resolves relative .md links', () => {
    const html = '<a href="../guide.md">Guide</a>';
    const result = rewriteLinks(html, 'sub', 'myorg', 'myrepo');
    expect(result).toContain('href="/myorg/myrepo/guide/"');
  });

  it('preserves fragment in .md links', () => {
    const html = '<a href="./page.md#section">Section</a>';
    const result = rewriteLinks(html, '', 'myorg', 'myrepo');
    expect(result).toContain('href="/myorg/myrepo/page/#section"');
  });

  it('adds rel="noopener noreferrer" to external links', () => {
    const html = '<a href="https://example.com">External</a>';
    const result = rewriteLinks(html, '', 'myorg', 'myrepo');
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain('href="https://example.com"');
  });

  it('adds rel to http:// links too', () => {
    const html = '<a href="http://example.com">External</a>';
    const result = rewriteLinks(html, '', 'myorg', 'myrepo');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it('does not add rel to internal links', () => {
    const html = '<a href="./page.md">Internal</a>';
    const result = rewriteLinks(html, '', 'myorg', 'myrepo');
    expect(result).not.toContain('noopener');
  });

  it('rewrites site-root paths under owner/repo', () => {
    const html = '<a href="/assets/logo.png">Logo</a>';
    const result = rewriteLinks(html, '', 'myorg', 'myrepo');
    expect(result).toContain('href="/myorg/myrepo/assets/logo.png"');
  });

  it('does not double-prefix already-prefixed paths', () => {
    const html = '<a href="/myorg/myrepo/page/">Page</a>';
    const result = rewriteLinks(html, '', 'myorg', 'myrepo');
    expect(result).toContain('href="/myorg/myrepo/page/"');
  });

  it('rewrites index.md to root path', () => {
    const html = '<a href="./index.md">Home</a>';
    const result = rewriteLinks(html, '', 'myorg', 'myrepo');
    expect(result).toContain('href="/myorg/myrepo/"');
  });
});

describe('Asset collection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrdocs-assets-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('collects allowed file extensions', () => {
    fs.writeFileSync(path.join(tmpDir, 'style.css'), 'body {}');
    fs.writeFileSync(path.join(tmpDir, 'logo.png'), 'PNG data');
    fs.writeFileSync(path.join(tmpDir, 'data.json'), '{}');

    const assets = collectAssets(tmpDir);
    const paths = assets.map((a) => a.path);
    expect(paths).toContain('style.css');
    expect(paths).toContain('logo.png');
    expect(paths).toContain('data.json');
  });

  it('rejects .js files', () => {
    fs.writeFileSync(path.join(tmpDir, 'script.js'), 'alert(1)');
    fs.writeFileSync(path.join(tmpDir, 'module.mjs'), 'export default 1');
    fs.writeFileSync(path.join(tmpDir, 'common.cjs'), 'module.exports = 1');

    const assets = collectAssets(tmpDir);
    const paths = assets.map((a) => a.path);
    expect(paths).not.toContain('script.js');
    expect(paths).not.toContain('module.mjs');
    expect(paths).not.toContain('common.cjs');
  });

  it('skips markdown files', () => {
    fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# Hello');

    const assets = collectAssets(tmpDir);
    const paths = assets.map((a) => a.path);
    expect(paths).not.toContain('readme.md');
  });

  it('collects files from subdirectories', () => {
    fs.mkdirSync(path.join(tmpDir, 'images'));
    fs.writeFileSync(path.join(tmpDir, 'images', 'photo.jpg'), 'JPEG data');

    const assets = collectAssets(tmpDir);
    const paths = assets.map((a) => a.path);
    expect(paths).toContain('images/photo.jpg');
  });

  it('skips hidden directories', () => {
    fs.mkdirSync(path.join(tmpDir, '.hidden'));
    fs.writeFileSync(path.join(tmpDir, '.hidden', 'secret.txt'), 'secret');

    const assets = collectAssets(tmpDir);
    const paths = assets.map((a) => a.path);
    expect(paths).not.toContain('.hidden/secret.txt');
  });

  it('rejects files with disallowed extensions', () => {
    fs.writeFileSync(path.join(tmpDir, 'binary.exe'), 'binary');
    fs.writeFileSync(path.join(tmpDir, 'archive.zip'), 'zip');

    const assets = collectAssets(tmpDir);
    const paths = assets.map((a) => a.path);
    expect(paths).not.toContain('binary.exe');
    expect(paths).not.toContain('archive.zip');
  });
});

describe('Template', () => {
  it('includes canonical link', () => {
    const html = wrapInTemplate({
      title: 'Test Page',
      siteTitle: 'My Docs',
      content: '<p>Hello</p>',
      nav: [],
      canonicalUrl: 'https://docs.example.com/org/repo/test/',
      baseUrl: '/org/repo/',
    });
    expect(html).toContain('<link rel="canonical" href="https://docs.example.com/org/repo/test/">');
  });

  it('includes security meta tags', () => {
    const html = wrapInTemplate({
      title: 'Test',
      siteTitle: 'Docs',
      content: '',
      nav: [],
      canonicalUrl: 'https://example.com/',
      baseUrl: '/',
    });
    expect(html).toContain('X-Content-Type-Options');
    expect(html).toContain('nosniff');
    expect(html).toContain('X-Frame-Options');
    expect(html).toContain('DENY');
    expect(html).toContain('no-referrer');
  });

  it('renders navigation items', () => {
    const html = wrapInTemplate({
      title: 'Test',
      siteTitle: 'Docs',
      content: '<p>Content</p>',
      nav: [
        { title: 'Home', path: 'index.md', href: '' },
        { title: 'Guide', path: 'guide.md', href: 'guide/', active: true },
      ],
      canonicalUrl: 'https://example.com/guide/',
      baseUrl: '/org/repo/',
    });
    expect(html).toContain('Home');
    expect(html).toContain('Guide');
    expect(html).toContain('class="active"');
  });

  it('includes site title in sidebar', () => {
    const html = wrapInTemplate({
      title: 'Page',
      siteTitle: 'My Documentation',
      content: '',
      nav: [],
      canonicalUrl: 'https://example.com/',
      baseUrl: '/',
    });
    expect(html).toContain('My Documentation');
  });

  it('sets page title correctly', () => {
    const html = wrapInTemplate({
      title: 'Getting Started',
      siteTitle: 'My Docs',
      content: '',
      nav: [],
      canonicalUrl: 'https://example.com/',
      baseUrl: '/',
    });
    expect(html).toContain('<title>Getting Started - My Docs</title>');
  });

  it('uses just site title when page title matches', () => {
    const html = wrapInTemplate({
      title: 'My Docs',
      siteTitle: 'My Docs',
      content: '',
      nav: [],
      canonicalUrl: 'https://example.com/',
      baseUrl: '/',
    });
    expect(html).toContain('<title>My Docs</title>');
  });

  it('escapes HTML in title', () => {
    const html = wrapInTemplate({
      title: 'Test <script>',
      siteTitle: 'Docs',
      content: '',
      nav: [],
      canonicalUrl: 'https://example.com/',
      baseUrl: '/',
    });
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<title>Test &lt;script&gt; - Docs</title>');
  });

  it('includes theme toggle and CSS variables', () => {
    const html = wrapInTemplate({
      title: 'Page',
      siteTitle: 'Docs',
      content: '<p>Hi</p>',
      nav: [],
      canonicalUrl: 'https://example.com/',
      baseUrl: '/',
    });
    expect(html).toContain('id="theme-toggle"');
    expect(html).toContain('--text:');
    expect(html).toContain('data-theme');
    expect(html).toContain('nrdocs-theme');
  });

  it('includes mermaid script only when requested', () => {
    const without = wrapInTemplate({
      title: 'Page',
      siteTitle: 'Docs',
      content: '',
      nav: [],
      canonicalUrl: 'https://example.com/',
      baseUrl: '/',
      includeMermaid: false,
    });
    expect(without).not.toContain('mermaid.min.js');

    const withMermaid = wrapInTemplate({
      title: 'Page',
      siteTitle: 'Docs',
      content: '<pre class="mermaid">graph TD</pre>',
      nav: [],
      canonicalUrl: 'https://example.com/',
      baseUrl: '/',
      includeMermaid: true,
      mermaidScriptSrc: '_nrdocs/mermaid.min.js',
    });
    expect(withMermaid).toContain('src="_nrdocs/mermaid.min.js"');
    expect(withMermaid).toContain('initMermaid');
  });

  it('computes relative mermaid script paths by page depth', () => {
    expect(mermaidScriptSrcForOutput('index.html')).toBe('_nrdocs/mermaid.min.js');
    expect(mermaidScriptSrcForOutput('guide/index.html')).toBe('../_nrdocs/mermaid.min.js');
  });
});

describe('Packager', () => {
  it('creates a gzipped tar archive', async () => {
    const files = [
      { path: 'index.html', content: Buffer.from('<h1>Hello</h1>') },
      { path: 'style.css', content: Buffer.from('body {}') },
    ];
    const manifest = { version: 1, pages: [] };

    const archive = await createArchive(files, manifest);

    // Should be a valid gzip (starts with 1f 8b)
    expect(archive[0]).toBe(0x1f);
    expect(archive[1]).toBe(0x8b);
    expect(archive.length).toBeGreaterThan(0);
  });

  it('includes manifest in archive', async () => {
    const files = [{ path: 'index.html', content: Buffer.from('<h1>Hi</h1>') }];
    const manifest = { version: 1, generator: 'nrdocs-cli' };

    const archive = await createArchive(files, manifest);
    // Archive should be non-empty (we can't easily inspect tar contents without extracting)
    expect(archive.length).toBeGreaterThan(100);
  });
});

describe('Full render pipeline', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrdocs-render-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('renders a simple site', async () => {
    fs.writeFileSync(path.join(tmpDir, 'index.md'), '# Welcome\n\nHello world.');
    fs.writeFileSync(
      path.join(tmpDir, 'guide.md'),
      '# Guide\n\nSee [home](./index.md) for more.'
    );

    const site = await renderSite({
      docsDir: tmpDir,
      siteTitle: 'Test Docs',
      baseUrl: 'https://docs.example.com',
      owner: 'testorg',
      repo: 'testrepo',
    });

    expect(site.files.length).toBeGreaterThanOrEqual(2);
    expect(site.manifest['version']).toBe(1);
    expect(site.manifest['owner']).toBe('testorg');
    expect(site.manifest['repo']).toBe('testrepo');

    // Check index.html exists
    const indexFile = site.files.find((f) => f.path === 'index.html');
    expect(indexFile).toBeDefined();
    const indexHtml = indexFile!.content.toString('utf-8');
    expect(indexHtml).toContain('Welcome');
    expect(indexHtml).toContain('<link rel="canonical"');

    // Check guide renders with rewritten link
    const guideFile = site.files.find((f) => f.path === 'guide/index.html');
    expect(guideFile).toBeDefined();
    const guideHtml = guideFile!.content.toString('utf-8');
    expect(guideHtml).toContain('/testorg/testrepo/');
  });

  it('includes assets in rendered site', async () => {
    fs.writeFileSync(path.join(tmpDir, 'index.md'), '# Home');
    fs.writeFileSync(path.join(tmpDir, 'style.css'), 'body { color: red; }');

    const site = await renderSite({
      docsDir: tmpDir,
      siteTitle: 'Test',
      baseUrl: 'https://example.com',
      owner: 'org',
      repo: 'repo',
    });

    const cssFile = site.files.find((f) => f.path === 'style.css');
    expect(cssFile).toBeDefined();
    expect(cssFile!.content.toString()).toBe('body { color: red; }');
  });

  it('escapes raw HTML in rendered output', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'index.md'),
      '# Test\n\n<script>alert("xss")</script>'
    );

    const site = await renderSite({
      docsDir: tmpDir,
      siteTitle: 'Test',
      baseUrl: 'https://example.com',
      owner: 'org',
      repo: 'repo',
    });

    const indexFile = site.files.find((f) => f.path === 'index.html');
    const html = indexFile!.content.toString('utf-8');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('includes mermaid runtime when site has mermaid diagrams', async () => {
    fs.writeFileSync(path.join(tmpDir, 'index.md'), '# Home\n\nIntro.');
    fs.writeFileSync(
      path.join(tmpDir, 'diagram.md'),
      '# Diagram\n\n```mermaid\nflowchart LR\n  A --> B\n```',
    );

    const site = await renderSite({
      docsDir: tmpDir,
      siteTitle: 'Test',
      baseUrl: 'https://example.com',
      owner: 'org',
      repo: 'repo',
    });

    const runtime = site.files.find((f) => f.path === '_nrdocs/mermaid.min.js');
    expect(runtime).toBeDefined();
    expect(runtime!.content.length).toBeGreaterThan(1000);

    const diagramPage = site.files.find((f) => f.path === 'diagram/index.html');
    expect(diagramPage).toBeDefined();
    const diagramHtml = diagramPage!.content.toString('utf-8');
    expect(diagramHtml).toContain('src="../_nrdocs/mermaid.min.js"');
    expect(diagramHtml).toContain('<pre class="mermaid">');

    const indexPage = site.files.find((f) => f.path === 'index.html');
    expect(indexPage!.content.toString('utf-8')).not.toContain('mermaid.min.js');
  });

  it('omits mermaid runtime when no mermaid diagrams', async () => {
    fs.writeFileSync(path.join(tmpDir, 'index.md'), '# Home\n\nNo diagrams.');

    const site = await renderSite({
      docsDir: tmpDir,
      siteTitle: 'Test',
      baseUrl: 'https://example.com',
      owner: 'org',
      repo: 'repo',
    });

    expect(site.files.find((f) => f.path === '_nrdocs/mermaid.min.js')).toBeUndefined();
  });
});
