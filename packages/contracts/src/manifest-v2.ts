import type { CanonicalJson } from './canonical-json.js';
import { artifactDigestFromDescriptor, parseSha256Digest } from './digest.js';
import {
  isAttachmentExtension,
  isForbiddenWebExtension,
  isImageExtension,
  mediaTypeForExtension,
  normalizeExtension,
} from './extensions.js';
import { parseSiteId, type SiteId } from './ids.js';
import { assertDirection, assertLanguage, type Direction } from './language.js';
import { findPathCollisions, type PathEntry } from './path-collision.js';
import { assertTitle } from './title.js';
import type {
  ManifestArtifact,
  ManifestAttachment,
  ManifestAsset,
  ManifestRoot,
} from './manifest.js';
import type { ParseManifestOptions } from './manifest.js';
import {
  AGENT_ALL_MD_MAX_BYTES,
  AGENT_INDEX_MAX_BYTES,
  AGENT_MANIFEST_JSON_MAX_BYTES,
  AGENT_PAGE_MARKDOWN_MAX_BYTES,
} from './agent-limits.js';
import {
  assertAgentRelativeRoute,
  findAgentIdCollisions,
  findAgentRouteCollisions,
  isAgentHexId,
} from './agent-ids.js';

export const MANIFEST_SCHEMA_VERSION_V2 = 2 as const;
export const PAGE_SCHEMA_VERSION_V2 = 2 as const;
export const AGENT_DESCRIPTOR_SCHEMA_VERSION = 1 as const;

export type AgentMediaReference = {
  id: string;
  route: string;
};

export type ManifestAssetV2 = ManifestAsset & {
  agent: AgentMediaReference;
};

export type ManifestAttachmentV2 = ManifestAttachment & {
  agent: AgentMediaReference;
};

export type ManifestPageV2 = {
  id: string;
  route: string;
  title: string;
  html: {
    object: string;
    size: number;
    sha256: string;
  };
  markdown: {
    object: string;
    size: number;
    sha256: string;
  };
};

export type ManifestAgentFile = {
  object: string;
  size: number;
  sha256: string;
};

export type ManifestAgentV2 = {
  schema_version: 1;
  index: ManifestAgentFile;
  manifest: ManifestAgentFile;
  all: null | ManifestAgentFile;
};

export type ManifestV2 = {
  schema_version: 2;
  page_schema_version: 2;
  site_id: SiteId;
  generator: { name: 'nrdocs'; version: string };
  site: {
    title: string;
    language: string;
    direction: Direction;
    root: ManifestRoot;
  };
  pages: ManifestPageV2[];
  assets: ManifestAssetV2[];
  attachments: ManifestAttachmentV2[];
  agent: ManifestAgentV2;
  artifact: ManifestArtifact;
};

const TOP_LEVEL = new Set([
  'schema_version',
  'page_schema_version',
  'site_id',
  'generator',
  'site',
  'pages',
  'assets',
  'attachments',
  'agent',
  'artifact',
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

function assertSafeObjectPath(path: string, prefix: string): void {
  if (!path.startsWith(prefix)) throw new Error(`object path must start with ${prefix}`);
  if (path.includes('\\') || path.includes('\0')) throw new Error('unsafe object path');
  const parts = path.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new Error('unsafe object path segments');
  }
}

function assertPublicRoute(route: string): void {
  if (!route.startsWith('/') || !route.endsWith('/')) {
    throw new Error('page route must have leading and trailing slashes');
  }
  if (route.includes('\\') || route.includes('\0') || route.includes('//')) {
    throw new Error('unsafe page route');
  }
  const body = route.slice(1, -1);
  if (body.split('/').some((p) => p === '.' || p === '..')) {
    throw new Error('unsafe page route segments');
  }
}

function assertPublicPath(path: string): void {
  if (!path.startsWith('/') || path.endsWith('/')) {
    throw new Error('asset/attachment path must start with / and not end with /');
  }
  if (path.includes('\\') || path.includes('\0') || path.includes('//')) {
    throw new Error('unsafe public path');
  }
  if (path.split('/').some((p) => p === '.' || p === '..')) {
    throw new Error('unsafe public path segments');
  }
}

function assertSemver(version: unknown): string {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('generator.version must be a semver X.Y.Z string');
  }
  return version;
}

function parseAgentFile(raw: unknown, expectedObject: string, maxBytes: number): ManifestAgentFile {
  if (!isPlainObject(raw)) throw new Error('agent file must be an object');
  for (const key of Object.keys(raw)) {
    if (!['object', 'size', 'sha256'].includes(key)) throw new Error('unknown agent file field');
  }
  if (typeof raw.object !== 'string' || raw.object !== expectedObject) {
    throw new Error(`agent object must be ${expectedObject}`);
  }
  const size = assertNonNegInt(raw.size, 'agent file size');
  if (size > maxBytes) throw new Error('agent file exceeds size limit');
  return {
    object: raw.object,
    size,
    sha256: assertHexSha256(raw.sha256, 'agent file sha256'),
  };
}

export async function parseManifestV2(
  raw: unknown,
  options: ParseManifestOptions = {},
): Promise<ManifestV2> {
  if (!isPlainObject(raw)) throw new Error('manifest must be a JSON object');
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL.has(key)) throw new Error(`unknown manifest field: ${key}`);
  }
  for (const key of TOP_LEVEL) {
    if (!(key in raw)) throw new Error(`missing manifest field: ${key}`);
  }

  if (raw.schema_version !== 2) throw new Error('unsupported manifest schema_version');
  if (raw.page_schema_version !== 2) throw new Error('unsupported page_schema_version');
  const site_id = parseSiteId(raw.site_id);
  if (!site_id) throw new Error('invalid site_id');

  if (!isPlainObject(raw.generator)) throw new Error('generator must be an object');
  for (const key of Object.keys(raw.generator)) {
    if (key !== 'name' && key !== 'version') throw new Error(`unknown generator field: ${key}`);
  }
  if (raw.generator.name !== 'nrdocs') throw new Error('generator.name must be nrdocs');
  const generator = {
    name: 'nrdocs' as const,
    version: assertSemver(raw.generator.version),
  };

  if (!isPlainObject(raw.site)) throw new Error('site must be an object');
  for (const key of Object.keys(raw.site)) {
    if (!['title', 'language', 'direction', 'root'].includes(key)) {
      throw new Error(`unknown site field: ${key}`);
    }
  }
  const title = assertTitle(raw.site.title);
  const language = assertLanguage(raw.site.language);
  const direction = assertDirection(raw.site.direction);
  if (!isPlainObject(raw.site.root)) throw new Error('site.root must be an object');
  const rootKind = raw.site.root.kind;
  const rootRoute = raw.site.root.route;
  if (typeof rootRoute !== 'string') throw new Error('site.root.route must be a string');
  let root: ManifestRoot;
  if (rootKind === 'page') {
    if (rootRoute !== '/') throw new Error('page root route must be /');
    root = { kind: 'page', route: '/' };
  } else if (rootKind === 'redirect') {
    assertPublicRoute(rootRoute);
    if (rootRoute === '/') throw new Error('redirect root must not be /');
    root = { kind: 'redirect', route: rootRoute };
  } else {
    throw new Error('site.root.kind must be page or redirect');
  }

  if (!Array.isArray(raw.pages) || !Array.isArray(raw.assets) || !Array.isArray(raw.attachments)) {
    throw new Error('pages, assets, and attachments must be arrays');
  }

  const pages: ManifestPageV2[] = raw.pages.map((p, i) => {
    if (!isPlainObject(p)) throw new Error(`pages[${i}] must be an object`);
    for (const key of Object.keys(p)) {
      if (!['id', 'route', 'title', 'html', 'markdown'].includes(key)) {
        throw new Error(`unknown pages[${i}] field: ${key}`);
      }
    }
    if (!isAgentHexId(p.id) || typeof p.route !== 'string') {
      throw new Error(`pages[${i}] id/route invalid`);
    }
    assertPublicRoute(p.route);
    if (!isPlainObject(p.html) || !isPlainObject(p.markdown)) {
      throw new Error(`pages[${i}] html/markdown invalid`);
    }
    for (const key of Object.keys(p.html)) {
      if (!['object', 'size', 'sha256'].includes(key)) throw new Error('unknown html field');
    }
    for (const key of Object.keys(p.markdown)) {
      if (!['object', 'size', 'sha256'].includes(key)) throw new Error('unknown markdown field');
    }
    if (typeof p.html.object !== 'string' || typeof p.markdown.object !== 'string') {
      throw new Error(`pages[${i}] object paths invalid`);
    }
    assertSafeObjectPath(p.html.object, 'pages/');
    if (p.markdown.object !== `agent/pages/${p.id}.md`) {
      throw new Error(`pages[${i}] markdown object path invalid`);
    }
    const mdSize = assertNonNegInt(p.markdown.size, `pages[${i}].markdown.size`);
    if (mdSize > AGENT_PAGE_MARKDOWN_MAX_BYTES)
      throw new Error(`pages[${i}] markdown exceeds 1 MiB`);
    return {
      id: p.id,
      route: p.route,
      title: assertTitle(p.title),
      html: {
        object: p.html.object,
        size: assertNonNegInt(p.html.size, `pages[${i}].html.size`),
        sha256: assertHexSha256(p.html.sha256, `pages[${i}].html.sha256`),
      },
      markdown: {
        object: p.markdown.object,
        size: mdSize,
        sha256: assertHexSha256(p.markdown.sha256, `pages[${i}].markdown.sha256`),
      },
    };
  });

  if (findAgentIdCollisions(pages.map((p) => p.id)).length > 0) {
    throw new Error('duplicate page id');
  }

  const parseAgentRef = (
    rawAgent: unknown,
    kind: 'assets' | 'attachments',
  ): AgentMediaReference => {
    if (!isPlainObject(rawAgent)) throw new Error('agent reference must be an object');
    for (const key of Object.keys(rawAgent)) {
      if (!['id', 'route'].includes(key)) throw new Error('unknown agent reference field');
    }
    if (!isAgentHexId(rawAgent.id) || typeof rawAgent.route !== 'string') {
      throw new Error('agent reference invalid');
    }
    assertAgentRelativeRoute(rawAgent.route, kind);
    if (!rawAgent.route.startsWith(`${kind}/${rawAgent.id}/`)) {
      throw new Error('agent route id mismatch');
    }
    return { id: rawAgent.id, route: rawAgent.route };
  };

  const assets: ManifestAssetV2[] = raw.assets.map((a, i) => {
    if (!isPlainObject(a)) throw new Error(`assets[${i}] must be an object`);
    for (const key of Object.keys(a)) {
      if (!['path', 'object', 'media_type', 'size', 'sha256', 'agent'].includes(key)) {
        throw new Error(`unknown assets[${i}] field: ${key}`);
      }
    }
    if (
      typeof a.path !== 'string' ||
      typeof a.object !== 'string' ||
      typeof a.media_type !== 'string'
    ) {
      throw new Error(`assets[${i}] fields invalid`);
    }
    assertPublicPath(a.path);
    assertSafeObjectPath(a.object, 'assets/');
    const ext = normalizeExtension(a.path);
    if (!ext || !isImageExtension(ext) || isForbiddenWebExtension(ext)) {
      throw new Error(`assets[${i}] extension not allowed`);
    }
    if (a.media_type !== mediaTypeForExtension(ext)) {
      throw new Error(`assets[${i}] media_type mismatch`);
    }
    return {
      path: a.path,
      object: a.object,
      media_type: a.media_type,
      size: assertNonNegInt(a.size, `assets[${i}].size`),
      sha256: assertHexSha256(a.sha256, `assets[${i}].sha256`),
      agent: parseAgentRef(a.agent, 'assets'),
    };
  });

  const attachments: ManifestAttachmentV2[] = raw.attachments.map((a, i) => {
    if (!isPlainObject(a)) throw new Error(`attachments[${i}] must be an object`);
    for (const key of Object.keys(a)) {
      if (!['path', 'object', 'media_type', 'filename', 'size', 'sha256', 'agent'].includes(key)) {
        throw new Error(`unknown attachments[${i}] field: ${key}`);
      }
    }
    if (
      typeof a.path !== 'string' ||
      typeof a.object !== 'string' ||
      typeof a.media_type !== 'string' ||
      typeof a.filename !== 'string'
    ) {
      throw new Error(`attachments[${i}] fields invalid`);
    }
    assertPublicPath(a.path);
    assertSafeObjectPath(a.object, 'attachments/');
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
      path: a.path,
      object: a.object,
      media_type: a.media_type,
      filename: a.filename,
      size: assertNonNegInt(a.size, `attachments[${i}].size`),
      sha256: assertHexSha256(a.sha256, `attachments[${i}].sha256`),
      agent: parseAgentRef(a.agent, 'attachments'),
    };
  });

  const mediaIds = [...assets.map((a) => a.agent.id), ...attachments.map((a) => a.agent.id)];
  if (findAgentIdCollisions(mediaIds).length > 0) throw new Error('duplicate agent media id');
  const agentRoutes = [
    ...assets.map((a) => a.agent.route),
    ...attachments.map((a) => a.agent.route),
  ];
  if (findAgentRouteCollisions(agentRoutes).length > 0) throw new Error('agent route collision');

  if (!isPlainObject(raw.agent)) throw new Error('agent must be an object');
  for (const key of Object.keys(raw.agent)) {
    if (!['schema_version', 'index', 'manifest', 'all'].includes(key)) {
      throw new Error(`unknown agent field: ${key}`);
    }
  }
  if (raw.agent.schema_version !== 1) throw new Error('unsupported agent schema_version');
  const index = parseAgentFile(raw.agent.index, 'agent/index.md', AGENT_INDEX_MAX_BYTES);
  const agentManifest = parseAgentFile(
    raw.agent.manifest,
    'agent/manifest.json',
    AGENT_MANIFEST_JSON_MAX_BYTES,
  );
  let all: ManifestAgentFile | null = null;
  if (raw.agent.all !== null) {
    all = parseAgentFile(raw.agent.all, 'agent/all.md', AGENT_ALL_MD_MAX_BYTES);
  }

  if (!isPlainObject(raw.artifact)) throw new Error('artifact must be an object');
  for (const key of Object.keys(raw.artifact)) {
    if (!['digest', 'file_count', 'uncompressed_size'].includes(key)) {
      throw new Error(`unknown artifact field: ${key}`);
    }
  }
  const digest = parseSha256Digest(raw.artifact.digest);
  if (!digest) throw new Error('artifact.digest must be sha256:<hex>');
  const file_count = assertNonNegInt(raw.artifact.file_count, 'artifact.file_count');
  const uncompressed_size = assertNonNegInt(
    raw.artifact.uncompressed_size,
    'artifact.uncompressed_size',
  );

  const extraAgentFiles = 2 + (all ? 1 : 0);
  const expectedCount = pages.length * 2 + assets.length + attachments.length + extraAgentFiles;
  if (file_count !== expectedCount) {
    throw new Error('artifact.file_count does not match payload entries');
  }
  const expectedSize =
    pages.reduce((s, p) => s + p.html.size + p.markdown.size, 0) +
    assets.reduce((s, a) => s + a.size, 0) +
    attachments.reduce((s, a) => s + a.size, 0) +
    index.size +
    agentManifest.size +
    (all ? all.size : 0);
  if (uncompressed_size !== expectedSize) {
    throw new Error('artifact.uncompressed_size does not match payload sizes');
  }

  if (root.kind === 'redirect') {
    if (!pages.some((p) => p.route === root.route)) {
      throw new Error('redirect root must name an existing page');
    }
  } else if (!pages.some((p) => p.route === '/')) {
    throw new Error('page root requires a / page');
  }

  const publicEntries: PathEntry[] = [
    ...pages.map((p) => ({ collection: 'pages' as const, path: p.route })),
    ...assets.map((a) => ({ collection: 'assets' as const, path: a.path })),
    ...attachments.map((a) => ({ collection: 'attachments' as const, path: a.path })),
  ];
  const objectEntries: PathEntry[] = [
    ...pages.map((p) => ({ collection: 'pages' as const, path: p.html.object })),
    ...pages.map((p) => ({ collection: 'pages' as const, path: p.markdown.object })),
    ...assets.map((a) => ({ collection: 'assets' as const, path: a.object })),
    ...attachments.map((a) => ({ collection: 'attachments' as const, path: a.object })),
    { collection: 'pages', path: index.object },
    { collection: 'pages', path: agentManifest.object },
    ...(all ? [{ collection: 'pages' as const, path: all.object }] : []),
  ];
  if (findPathCollisions(publicEntries).length > 0) {
    throw new Error('manifest public path collision');
  }
  if (findPathCollisions(objectEntries).length > 0) {
    throw new Error('manifest object path collision');
  }

  const manifest: ManifestV2 = {
    schema_version: 2,
    page_schema_version: 2,
    site_id,
    generator,
    site: { title, language, direction, root },
    pages,
    assets,
    attachments,
    agent: { schema_version: 1, index, manifest: agentManifest, all },
    artifact: { digest, file_count, uncompressed_size },
  };

  if (options.verifyArtifactDigest !== false) {
    const expected = await computeArtifactDigestV2(manifest);
    if (expected !== digest) throw new Error('artifact.digest mismatch');
  }

  return manifest;
}

export function manifestV2DescriptorWithoutDigest(manifest: ManifestV2): CanonicalJson {
  return {
    schema_version: manifest.schema_version,
    page_schema_version: manifest.page_schema_version,
    site_id: manifest.site_id,
    generator: { ...manifest.generator },
    site: {
      title: manifest.site.title,
      language: manifest.site.language,
      direction: manifest.site.direction,
      root: { ...manifest.site.root },
    },
    pages: manifest.pages.map((p) => ({
      id: p.id,
      route: p.route,
      title: p.title,
      html: { ...p.html },
      markdown: { ...p.markdown },
    })),
    assets: manifest.assets.map((a) => ({
      path: a.path,
      object: a.object,
      media_type: a.media_type,
      size: a.size,
      sha256: a.sha256,
      agent: { ...a.agent },
    })),
    attachments: manifest.attachments.map((a) => ({
      path: a.path,
      object: a.object,
      media_type: a.media_type,
      filename: a.filename,
      size: a.size,
      sha256: a.sha256,
      agent: { ...a.agent },
    })),
    agent: {
      schema_version: manifest.agent.schema_version,
      index: { ...manifest.agent.index },
      manifest: { ...manifest.agent.manifest },
      all: manifest.agent.all ? { ...manifest.agent.all } : null,
    },
    artifact: {
      file_count: manifest.artifact.file_count,
      uncompressed_size: manifest.artifact.uncompressed_size,
    },
  };
}

export async function computeArtifactDigestV2(manifest: ManifestV2): Promise<string> {
  return artifactDigestFromDescriptor(manifestV2DescriptorWithoutDigest(manifest));
}

export type ManifestDraftV2 = Omit<ManifestV2, 'artifact'> & {
  artifact: Omit<ManifestArtifact, 'digest'>;
};

export async function sealManifestV2(draft: ManifestDraftV2): Promise<ManifestV2> {
  const withPlaceholder: ManifestV2 = {
    ...draft,
    artifact: {
      digest: 'sha256:' + '0'.repeat(64),
      file_count: draft.artifact.file_count,
      uncompressed_size: draft.artifact.uncompressed_size,
    },
  };
  const digest = await computeArtifactDigestV2(withPlaceholder);
  return {
    ...draft,
    artifact: {
      digest,
      file_count: draft.artifact.file_count,
      uncompressed_size: draft.artifact.uncompressed_size,
    },
  };
}

export function isManifestV2(manifest: { schema_version: number }): manifest is ManifestV2 {
  return manifest.schema_version === 2;
}
