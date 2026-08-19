import { describe, expect, it } from 'vitest';
import {
  agentAssetRoute,
  agentAttachmentRoute,
  agentIdFromCanonicalPath,
  agentSectionId,
  parseAgentGrantPayload,
  parseAgentManifestV1,
  parseAgentShareDuration,
  parseManifest,
  parseManifestV1,
  parseManifestV2,
  sealManifest,
  sealManifestV2,
  computeAgentContentDigest,
  serializeAgentManifest,
  AGENT_SHARE_DURATIONS,
  fixtures,
  type AgentManifestV1,
  type ManifestDraftV2,
} from './index.js';

const PAGE_SHA = 'a'.repeat(64);
const MD_SHA = '1'.repeat(64);
const ASSET_SHA = 'b'.repeat(64);
const ATTACH_SHA = 'c'.repeat(64);
const INDEX_SHA = 'd'.repeat(64);
const AGENT_MANIFEST_SHA = 'e'.repeat(64);

async function validDraftV2(): Promise<ManifestDraftV2> {
  const pageId = await agentIdFromCanonicalPath('/getting-started/');
  const assetId = await agentIdFromCanonicalPath('/images/architecture.png');
  const attachId = await agentIdFromCanonicalPath('/files/checklist.pdf');
  const htmlSize = 100;
  const mdSize = 40;
  const indexSize = 20;
  const agentManifestSize = 30;
  return {
    schema_version: 2,
    page_schema_version: 2,
    site_id: fixtures.FIXTURE_SITE_ID,
    generator: { name: 'nrdocs', version: '2.0.0' },
    site: {
      title: 'Team Handbook',
      language: 'en',
      direction: 'ltr',
      root: { kind: 'redirect', route: '/getting-started/' },
    },
    pages: [
      {
        id: pageId,
        route: '/getting-started/',
        title: 'Getting started',
        html: {
          object: 'pages/getting-started/index.html',
          size: htmlSize,
          sha256: PAGE_SHA,
        },
        markdown: {
          object: `agent/pages/${pageId}.md`,
          size: mdSize,
          sha256: MD_SHA,
        },
      },
    ],
    assets: [
      {
        path: '/images/architecture.png',
        object: 'assets/images/architecture.png',
        media_type: 'image/png',
        size: 50,
        sha256: ASSET_SHA,
        agent: {
          id: assetId,
          route: agentAssetRoute(assetId, '/images/architecture.png'),
        },
      },
    ],
    attachments: [
      {
        path: '/files/checklist.pdf',
        object: 'attachments/files/checklist.pdf',
        media_type: 'application/pdf',
        filename: 'checklist.pdf',
        size: 75,
        sha256: ATTACH_SHA,
        agent: {
          id: attachId,
          route: agentAttachmentRoute(attachId, '/files/checklist.pdf'),
        },
      },
    ],
    agent: {
      schema_version: 1,
      index: { object: 'agent/index.md', size: indexSize, sha256: INDEX_SHA },
      manifest: {
        object: 'agent/manifest.json',
        size: agentManifestSize,
        sha256: AGENT_MANIFEST_SHA,
      },
      all: null,
    },
    artifact: {
      file_count: 2 + 1 + 1 + 2,
      uncompressed_size: htmlSize + mdSize + 50 + 75 + indexSize + agentManifestSize,
    },
  };
}

describe('manifest v2', () => {
  it('seals and parses deterministically', async () => {
    const draft = await validDraftV2();
    const a = await sealManifestV2(draft);
    const b = await sealManifestV2(draft);
    expect(a.artifact.digest).toBe(b.artifact.digest);
    const parsed = await parseManifestV2(a);
    expect(parsed.artifact.digest).toBe(a.artifact.digest);
    const dispatched = await parseManifest(a);
    expect(dispatched.schema_version).toBe(2);
  });

  it('does not depend on slug or origin for page ids', async () => {
    const a = await agentIdFromCanonicalPath('/');
    const b = await agentIdFromCanonicalPath('/');
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
    expect(a).not.toContain('handbook');
    const other = await agentIdFromCanonicalPath('/introduction/');
    expect(other).not.toBe(a);
  });

  it('v1 parser rejects v2 fields and v2 rejects unknown fields', async () => {
    const v1 = await sealManifest(fixtures.validManifestDraft);
    await expect(parseManifestV1({ ...v1, agent: {} })).rejects.toThrow(/unknown/);
    const v2 = await sealManifestV2(await validDraftV2());
    await expect(parseManifestV2({ ...v2, extra: true })).rejects.toThrow(/unknown/);
    await expect(parseManifestV1(v2)).rejects.toThrow();
  });
});

describe('agent grant payload', () => {
  it('accepts exact 1h 24h 7d lifetimes and rejects others', () => {
    expect(parseAgentShareDuration('24h')).toBe('24h');
    expect(parseAgentShareDuration('2h')).toBeNull();
    const base = {
      v: 1 as const,
      site_id: fixtures.FIXTURE_SITE_ID,
      generation: 1,
      iat: 1_000_000,
      nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
    };
    expect(
      parseAgentGrantPayload({ ...base, exp: base.iat + AGENT_SHARE_DURATIONS['1h'] }).exp,
    ).toBe(base.iat + 3600);
    expect(() => parseAgentGrantPayload({ ...base, exp: base.iat + 10 })).toThrow(/lifetime/);
    expect(() => parseAgentGrantPayload({ ...base, extra: 1, exp: base.iat + 3600 })).toThrow(
      /unknown/,
    );
  });
});

describe('agent navigation and manifest', () => {
  it('computes stable section ids from title and path', async () => {
    const a = await agentSectionId('Architecture', [0]);
    const b = await agentSectionId('Architecture', [0]);
    const c = await agentSectionId('Architecture', [1]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith('section_')).toBe(true);
  });

  it('parses a valid agent manifest and rejects missing fields', async () => {
    const pageId = await agentIdFromCanonicalPath('/getting-started/');
    const assetId = await agentIdFromCanonicalPath('/images/architecture.png');
    const attachId = await agentIdFromCanonicalPath('/files/checklist.pdf');
    const pages = [
      {
        id: pageId,
        title: 'Getting started',
        human_route: '/getting-started/',
        markdown_path: `pages/${pageId}.md`,
        markdown_size: 40,
        markdown_sha256: MD_SHA,
        previous_id: null,
        next_id: null,
        order: 0,
      },
    ];
    const assets = [
      {
        id: assetId,
        path: agentAssetRoute(assetId, '/images/architecture.png'),
        media_type: 'image/png',
        size: 50,
        sha256: ASSET_SHA,
      },
    ];
    const attachments = [
      {
        id: attachId,
        path: agentAttachmentRoute(attachId, '/files/checklist.pdf'),
        media_type: 'application/pdf',
        filename: 'checklist.pdf',
        size: 75,
        sha256: ATTACH_SHA,
      },
    ];
    const digest = await computeAgentContentDigest({
      site: {
        title: 'Team Handbook',
        language: 'en',
        direction: 'ltr',
        root_route: '/getting-started/',
      },
      pages,
      index_sha256: INDEX_SHA,
      all_sha256: null,
      assets,
      attachments,
    });
    const nav: AgentManifestV1['navigation'] = [{ kind: 'page', page_id: pageId, children: [] }];
    const raw: AgentManifestV1 = {
      schema_version: 1,
      site: {
        title: 'Team Handbook',
        language: 'en',
        direction: 'ltr',
        root_route: '/getting-started/',
      },
      publication: {
        content_digest: digest,
        page_count: 1,
        has_all_markdown: false,
        all_markdown_size: null,
      },
      pages,
      assets,
      attachments,
      navigation: nav,
    };
    const parsed = await parseAgentManifestV1(raw, {
      verifyContentDigest: true,
      indexSha256: INDEX_SHA,
      allSha256: null,
    });
    expect(parsed.publication.content_digest).toBe(digest);
    const again = await parseAgentManifestV1(JSON.parse(serializeAgentManifest(parsed)), {
      verifyContentDigest: true,
      indexSha256: INDEX_SHA,
      allSha256: null,
    });
    expect(again.publication.content_digest).toBe(digest);

    await expect(parseAgentManifestV1({ ...raw, extra: true })).rejects.toThrow(/unknown/);
    await expect(
      parseAgentManifestV1({
        ...raw,
        publication: { ...raw.publication, has_all_markdown: false, all_markdown_size: 1 },
      }),
    ).rejects.toThrow(/all_markdown_size/);
  });
});
