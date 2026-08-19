import { canonicalizeJson, canonicalizeJsonBytes, type CanonicalJson } from './canonical-json.js';
import { artifactDigestFromDescriptor, parseSha256Digest } from './digest.js';
import {
  isAttachmentExtension,
  isForbiddenWebExtension,
  isImageExtension,
  mediaTypeForExtension,
  normalizeExtension,
} from './extensions.js';
import { assertDirection, assertLanguage, type Direction } from './language.js';
import { assertTitle } from './title.js';
import {
  AGENT_ALL_MD_MAX_BYTES,
  AGENT_INDEX_MAX_BYTES,
  AGENT_MANIFEST_JSON_MAX_BYTES,
  AGENT_PAGE_MARKDOWN_MAX_BYTES,
} from './agent-limits.js';
import { assertAgentRelativeRoute, isAgentHexId } from './agent-ids.js';
import { assertAgentNavigation, type AgentNavigationNode } from './agent-nav.js';

export const AGENT_MANIFEST_SCHEMA_VERSION = 1 as const;

export type AgentManifestSite = {
  title: string;
  language: string;
  direction: Direction;
  root_route: string;
};

export type AgentManifestPublication = {
  content_digest: string;
  page_count: number;
  has_all_markdown: boolean;
  all_markdown_size: number | null;
};

export type AgentManifestPage = {
  id: string;
  title: string;
  human_route: string;
  markdown_path: string;
  markdown_size: number;
  markdown_sha256: string;
  previous_id: string | null;
  next_id: string | null;
  order: number;
};

export type AgentManifestAsset = {
  id: string;
  path: string;
  media_type: string;
  size: number;
  sha256: string;
};

export type AgentManifestAttachment = {
  id: string;
  path: string;
  media_type: string;
  filename: string;
  size: number;
  sha256: string;
};

export type AgentManifestV1 = {
  schema_version: 1;
  site: AgentManifestSite;
  publication: AgentManifestPublication;
  pages: AgentManifestPage[];
  assets: AgentManifestAsset[];
  attachments: AgentManifestAttachment[];
  navigation: AgentNavigationNode[];
};

const TOP_LEVEL = new Set([
  'schema_version',
  'site',
  'publication',
  'pages',
  'assets',
  'attachments',
  'navigation',
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function assertNonNegInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function assertHexSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${field} must be 64 lowercase hex characters`);
  }
  return value;
}

function assertPublicRoute(route: string): void {
  if (!route.startsWith('/') || !route.endsWith('/')) {
    throw new Error('page route must have leading and trailing slashes');
  }
  if (route.includes('\\') || route.includes('\0') || route.includes('//')) {
    throw new Error('unsafe page route');
  }
}

function assertMarkdownPath(path: string, id: string): void {
  if (path !== `pages/${id}.md`) {
    throw new Error('markdown_path must be pages/<id>.md');
  }
}

function parseNavNode(raw: unknown): AgentNavigationNode {
  if (!isPlainObject(raw)) throw new Error('navigation node must be an object');
  if (raw.kind === 'section') {
    for (const key of Object.keys(raw)) {
      if (!['kind', 'id', 'title', 'children'].includes(key)) {
        throw new Error(`unknown navigation field: ${key}`);
      }
    }
    if (
      typeof raw.id !== 'string' ||
      typeof raw.title !== 'string' ||
      !Array.isArray(raw.children)
    ) {
      throw new Error('invalid section node');
    }
    return {
      kind: 'section',
      id: raw.id,
      title: raw.title,
      children: raw.children.map(parseNavNode),
    };
  }
  if (raw.kind === 'page') {
    for (const key of Object.keys(raw)) {
      if (!['kind', 'page_id', 'children'].includes(key)) {
        throw new Error(`unknown navigation field: ${key}`);
      }
    }
    if (typeof raw.page_id !== 'string' || !Array.isArray(raw.children)) {
      throw new Error('invalid page node');
    }
    return {
      kind: 'page',
      page_id: raw.page_id,
      children: raw.children.map(parseNavNode),
    };
  }
  throw new Error('invalid navigation node kind');
}

export function agentContentDigestDescriptor(input: {
  site: AgentManifestSite;
  pages: Omit<AgentManifestPage, never>[];
  index_sha256: string;
  all_sha256: string | null;
  assets: AgentManifestAsset[];
  attachments: AgentManifestAttachment[];
}): CanonicalJson {
  return {
    all_sha256: input.all_sha256,
    assets: input.assets.map((a) => ({
      id: a.id,
      media_type: a.media_type,
      path: a.path,
      sha256: a.sha256,
      size: a.size,
    })),
    attachments: input.attachments.map((a) => ({
      filename: a.filename,
      id: a.id,
      media_type: a.media_type,
      path: a.path,
      sha256: a.sha256,
      size: a.size,
    })),
    index_sha256: input.index_sha256,
    pages: input.pages.map((p) => ({
      human_route: p.human_route,
      id: p.id,
      markdown_path: p.markdown_path,
      markdown_sha256: p.markdown_sha256,
      markdown_size: p.markdown_size,
      next_id: p.next_id,
      order: p.order,
      previous_id: p.previous_id,
      title: p.title,
    })),
    site: {
      direction: input.site.direction,
      language: input.site.language,
      root_route: input.site.root_route,
      title: input.site.title,
    },
  };
}

export async function computeAgentContentDigest(input: {
  site: AgentManifestSite;
  pages: AgentManifestPage[];
  index_sha256: string;
  all_sha256: string | null;
  assets: AgentManifestAsset[];
  attachments: AgentManifestAttachment[];
}): Promise<string> {
  return artifactDigestFromDescriptor(agentContentDigestDescriptor(input));
}

export function serializeAgentManifest(manifest: AgentManifestV1): string {
  return canonicalizeJson(manifest as unknown as CanonicalJson);
}

export function serializeAgentManifestBytes(manifest: AgentManifestV1): Uint8Array {
  return canonicalizeJsonBytes(manifest as unknown as CanonicalJson);
}

export type ParseAgentManifestOptions = {
  verifyContentDigest?: boolean;
  indexSha256?: string;
  allSha256?: string | null;
};

export async function parseAgentManifestV1(
  raw: unknown,
  options: ParseAgentManifestOptions = {},
): Promise<AgentManifestV1> {
  if (!isPlainObject(raw)) throw new Error('agent manifest must be a JSON object');
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL.has(key)) throw new Error(`unknown agent manifest field: ${key}`);
  }
  for (const key of TOP_LEVEL) {
    if (!(key in raw)) throw new Error(`missing agent manifest field: ${key}`);
  }
  if (raw.schema_version !== 1) throw new Error('unsupported agent manifest schema_version');

  if (!isPlainObject(raw.site)) throw new Error('site must be an object');
  for (const key of Object.keys(raw.site)) {
    if (!['title', 'language', 'direction', 'root_route'].includes(key)) {
      throw new Error(`unknown site field: ${key}`);
    }
  }
  if (typeof raw.site.root_route !== 'string') throw new Error('root_route must be a string');
  assertPublicRoute(raw.site.root_route);
  const site: AgentManifestSite = {
    title: assertTitle(raw.site.title),
    language: assertLanguage(raw.site.language),
    direction: assertDirection(raw.site.direction),
    root_route: raw.site.root_route,
  };

  if (!isPlainObject(raw.publication)) throw new Error('publication must be an object');
  for (const key of Object.keys(raw.publication)) {
    if (!['content_digest', 'page_count', 'has_all_markdown', 'all_markdown_size'].includes(key)) {
      throw new Error(`unknown publication field: ${key}`);
    }
  }
  const content_digest = parseSha256Digest(raw.publication.content_digest);
  if (!content_digest) throw new Error('content_digest must be sha256:<hex>');
  if (typeof raw.publication.has_all_markdown !== 'boolean') {
    throw new Error('has_all_markdown must be boolean');
  }
  let all_markdown_size: number | null;
  if (raw.publication.has_all_markdown) {
    all_markdown_size = assertNonNegInt(raw.publication.all_markdown_size, 'all_markdown_size');
    if (all_markdown_size > AGENT_ALL_MD_MAX_BYTES) throw new Error('all.md exceeds 5 MiB');
  } else {
    if (raw.publication.all_markdown_size !== null) {
      throw new Error('all_markdown_size must be null when has_all_markdown is false');
    }
    all_markdown_size = null;
  }

  if (!Array.isArray(raw.pages) || !Array.isArray(raw.assets) || !Array.isArray(raw.attachments)) {
    throw new Error('pages, assets, and attachments must be arrays');
  }
  if (!Array.isArray(raw.navigation)) throw new Error('navigation must be an array');

  const page_count = assertNonNegInt(raw.publication.page_count, 'page_count');
  if (page_count !== raw.pages.length) throw new Error('page_count does not match pages');

  const pages: AgentManifestPage[] = raw.pages.map((p, i) => {
    if (!isPlainObject(p)) throw new Error(`pages[${i}] must be an object`);
    for (const key of Object.keys(p)) {
      if (
        ![
          'id',
          'title',
          'human_route',
          'markdown_path',
          'markdown_size',
          'markdown_sha256',
          'previous_id',
          'next_id',
          'order',
        ].includes(key)
      ) {
        throw new Error(`unknown pages[${i}] field: ${key}`);
      }
    }
    if (!isAgentHexId(p.id)) throw new Error(`pages[${i}].id invalid`);
    if (typeof p.human_route !== 'string' || typeof p.markdown_path !== 'string') {
      throw new Error(`pages[${i}] routes invalid`);
    }
    assertPublicRoute(p.human_route);
    assertMarkdownPath(p.markdown_path, p.id);
    const size = assertNonNegInt(p.markdown_size, `pages[${i}].markdown_size`);
    if (size > AGENT_PAGE_MARKDOWN_MAX_BYTES) throw new Error(`pages[${i}] exceeds 1 MiB`);
    const previous_id =
      p.previous_id === null ? null : isAgentHexId(p.previous_id) ? p.previous_id : null;
    if (p.previous_id !== null && previous_id === null)
      throw new Error(`pages[${i}].previous_id invalid`);
    const next_id = p.next_id === null ? null : isAgentHexId(p.next_id) ? p.next_id : null;
    if (p.next_id !== null && next_id === null) throw new Error(`pages[${i}].next_id invalid`);
    const order = assertNonNegInt(p.order, `pages[${i}].order`);
    if (order !== i) throw new Error(`pages[${i}].order must equal index`);
    return {
      id: p.id,
      title: assertTitle(p.title),
      human_route: p.human_route,
      markdown_path: p.markdown_path,
      markdown_size: size,
      markdown_sha256: assertHexSha256(p.markdown_sha256, `pages[${i}].markdown_sha256`),
      previous_id,
      next_id,
      order,
    };
  });

  const pageIds = pages.map((p) => p.id);
  if (new Set(pageIds).size !== pageIds.length) throw new Error('duplicate page id');
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const expectedPrev = i === 0 ? null : pages[i - 1]!.id;
    const expectedNext = i === pages.length - 1 ? null : pages[i + 1]!.id;
    if (p.previous_id !== expectedPrev || p.next_id !== expectedNext) {
      throw new Error('invalid previous/next relationship');
    }
  }

  const assets: AgentManifestAsset[] = raw.assets.map((a, i) => {
    if (!isPlainObject(a)) throw new Error(`assets[${i}] must be an object`);
    for (const key of Object.keys(a)) {
      if (!['id', 'path', 'media_type', 'size', 'sha256'].includes(key)) {
        throw new Error(`unknown assets[${i}] field: ${key}`);
      }
    }
    if (!isAgentHexId(a.id) || typeof a.path !== 'string' || typeof a.media_type !== 'string') {
      throw new Error(`assets[${i}] fields invalid`);
    }
    assertAgentRelativeRoute(a.path, 'assets');
    if (!a.path.startsWith(`assets/${a.id}/`)) throw new Error(`assets[${i}] path id mismatch`);
    const ext = normalizeExtension(a.path);
    if (!ext || !isImageExtension(ext) || isForbiddenWebExtension(ext)) {
      throw new Error(`assets[${i}] extension not allowed`);
    }
    if (a.media_type !== mediaTypeForExtension(ext))
      throw new Error(`assets[${i}] media_type mismatch`);
    const size = assertNonNegInt(a.size, `assets[${i}].size`);
    return {
      id: a.id,
      path: a.path,
      media_type: a.media_type,
      size,
      sha256: assertHexSha256(a.sha256, `assets[${i}].sha256`),
    };
  });

  const attachments: AgentManifestAttachment[] = raw.attachments.map((a, i) => {
    if (!isPlainObject(a)) throw new Error(`attachments[${i}] must be an object`);
    for (const key of Object.keys(a)) {
      if (!['id', 'path', 'media_type', 'filename', 'size', 'sha256'].includes(key)) {
        throw new Error(`unknown attachments[${i}] field: ${key}`);
      }
    }
    if (
      !isAgentHexId(a.id) ||
      typeof a.path !== 'string' ||
      typeof a.media_type !== 'string' ||
      typeof a.filename !== 'string'
    ) {
      throw new Error(`attachments[${i}] fields invalid`);
    }
    assertAgentRelativeRoute(a.path, 'attachments');
    if (!a.path.startsWith(`attachments/${a.id}/`))
      throw new Error(`attachments[${i}] path id mismatch`);
    if (a.filename.includes('/') || a.filename.includes('\\') || a.filename.includes('\0')) {
      throw new Error(`attachments[${i}] filename unsafe`);
    }
    const ext = normalizeExtension(a.filename);
    if (!ext || !isAttachmentExtension(ext) || isForbiddenWebExtension(ext)) {
      throw new Error(`attachments[${i}] extension not allowed`);
    }
    if (a.media_type !== mediaTypeForExtension(ext)) {
      throw new Error(`attachments[${i}] media_type mismatch`);
    }
    return {
      id: a.id,
      path: a.path,
      media_type: a.media_type,
      filename: a.filename,
      size: assertNonNegInt(a.size, `attachments[${i}].size`),
      sha256: assertHexSha256(a.sha256, `attachments[${i}].sha256`),
    };
  });

  const mediaIds = [...assets.map((a) => a.id), ...attachments.map((a) => a.id)];
  if (new Set(mediaIds).size !== mediaIds.length) throw new Error('duplicate media id');

  const navigation = raw.navigation.map(parseNavNode);
  await assertAgentNavigation(navigation, pageIds);

  const publication: AgentManifestPublication = {
    content_digest,
    page_count,
    has_all_markdown: raw.publication.has_all_markdown,
    all_markdown_size,
  };

  const manifest: AgentManifestV1 = {
    schema_version: 1,
    site,
    publication,
    pages,
    assets,
    attachments,
    navigation,
  };

  if (options.verifyContentDigest) {
    if (!options.indexSha256) throw new Error('index sha256 required to verify content digest');
    const expected = await computeAgentContentDigest({
      site,
      pages,
      index_sha256: options.indexSha256,
      all_sha256: options.allSha256 ?? null,
      assets,
      attachments,
    });
    if (expected !== content_digest) throw new Error('content_digest mismatch');
  }

  if (manifest.pages.length === 0) throw new Error('agent manifest requires at least one page');
  const encoded = serializeAgentManifestBytes(manifest);
  if (encoded.byteLength > AGENT_MANIFEST_JSON_MAX_BYTES) {
    throw new Error('agent manifest exceeds 1 MiB');
  }
  void AGENT_INDEX_MAX_BYTES;

  return manifest;
}
