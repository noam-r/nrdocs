import type { SiteId, InstanceId, RequestId, ArtifactId } from '../ids.js';
import type { NrdocsConfig } from '../config.js';
import type { PublisherCredentialFile } from '../credentials.js';
import type { InstanceDescriptor } from '../instance.js';
import type { ManifestDraft } from '../manifest.js';
import type {
  ApiErrorEnvelope,
  ApiSuccessEnvelope,
  ProtocolVersionData,
  PublishResultData,
  PublishTargetData,
} from '../api.js';
import type { SiteStateFixture } from '../publication.js';
import { PublisherApiErrorCode } from '../exit-codes.js';

/** Fixed opaque IDs — 26-char Crockford bodies (ULID-compatible). */
export const FIXTURE_SITE_ID = 'site_01ARZ3NDEKTSV4RRFFQ69G5FAV' as SiteId;
export const FIXTURE_INSTANCE_ID = 'inst_01ARZ3NDEKTSV4RRFFQ69G5FAV' as InstanceId;
export const FIXTURE_REQUEST_ID = 'req_01ARZ3NDEKTSV4RRFFQ69G5FAV' as RequestId;
export const FIXTURE_ARTIFACT_ID = 'artifact_01ARZ3NDEKTSV4RRFFQ69G5FAV' as ArtifactId;

export const FIXTURE_TOKEN =
  'nrd_pub_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrs'.slice(0, 43);

export const previewConfigRaw = {
  title: 'Product Handbook',
  navigation: 'auto',
} as const;

export const connectedConfigRaw = {
  publish: { credential: FIXTURE_SITE_ID },
  title: 'Product Handbook',
  navigation: 'auto',
} as const;

export const previewConfigExpected: NrdocsConfig = {
  title: 'Product Handbook',
  language: 'und',
  direction: 'auto',
  navigation: 'auto',
};

export const connectedConfigExpected: NrdocsConfig = {
  publish: { credential: FIXTURE_SITE_ID },
  title: 'Product Handbook',
  language: 'und',
  direction: 'auto',
  navigation: 'auto',
};

export const credentialFileRaw: PublisherCredentialFile = {
  server: 'https://docs.example.com',
  token: FIXTURE_TOKEN,
};

export const instanceDescriptorRaw = {
  instance_id: FIXTURE_INSTANCE_ID,
  display_name: 'company-docs',
  canonical_origin: 'https://docs.example.com',
  custom_hostname: 'docs.example.com',
  account_id: 'cloudflare-account-id',
  resource_suffix: '3f6m8p0q2r4s6t8v0w2x',
  database_id: 'd1-database-id',
  bucket_name: 'nrdocs-account3-3f6m8p0q2r4s6t8v0w2x-r2',
  worker_name: 'nrdocs-3f6m8p0q2r4s6t8v0w2x',
  status: 'active',
  deployed_version: '2.0.0',
  reconciliation: null,
} satisfies Record<string, unknown>;

export const instanceDescriptorExpected: InstanceDescriptor = {
  instance_id: FIXTURE_INSTANCE_ID,
  display_name: 'company-docs',
  canonical_origin: 'https://docs.example.com',
  custom_hostname: 'docs.example.com',
  account_id: 'cloudflare-account-id',
  resource_suffix: '3f6m8p0q2r4s6t8v0w2x',
  database_id: 'd1-database-id',
  bucket_name: 'nrdocs-account3-3f6m8p0q2r4s6t8v0w2x-r2',
  worker_name: 'nrdocs-3f6m8p0q2r4s6t8v0w2x',
  status: 'active',
  deployed_version: '2.0.0',
  reconciliation: null,
};

const PAGE_SHA = 'a'.repeat(64);
const ASSET_SHA = 'b'.repeat(64);
const ATTACH_SHA = 'c'.repeat(64);

export const validManifestDraft: ManifestDraft = {
  schema_version: 1,
  site_id: FIXTURE_SITE_ID,
  generator: { name: 'nrdocs', version: '2.0.0' },
  site: {
    title: 'Team Handbook',
    language: 'en',
    direction: 'ltr',
    root: { kind: 'redirect', route: '/getting-started/' },
  },
  pages: [
    {
      route: '/getting-started/',
      object: 'pages/getting-started/index.html',
      title: 'Getting started',
      size: 100,
      sha256: PAGE_SHA,
    },
  ],
  assets: [
    {
      path: '/images/architecture.png',
      object: 'assets/images/architecture.png',
      media_type: 'image/png',
      size: 50,
      sha256: ASSET_SHA,
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
    },
  ],
  artifact: {
    file_count: 3,
    uncompressed_size: 225,
  },
};

export const protocolVersionData: ProtocolVersionData = {
  product: 'nrdocs',
  package_version: '2.0.0',
  api_versions: [1],
  artifact_schema_versions: [1],
};

export const publishTargetSuccess: ApiSuccessEnvelope<PublishTargetData> = {
  ok: true,
  data: {
    site: {
      id: FIXTURE_SITE_ID,
      slug: 'team-handbook',
      url: 'https://docs.example.com/team-handbook/',
      enabled: true,
      access: 'password',
      content: 'published',
    },
  },
  request_id: FIXTURE_REQUEST_ID,
};

export const publishPublishedSuccess: ApiSuccessEnvelope<PublishResultData> = {
  ok: true,
  data: {
    site: {
      id: FIXTURE_SITE_ID,
      slug: 'team-handbook',
      url: 'https://docs.example.com/team-handbook/',
      enabled: true,
      access: 'password',
    },
    publication: { result: 'published', pages: 12, assets: 8, attachments: 2 },
  },
  request_id: FIXTURE_REQUEST_ID,
};

export const publishUnchangedSuccess: ApiSuccessEnvelope<PublishResultData> = {
  ok: true,
  data: {
    site: {
      id: FIXTURE_SITE_ID,
      slug: 'team-handbook',
      url: 'https://docs.example.com/team-handbook/',
      enabled: true,
      access: 'public',
    },
    publication: { result: 'unchanged', pages: 12, assets: 8, attachments: 2 },
  },
  request_id: FIXTURE_REQUEST_ID,
};

export const apiErrorFixtures: ApiErrorEnvelope[] = (
  Object.values(PublisherApiErrorCode) as string[]
).map((code) => ({
  ok: false as const,
  error: {
    code: code as ApiErrorEnvelope['error']['code'],
    message: `Safe explanation for ${code}`,
  },
  request_id: FIXTURE_REQUEST_ID,
}));

export const publicEmptySite: SiteStateFixture = {
  id: FIXTURE_SITE_ID,
  slug: 'public-docs',
  enabled: true,
  access_mode: 'public',
  content: 'empty',
  current_publication: null,
};

export const passwordPublishedSite: SiteStateFixture = {
  id: FIXTURE_SITE_ID,
  slug: 'secret-docs',
  enabled: true,
  access_mode: 'password',
  content: 'published',
  current_publication: {
    artifact_id: FIXTURE_ARTIFACT_ID,
    artifact_digest: 'sha256:' + 'd'.repeat(64),
    root_route: '/getting-started/',
    language: 'en',
    direction: 'ltr',
    page_count: 1,
    asset_count: 1,
    attachment_count: 1,
    last_published_at: '2026-01-15T12:00:00Z',
  },
};

/** Cases for identifier / slug / path normalization boundary tests. */
export const idSlugPathCases = {
  validSlugs: ['a', 'team-handbook', 'x'.repeat(63)],
  invalidSlugs: ['', '-bad', 'Bad', 'has_underscore', '_nrdocs', 'a'.repeat(64)],
  reservedSlug: '_nrdocs',
  pathCollisions: {
    exact: [
      { collection: 'pages' as const, path: '/Guide/' },
      { collection: 'pages' as const, path: '/Guide/' },
    ],
    nfc: [
      { collection: 'pages' as const, path: '/cafe\u0301/' }, // e + combining acute
      { collection: 'pages' as const, path: '/caf\u00e9/' }, // precomposed
    ],
    unicodeCase: [
      { collection: 'assets' as const, path: '/Images/A.png' },
      { collection: 'assets' as const, path: '/images/a.png' },
    ],
    crossCollection: [
      { collection: 'assets' as const, path: '/Files/Doc.PDF' },
      { collection: 'attachments' as const, path: '/files/doc.pdf' },
    ],
  },
};

/** Golden canonical JSON object and expected UTF-8 string. */
export const canonicalJsonGolden = {
  value: {
    b: 2,
    a: [1, { z: 0, y: 'ok' }],
    c: 'line\n',
  },
  expected: '{"a":[1,{"y":"ok","z":0}],"b":2,"c":"line\\n"}',
};
