import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  sortNavPaths,
  discoverNavEntries,
  groupNavEntriesByFolders,
  navConfigToNavItems,
  navConfigToSidebar,
  flattenNavPaths,
  isSkippablePlaceholderIndex,
} from '../renderer/navigation.js';
import {
  loadDocsConfig,
  writeNavToConfig,
  getExplicitNav,
  parseNavEntries,
  validateNavPaths,
  resolveContentIndex,
  generateNavInConfig,
} from '../config/docs-config.js';
import { renderSite } from '../renderer/index.js';

describe('sortNavPaths', () => {
  it('puts index.md first then numeric order', () => {
    const sorted = sortNavPaths(
      ['10-z.md', '01-b.md', '00-a.md', 'index.md', '02-c.md'],
      'index.md',
    );
    expect(sorted).toEqual(['index.md', '00-a.md', '01-b.md', '02-c.md', '10-z.md']);
  });
});

describe('isSkippablePlaceholderIndex', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrdocs-skip-index-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips legacy init stub at docs/index.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'index.md'),
      '# My Site\n\nWelcome to your documentation site powered by nrdocs.\n',
    );
    expect(isSkippablePlaceholderIndex(tmpDir, 'index.md')).toBe(true);
  });

  it('keeps short but real root index.md', () => {
    fs.writeFileSync(path.join(tmpDir, 'index.md'), '# Home\n');
    expect(isSkippablePlaceholderIndex(tmpDir, 'index.md')).toBe(false);
  });

  it('does not skip index.md in subfolders', () => {
    fs.mkdirSync(path.join(tmpDir, 'guide'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'guide', 'index.md'), '# Home\n');
    expect(isSkippablePlaceholderIndex(tmpDir, 'guide/index.md')).toBe(false);
  });
});

describe('discoverNavEntries', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrdocs-discover-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('omits placeholder root index.md from nav', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'index.md'),
      '# Site\n\nWelcome to your documentation site powered by nrdocs.\n',
    );
    fs.writeFileSync(path.join(tmpDir, '00-intro.md'), '# Intro');

    const entries = discoverNavEntries(tmpDir);
    expect(flattenNavPaths(entries)).toEqual(['00-intro.md']);
  });

  it('orders numbered prefixes after index at root', () => {
    fs.writeFileSync(path.join(tmpDir, 'index.md'), '# Home');
    fs.writeFileSync(path.join(tmpDir, '00-intro.md'), '# Intro');
    fs.writeFileSync(path.join(tmpDir, '01-setup.md'), '# Setup');

    const entries = discoverNavEntries(tmpDir);
    expect(flattenNavPaths(entries)).toEqual(['index.md', '00-intro.md', '01-setup.md']);
    expect(entries.every((e) => e.path)).toBe(true);
  });

  it('groups files under top-level folders into sections', () => {
    fs.writeFileSync(path.join(tmpDir, 'index.md'), '# Home');
    fs.mkdirSync(path.join(tmpDir, 'guides'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'guides', 'intro.md'), '# Intro');
    fs.writeFileSync(path.join(tmpDir, 'guides', 'install.md'), '# Install');

    const entries = discoverNavEntries(tmpDir);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.path).toBe('index.md');
    expect(entries[1]!.title).toBe('Guides');
    expect(entries[1]!.children?.map((c) => c.path)).toEqual([
      'guides/install.md',
      'guides/intro.md',
    ]);
  });
});

describe('groupNavEntriesByFolders', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrdocs-group-'));
    fs.writeFileSync(path.join(tmpDir, 'index.md'), '# Home');
    fs.mkdirSync(path.join(tmpDir, 'api'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'guides'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'api', 'a.md'), '# API');
    fs.writeFileSync(path.join(tmpDir, 'guides', 'b.md'), '# Guide');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sorts folder sections alphabetically after root pages', () => {
    const files = ['api/a.md', 'guides/b.md', 'index.md'];
    const grouped = groupNavEntriesByFolders(files, tmpDir, 'index.md');
    expect(grouped.map((e) => e.title)).toEqual(['Home', 'Api', 'Guides']);
  });
});

describe('nav generate config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrdocs-nav-gen-'));
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'docs', 'nrdocs.yml'),
      `site:
  title: Test Docs
  api_url: https://example.com

content:
  source_dir: .
  index: index.md
  nav: auto
`,
    );
    fs.writeFileSync(path.join(tmpDir, 'docs', 'index.md'), '# Home');
    fs.writeFileSync(path.join(tmpDir, 'docs', '01-guide.md'), '# Guide');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sets content.index to first page when index.md is absent', () => {
    const docsDir = path.join(tmpDir, 'docs');
    fs.unlinkSync(path.join(docsDir, 'index.md'));
    const count = generateNavInConfig(docsDir, { generatedBy: 'nrdocs init' });
    expect(count).toBe(1);
    const loaded = loadDocsConfig(docsDir);
    expect(loaded.config.content?.index).toBe('01-guide.md');
  });

  it('writes explicit nav preserving site keys', () => {
    const docsDir = path.join(tmpDir, 'docs');
    const { configPath, contentDir } = loadDocsConfig(docsDir);
    const entries = discoverNavEntries(contentDir, { indexPath: 'index.md' });
    writeNavToConfig(configPath, entries);

    const loaded = loadDocsConfig(docsDir);
    expect(loaded.config.site?.title).toBe('Test Docs');
    expect(loaded.config.site?.api_url).toBe('https://example.com');
    const nav = getExplicitNav(loaded.config);
    expect(nav).toHaveLength(2);
    expect(nav![0]!.path).toBe('index.md');
    expect(nav![1]!.path).toBe('01-guide.md');
  });
});

describe('resolveContentIndex', () => {
  it('prefers index.md when listed', () => {
    const index = resolveContentIndex([
      { title: 'B', path: 'b.md' },
      { title: 'Home', path: 'index.md' },
    ]);
    expect(index).toBe('index.md');
  });

  it('uses first entry when index.md is missing', () => {
    const index = resolveContentIndex([
      { title: 'Intro', path: '00-intro.md' },
      { title: 'Guide', path: '01-guide.md' },
    ]);
    expect(index).toBe('00-intro.md');
  });
});

describe('validateNavPaths', () => {
  it('reports missing paths', () => {
    const result = validateNavPaths(
      [{ title: 'Missing', path: 'nope.md' }],
      '/tmp',
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('not found');
  });
});

describe('renderSite explicit nav order', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrdocs-render-nav-'));
    fs.writeFileSync(path.join(tmpDir, 'index.md'), '# Home\n');
    fs.writeFileSync(path.join(tmpDir, 'aaa.md'), '# AAA\n');
    fs.writeFileSync(path.join(tmpDir, 'zzz.md'), '# ZZZ\n');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('renders sidebar sections from folder-grouped auto nav', async () => {
    fs.mkdirSync(path.join(tmpDir, 'guide'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'guide', 'page.md'), '# Guide page\n');

    const site = await renderSite({
      docsDir: tmpDir,
      siteTitle: 'Test',
      baseUrl: 'https://example.com',
      owner: 'o',
      repo: 'r',
      nav: 'auto',
    });

    const homeHtml = site.files.find((f) => f.path === 'index.html')!.content.toString('utf-8');
    expect(homeHtml).toContain('<details class="nav-details"');
    expect(homeHtml).toContain('<summary>Guide</summary>');
  });

  it('renders pages in explicit nav order', async () => {
    const explicitNav = [
      { title: 'Last', path: 'zzz.md' },
      { title: 'First', path: 'aaa.md' },
      { title: 'Home', path: 'index.md' },
    ];

    const site = await renderSite({
      docsDir: tmpDir,
      siteTitle: 'Test',
      baseUrl: 'https://example.com',
      owner: 'o',
      repo: 'r',
      nav: explicitNav,
    });

    const pagePaths = (site.manifest['pages'] as Array<{ sourcePath: string }>).map(
      (p) => p.sourcePath,
    );
    expect(pagePaths).toEqual(['zzz.md', 'aaa.md', 'index.md']);
  });
});

describe('navConfigToNavItems', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrdocs-nav-items-'));
    fs.writeFileSync(path.join(tmpDir, 'page.md'), '# Page');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('maps paths to hrefs', () => {
    const items = navConfigToNavItems([{ title: 'Page', path: 'page.md' }], tmpDir);
    expect(items[0]!.href).toBe('page/');
  });

  it('flattens section children for page list', () => {
    fs.writeFileSync(path.join(tmpDir, 'index.md'), '# Home');
    fs.mkdirSync(path.join(tmpDir, 'guides'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'guides', 'intro.md'), '# Intro');
    const items = navConfigToNavItems(
      [
        { title: 'Home', path: 'index.md' },
        {
          title: 'Guides',
          children: [{ title: 'Intro', path: 'guides/intro.md' }],
        },
      ],
      tmpDir,
    );
    expect(items.map((i) => i.path)).toEqual(['index.md', 'guides/intro.md']);
  });
});

describe('navConfigToSidebar', () => {
  it('marks active link and opens section containing it', () => {
    const tree = navConfigToSidebar(
      [
        { title: 'Home', path: 'index.md' },
        {
          title: 'Guides',
          children: [
            { title: 'Intro', path: 'guides/intro.md' },
            { title: 'Setup', path: 'guides/setup.md' },
          ],
        },
      ],
      'guides/setup.md',
    );
    expect(tree[1]!.kind).toBe('section');
    if (tree[1]!.kind === 'section') {
      expect(tree[1]!.open).toBe(true);
      const setup = tree[1]!.children[1]!;
      expect(setup.kind).toBe('link');
      if (setup.kind === 'link') expect(setup.active).toBe(true);
    }
  });
});

describe('parseNavEntries sections', () => {
  it('accepts section-only entries without path', () => {
    const entries = parseNavEntries([
      { title: 'Overview', children: [{ title: 'Home', path: 'index.md' }] },
    ]);
    expect(entries[0]!.path).toBeUndefined();
    expect(entries[0]!.children![0]!.path).toBe('index.md');
  });
});
