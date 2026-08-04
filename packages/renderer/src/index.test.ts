import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  RENDERER_PACKAGE,
  rendererDependsOnContracts,
  buildPublicationGraph,
  generateNavigationEntries,
  decodeMarkdownSource,
  routeForSourceFile,
  RendererError,
  humanizeSlug,
} from './index.js';
import { parseNrdocsConfig } from '@nrdocs/contracts';

async function withFixture(
  files: Record<string, string | null>,
  fn: (root: string) => Promise<void>,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-render-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(root, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      if (content === null) {
        // create empty directory only
        await fs.mkdir(abs, { recursive: true });
      } else {
        await fs.writeFile(abs, content);
      }
    }
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe('@nrdocs/renderer', () => {
  it('imports contracts', () => {
    expect(RENDERER_PACKAGE).toBe('@nrdocs/renderer');
    expect(rendererDependsOnContracts()).toBe('@nrdocs/contracts');
  });
});

describe('routes', () => {
  it('strips prefixes and extensions', () => {
    expect(routeForSourceFile('index.md')).toBe('/');
    expect(routeForSourceFile('01-overview.md')).toBe('/overview/');
    expect(routeForSourceFile('02-guides/index.md')).toBe('/guides/');
    expect(routeForSourceFile('02-guides/01-installation.md')).toBe('/guides/installation/');
  });
});

describe('utf8', () => {
  it('accepts one leading BOM and normalizes EOL', () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const body = Buffer.from('# Hi\r\n\rNext', 'utf8');
    const text = decodeMarkdownSource(new Uint8Array(Buffer.concat([bom, body])), 'x.md');
    expect(text).toBe('# Hi\n\nNext');
  });

  it('rejects invalid utf8 and misplaced BOM', () => {
    expect(() => decodeMarkdownSource(new Uint8Array([0xff, 0xfe]), 'x.md')).toThrow(RendererError);
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const mid = Buffer.from('a\uFEFFb', 'utf8');
    expect(() => decodeMarkdownSource(new Uint8Array(Buffer.concat([bom, mid])), 'x.md')).toThrow(
      /BOM/,
    );
  });
});

describe('humanize', () => {
  it('capitalizes hyphenated slugs', () => {
    expect(humanizeSlug('getting-started')).toBe('Getting Started');
  });
});

describe('auto discovery and graph', () => {
  it('builds a valid automatic site with nested section', async () => {
    await withFixture(
      {
        'nrdocs.yml': 'title: Handbook\nnavigation: auto\n',
        'index.md': '# Home\n\nSee [overview](01-overview.md).\n',
        '01-overview.md': '# Overview\n\n![diagram](images/a.png)\n',
        '02-guides/index.md': '# Guides\n',
        '02-guides/01-installation.md': '# Installation\n\n[pdf](../files/a.pdf)\n',
        'images/a.png': 'PNG',
        'files/a.pdf': 'PDF',
      },
      async (root) => {
        const config = parseNrdocsConfig({
          title: 'Handbook',
          navigation: 'auto',
        });
        const graph = await buildPublicationGraph(root, config);
        expect(graph.pages.map((p) => p.route)).toEqual([
          '/',
          '/overview/',
          '/guides/',
          '/guides/installation/',
        ]);
        expect(graph.root).toEqual({ kind: 'page', route: '/' });
        expect(graph.assets).toHaveLength(1);
        expect(graph.attachments).toHaveLength(1);
        expect(graph.assets[0]!.publicPath).toBe('/images/a.png');
      },
    );
  });

  it('redirects when root index is missing', async () => {
    await withFixture(
      {
        '01-overview.md': '# Overview\n',
        '02-next.md': '# Next\n',
      },
      async (root) => {
        const config = parseNrdocsConfig({ title: 'Site', navigation: 'auto' });
        const graph = await buildPublicationGraph(root, config);
        expect(graph.root).toEqual({ kind: 'redirect', route: '/overview/' });
      },
    );
  });

  it('rejects duplicate prefixes and route collisions', async () => {
    await withFixture(
      {
        '01-a.md': '# A\n',
        '01-b.md': '# B\n',
      },
      async (root) => {
        await expect(generateNavigationEntries(root)).rejects.toThrow(/Duplicate numeric prefix/);
      },
    );
    await withFixture(
      {
        '01-overview.md': '# One\n',
        '02-overview.md': '# Two\n',
      },
      async (root) => {
        const config = parseNrdocsConfig({ title: 'Site', navigation: 'auto' });
        await expect(buildPublicationGraph(root, config)).rejects.toThrow(/collide/);
      },
    );
  });

  it('rejects nonconforming markdown in auto mode', async () => {
    await withFixture(
      {
        'index.md': '# Home\n',
        'guides.md': '# Guides\n',
      },
      async (root) => {
        const config = parseNrdocsConfig({ title: 'Site', navigation: 'auto' });
        await expect(buildPublicationGraph(root, config)).rejects.toThrow(/cannot order/);
      },
    );
  });

  it('rejects unlisted markdown links under explicit navigation', async () => {
    await withFixture(
      {
        'index.md': '# Home\n\n[secret](secret.md)\n',
        'secret.md': '# Secret\n',
      },
      async (root) => {
        const config = parseNrdocsConfig({
          title: 'Site',
          navigation: [{ title: 'Home', file: 'index.md' }],
        });
        await expect(buildPublicationGraph(root, config)).rejects.toThrow(/unlisted/);
      },
    );
  });

  it('rejects symlinked navigation candidates', async () => {
    await withFixture(
      {
        'index.md': '# Home\n',
        'real.md': '# Real\n',
      },
      async (root) => {
        await fs.symlink(path.join(root, 'real.md'), path.join(root, '01-linked.md'));
        const config = parseNrdocsConfig({ title: 'Site', navigation: 'auto' });
        await expect(buildPublicationGraph(root, config)).rejects.toThrow(/Symbolic-link/);
      },
    );
  });

  it('accepts duplicate titles and depth-8 trees', async () => {
    const files: Record<string, string> = {
      'index.md': '# Home\n',
      '01-a.md': '# Same\n',
      '02-b.md': '# Same\n',
    };
    // Nested sections use prefixes 03+ so they do not collide with 01-a / 02-b
    let dir = '';
    for (let i = 3; i <= 9; i++) {
      dir = dir ? `${dir}/${String(i).padStart(2, '0')}-s` : `${String(i).padStart(2, '0')}-s`;
      files[`${dir}/index.md`] = `# S${i}\n`;
    }
    // 7 section levels (03..09) under root → deepest page depth 8 with leaf
    files[`${dir}/01-leaf.md`] = '# Leaf\n';

    await withFixture(files, async (root) => {
      const config = parseNrdocsConfig({ title: 'Site', navigation: 'auto' });
      const graph = await buildPublicationGraph(root, config);
      expect(graph.pages.some((p) => p.title === 'Same')).toBe(true);
      expect(graph.pages.filter((p) => p.title === 'Same')).toHaveLength(2);
      expect(graph.pages.some((p) => p.route.endsWith('/leaf/'))).toBe(true);
    });
  });

  it('rejects depth-9 automatic trees', async () => {
    const files: Record<string, string> = { 'index.md': '# Home\n' };
    let dir = '';
    for (let i = 1; i <= 8; i++) {
      dir = dir ? `${dir}/${String(i).padStart(2, '0')}-s` : `${String(i).padStart(2, '0')}-s`;
      files[`${dir}/index.md`] = `# S${i}\n`;
    }
    files[`${dir}/01-leaf.md`] = '# Leaf\n';
    await withFixture(files, async (root) => {
      const config = parseNrdocsConfig({ title: 'Site', navigation: 'auto' });
      await expect(buildPublicationGraph(root, config)).rejects.toThrow(/depth/);
    });
  });

  it('includes nonconforming names in generate mode', async () => {
    await withFixture(
      {
        'index.md': '# Home\n',
        'guides.md': '# Guides\n',
      },
      async (root) => {
        const entries = await generateNavigationEntries(root);
        expect(entries.map((e) => e.file)).toEqual(['index.md', 'guides.md']);
      },
    );
  });

  it('rejects forbidden extensions and escaping links', async () => {
    await withFixture(
      {
        'index.md': '# Home\n\n[bad](evil.js)\n',
        'evil.js': 'x',
      },
      async (root) => {
        const config = parseNrdocsConfig({ title: 'Site', navigation: 'auto' });
        await expect(buildPublicationGraph(root, config)).rejects.toThrow(/not allowed/);
      },
    );
    await withFixture(
      {
        'index.md': '# Home\n\n[out](../outside.md)\n',
      },
      async (root) => {
        const config = parseNrdocsConfig({ title: 'Site', navigation: 'auto' });
        await expect(buildPublicationGraph(root, config)).rejects.toThrow(/escape/);
      },
    );
  });

  it('is deterministic across directory enumeration', async () => {
    await withFixture(
      {
        'index.md': '# Home\n',
        '03-c.md': '# C\n',
        '01-a.md': '# A\n',
        '02-b.md': '# B\n',
      },
      async (root) => {
        const a = await generateNavigationEntries(root);
        const b = await generateNavigationEntries(root);
        expect(a).toEqual(b);
        expect(a.map((e) => e.file)).toEqual(['index.md', '01-a.md', '02-b.md', '03-c.md']);
      },
    );
  });
});
