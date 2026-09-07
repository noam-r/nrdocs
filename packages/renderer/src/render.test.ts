import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseNrdocsConfig, type SiteId } from '@nrdocs/contracts';
import {
  RENDERER_PACKAGE,
  routeRelativeHref,
  buildArtifactFromConfig,
  FIXED_PAGE_VALIDATOR_GAP,
  buildPublicationGraph,
  renderPublication,
  packArtifact,
} from './index.js';

const SITE = 'site_01ARZ3NDEKTSV4RRFFQ69G5FAV' as SiteId;

async function withFixture(files: Record<string, string>, fn: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-p4-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(root, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content);
    }
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe('routeRelativeHref', () => {
  it('matches the locked examples', () => {
    expect(routeRelativeHref('/', '/')).toBe('./');
    expect(routeRelativeHref('/', '/overview/')).toBe('overview/');
    expect(routeRelativeHref('/guides/install/', '/')).toBe('../../');
    expect(routeRelativeHref('/guides/install/', '/guides/configuration/')).toBe(
      '../configuration/',
    );
    expect(routeRelativeHref('/guides/install/', '/images/a.png')).toBe('../../images/a.png');
  });
});

describe('Phase 4 render + pack', () => {
  it('tracks the fixed-page validator ownership', () => {
    expect(FIXED_PAGE_VALIDATOR_GAP).toMatch(/@nrdocs\/worker/);
    expect(RENDERER_PACKAGE).toBe('@nrdocs/renderer');
  });

  it('renders a complete document shell with lang/dir and route-relative links', async () => {
    await withFixture(
      {
        'index.md': '# Home\n\nSee [Overview](01-overview.md).\n\n```js\nconst x = 1;\n```\n',
        '01-overview.md':
          '# Overview\n\n![x](images/a.png)\n\n```mermaid\nflowchart LR\n  A-->B\n```\n',
        'images/a.png': 'PNGDATA',
      },
      async (root) => {
        const config = parseNrdocsConfig({
          title: 'Handbook',
          language: 'en',
          direction: 'ltr',
          navigation: 'auto',
        });
        const { artifact, digest } = await buildArtifactFromConfig(root, config, { siteId: SITE });
        const home = artifact.files.find((f) => f.objectPath === 'pages/index.html')!;
        const html = new TextDecoder().decode(home.bytes);
        expect(html.startsWith('<!doctype html>\n<html lang="en" dir="ltr">')).toBe(true);
        expect(html).toContain('href="/_nrdocs/v2/reader.css"');
        expect(html).toContain('href="/_nrdocs/v2/logo.svg"');
        expect(html).toContain('src="/_nrdocs/v2/reader.js"');
        expect(html).toContain('class="nr-ai-share nr-icon-btn"');
        expect(html).toContain('href="overview/"');
        expect(html).toContain('class="language-javascript"');
        expect(html).not.toContain('site_');
        expect(html).not.toContain('docs.example.com');

        const overview = artifact.files.find((f) => f.objectPath === 'pages/overview/index.html')!;
        const ohtml = new TextDecoder().decode(overview.bytes);
        expect(ohtml).toContain('class="nr-mermaid"');
        expect(ohtml).toContain('data-nr-mermaid');
        expect(ohtml).toContain('../images/a.png');

        expect(artifact.manifest.schema_version).toBe(2);
        expect(artifact.manifest.artifact.digest).toBe(digest);
        expect(artifact.manifest.pages).toHaveLength(2);
        expect(artifact.manifest.assets).toHaveLength(1);
        expect(artifact.files.some((f) => f.objectPath === 'agent/index.md')).toBe(true);
        expect(artifact.files.some((f) => f.objectPath === 'nrdocs.yml')).toBe(false);
      },
    );
  });

  it('renders missing images as broken', async () => {
    await withFixture(
      {
        'index.md': '# Home\n\n![diagram](images/missing.png)\n',
      },
      async (root) => {
        const config = parseNrdocsConfig({
          title: 'Handbook',
          navigation: [{ title: 'Home', file: 'index.md' }],
        });
        const { artifact, diagnostics } = await buildArtifactFromConfig(root, config, {
          siteId: SITE,
        });
        expect(diagnostics[0]?.code).toBe('missing_image');
        expect(artifact.manifest.assets).toHaveLength(0);
        const home = artifact.files.find((f) => f.objectPath === 'pages/index.html')!;
        const html = new TextDecoder().decode(home.bytes);
        expect(html).toContain('class="nr-broken-link"');
        expect(html).toContain('title="Broken image: images/missing.png"');
        expect(html).toContain('diagram');
        expect(html).not.toContain('src="images/missing.png"');
      },
    );
  });

  it('renders missing attachment links as broken', async () => {
    await withFixture(
      {
        'index.md': '# Home\n\nSee [manifest](./specification-digest-manifest.json).\n',
      },
      async (root) => {
        const config = parseNrdocsConfig({
          title: 'Handbook',
          navigation: [{ title: 'Home', file: 'index.md' }],
        });
        const { artifact, diagnostics } = await buildArtifactFromConfig(root, config, {
          siteId: SITE,
        });
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]?.code).toBe('missing_attachment');
        expect(artifact.manifest.attachments).toHaveLength(0);
        const home = artifact.files.find((f) => f.objectPath === 'pages/index.html')!;
        const html = new TextDecoder().decode(home.bytes);
        expect(html).toContain('class="nr-broken-link"');
        expect(html).toContain('title="Broken link: ./specification-digest-manifest.json"');
        expect(html).toContain('manifest');
        expect(html).not.toContain('href="specification-digest-manifest.json"');
      },
    );
  });

  it('renders unlisted markdown links as broken', async () => {
    await withFixture(
      {
        'index.md': '# Home\n\nSee [Secret](secret.md).\n',
      },
      async (root) => {
        const config = parseNrdocsConfig({
          title: 'Handbook',
          navigation: [{ title: 'Home', file: 'index.md' }],
        });
        const { artifact, diagnostics } = await buildArtifactFromConfig(root, config, {
          siteId: SITE,
        });
        expect(diagnostics).toHaveLength(1);
        const home = artifact.files.find((f) => f.objectPath === 'pages/index.html')!;
        const html = new TextDecoder().decode(home.bytes);
        expect(html).toContain('class="nr-broken-link"');
        expect(html).toContain('title="Broken link: secret.md"');
        expect(html).toContain('Secret');
        expect(html).not.toContain('href="secret.md"');
      },
    );
  });

  it('is byte-identical across CRLF sources and repeated packs', async () => {
    await withFixture(
      {
        'index.md': '# Home\r\n\r\nHello\r\n',
      },
      async (root) => {
        const config = parseNrdocsConfig({ title: 'Site', navigation: 'auto' });
        const a = await buildArtifactFromConfig(root, config, { siteId: SITE });
        const b = await buildArtifactFromConfig(root, config, { siteId: SITE });
        expect(a.digest).toBe(b.digest);
        expect(Buffer.from(a.gzipBytes).equals(Buffer.from(b.gzipBytes))).toBe(true);
      },
    );
  });

  it('rejects raw HTML and produces und/auto defaults', async () => {
    await withFixture(
      {
        'index.md': '# Home\n\n<div>nope</div>\n',
      },
      async (root) => {
        const config = parseNrdocsConfig({ title: 'Site', navigation: 'auto' });
        await expect(buildArtifactFromConfig(root, config, { siteId: SITE })).rejects.toThrow(
          /Raw HTML/,
        );
      },
    );

    await withFixture(
      {
        'index.md': '# Home\n',
      },
      async (root) => {
        const config = parseNrdocsConfig({ title: 'Site', navigation: 'auto' });
        const graph = await buildPublicationGraph(root, config);
        const artifact = await renderPublication(graph, {
          siteId: SITE,
          generatorVersion: '2.0.0',
        });
        const html = new TextDecoder().decode(
          artifact.files.find((f) => f.objectPath === 'pages/index.html')!.bytes,
        );
        expect(html).toContain('lang="und"');
        expect(html).toContain('dir="auto"');
        const packed = packArtifact(artifact);
        expect(packed.digest).toBe(artifact.manifest.artifact.digest);
      },
    );
  });

  it('publishes OpenAPI landing and operation pages as schema 3', async () => {
    await withFixture(
      {
        'openapi.yaml': `openapi: 3.1.0
info:
  title: Demo API
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      summary: List pets
      tags: [pets]
      responses:
        '200':
          description: ok
`,
      },
      async (root) => {
        const config = parseNrdocsConfig({
          title: 'API Docs',
          navigation: 'auto',
          api: { specification: 'openapi.yaml' },
        });
        const { artifact } = await buildArtifactFromConfig(root, config, { siteId: SITE });
        expect(artifact.manifest.schema_version).toBe(3);
        expect(artifact.manifest.page_schema_version).toBe(3);
        if (artifact.manifest.schema_version !== 3) throw new Error('expected v3');
        expect(artifact.manifest.openapi_download.route).toBe('/api-reference/openapi.json');
        expect(artifact.manifest.pages.map((p) => p.route)).toEqual([
          '/api-reference/',
          '/api-reference/operations/listPets/',
        ]);
        expect(artifact.manifest.site.root).toEqual({
          kind: 'redirect',
          route: '/api-reference/',
        });
        const landing = artifact.files.find(
          (f) => f.objectPath === 'pages/api-reference/index.html',
        )!;
        const html = new TextDecoder().decode(landing.bytes);
        expect(html).toContain('/_nrdocs/v3/reader.css');
        expect(html).toContain('nr-api-layout');
        expect(html).toContain('Download OpenAPI');
        expect(artifact.files.some((f) => f.objectPath === 'openapi/openapi.json')).toBe(true);
      },
    );
  });

  it('allows Markdown guides to link to generated API routes', async () => {
    await withFixture(
      {
        'index.md': '# Guides\n\nSee [list pets](/api-reference/operations/listPets/).\n',
        'openapi.yaml': `openapi: 3.1.0
info:
  title: Demo API
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      summary: List pets
      responses:
        '200':
          description: ok
`,
      },
      async (root) => {
        const config = parseNrdocsConfig({
          title: 'Mixed Docs',
          navigation: 'auto',
          api: { specification: 'openapi.yaml' },
        });
        const { artifact } = await buildArtifactFromConfig(root, config, { siteId: SITE });
        expect(artifact.manifest.schema_version).toBe(3);
        expect(artifact.manifest.pages.map((p) => p.route)).toEqual([
          '/',
          '/api-reference/',
          '/api-reference/operations/listPets/',
        ]);
        const home = artifact.files.find((f) => f.objectPath === 'pages/index.html')!;
        const html = new TextDecoder().decode(home.bytes);
        expect(html).toContain('api-reference/operations/listPets/');
      },
    );
  });
});
