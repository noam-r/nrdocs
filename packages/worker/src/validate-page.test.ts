import { describe, expect, it } from 'vitest';
import { assemblePageDocument } from '@nrdocs/renderer';
import type { ManifestV1, SiteId } from '@nrdocs/contracts';
import { validateStoredPage } from './validate-page.js';

const SITE = 'site_01ARZ3NDEKTSV4RRFFQ69G5FAV' as SiteId;

function minimalManifest(): ManifestV1 {
  return {
    schema_version: 1,
    site_id: SITE,
    generator: { name: 'nrdocs', version: '2.0.0' },
    site: {
      title: 'Handbook',
      language: 'en',
      direction: 'ltr',
      root: { kind: 'page', route: '/' },
    },
    pages: [
      {
        route: '/',
        object: 'pages/index.html',
        title: 'Home',
        size: 1,
        sha256: 'a'.repeat(64),
      },
    ],
    assets: [],
    attachments: [],
    artifact: {
      digest: `sha256:${'b'.repeat(64)}`,
      file_count: 2,
      uncompressed_size: 10,
    },
  };
}

describe('validateStoredPage', () => {
  it('accepts renderer shell output', () => {
    const html = assemblePageDocument({
      language: 'en',
      direction: 'ltr',
      siteTitle: 'Handbook',
      pageTitle: 'Home',
      pageRoute: '/',
      articleHtml: '<h1 id="nr-h-0123456789abcdef">Home</h1>\n<p>Hello</p>\n',
      navTree: [{ kind: 'page', title: 'Home', route: '/', depth: 0, children: [] }],
      prev: null,
      next: null,
    });
    expect(() =>
      validateStoredPage(new TextEncoder().encode(html), {
        pageRoute: '/',
        manifest: minimalManifest(),
      }),
    ).not.toThrow();
  });

  it('rejects publisher script tags in content', () => {
    const html = assemblePageDocument({
      language: 'en',
      direction: 'ltr',
      siteTitle: 'Handbook',
      pageTitle: 'Home',
      pageRoute: '/',
      articleHtml: '<h1 id="nr-h-0123456789abcdef">Home</h1>\n<script>alert(1)</script>\n',
      navTree: [{ kind: 'page', title: 'Home', route: '/', depth: 0, children: [] }],
      prev: null,
      next: null,
    });
    expect(() =>
      validateStoredPage(new TextEncoder().encode(html), {
        pageRoute: '/',
        manifest: minimalManifest(),
      }),
    ).toThrow(/script|Disallowed/i);
  });

  it('rejects lang/dir mismatch with manifest', () => {
    const html = assemblePageDocument({
      language: 'fr',
      direction: 'ltr',
      siteTitle: 'Handbook',
      pageTitle: 'Home',
      pageRoute: '/',
      articleHtml: '<h1 id="nr-h-0123456789abcdef">Home</h1>\n',
      navTree: [{ kind: 'page', title: 'Home', route: '/', depth: 0, children: [] }],
      prev: null,
      next: null,
    });
    expect(() =>
      validateStoredPage(new TextEncoder().encode(html), {
        pageRoute: '/',
        manifest: minimalManifest(),
      }),
    ).toThrow(/lang/);
  });
});
