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

export const MANIFEST_SCHEMA_VERSION = 1 as const;

export type ManifestRoot = { kind: 'page'; route: '/' } | { kind: 'redirect'; route: string };

export type ManifestPage = {
  route: string;
  object: string;
  title: string;
  size: number;
  sha256: string;
};

export type ManifestAsset = {
  path: string;
  object: string;
  media_type: string;
  size: number;
  sha256: string;
};

export type ManifestAttachment = {
  path: string;
  object: string;
  media_type: string;
  filename: string;
  size: number;
  sha256: string;
};

export type ManifestArtifact = {
  digest: string;
  file_count: number;
  uncompressed_size: number;
};

export type ManifestV1 = {
  schema_version: 1;
  site_id: SiteId;
  generator: { name: 'nrdocs'; version: string };
  site: {
    title: string;
    language: string;
    direction: Direction;
    root: ManifestRoot;
  };
  pages: ManifestPage[];
  assets: ManifestAsset[];
  attachments: ManifestAttachment[];
  artifact: ManifestArtifact;
};

const TOP_LEVEL = new Set([
  'schema_version',
  'site_id',
  'generator',
  'site',
  'pages',
  'assets',
  'attachments',
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

export type ParseManifestOptions = {
  /** When false, skip recomputing and comparing artifact.digest. Default true. */
  verifyArtifactDigest?: boolean;
};

export async function parseManifestV1(
  raw: unknown,
  options: ParseManifestOptions = {},
): Promise<ManifestV1> {
  if (!isPlainObject(raw)) throw new Error('manifest must be a JSON object');
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL.has(key)) throw new Error(`unknown manifest field: ${key}`);
  }
  for (const key of TOP_LEVEL) {
    if (!(key in raw)) throw new Error(`missing manifest field: ${key}`);
  }

  if (raw.schema_version !== 1) throw new Error('unsupported manifest schema_version');
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

  if (!Array.isArray(raw.pages)) throw new Error('pages must be an array');
  if (!Array.isArray(raw.assets)) throw new Error('assets must be an array');
  if (!Array.isArray(raw.attachments)) throw new Error('attachments must be an array');

  const pages: ManifestPage[] = raw.pages.map((p, i) => {
    if (!isPlainObject(p)) throw new Error(`pages[${i}] must be an object`);
    for (const key of Object.keys(p)) {
      if (!['route', 'object', 'title', 'size', 'sha256'].includes(key)) {
        throw new Error(`unknown pages[${i}] field: ${key}`);
      }
    }
    if (typeof p.route !== 'string' || typeof p.object !== 'string') {
      throw new Error(`pages[${i}] route/object invalid`);
    }
    assertPublicRoute(p.route);
    assertSafeObjectPath(p.object, 'pages/');
    return {
      route: p.route,
      object: p.object,
      title: assertTitle(p.title),
      size: assertNonNegInt(p.size, `pages[${i}].size`),
      sha256: assertHexSha256(p.sha256, `pages[${i}].sha256`),
    };
  });

  const assets: ManifestAsset[] = raw.assets.map((a, i) => {
    if (!isPlainObject(a)) throw new Error(`assets[${i}] must be an object`);
    for (const key of Object.keys(a)) {
      if (!['path', 'object', 'media_type', 'size', 'sha256'].includes(key)) {
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
    const expected = mediaTypeForExtension(ext);
    if (a.media_type !== expected) {
      throw new Error(`assets[${i}] media_type mismatch`);
    }
    return {
      path: a.path,
      object: a.object,
      media_type: a.media_type,
      size: assertNonNegInt(a.size, `assets[${i}].size`),
      sha256: assertHexSha256(a.sha256, `assets[${i}].sha256`),
    };
  });

  const attachments: ManifestAttachment[] = raw.attachments.map((a, i) => {
    if (!isPlainObject(a)) throw new Error(`attachments[${i}] must be an object`);
    for (const key of Object.keys(a)) {
      if (!['path', 'object', 'media_type', 'filename', 'size', 'sha256'].includes(key)) {
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
    const expected = mediaTypeForExtension(ext);
    if (a.media_type !== expected) {
      throw new Error(`attachments[${i}] media_type mismatch`);
    }
    return {
      path: a.path,
      object: a.object,
      media_type: a.media_type,
      filename: a.filename,
      size: assertNonNegInt(a.size, `attachments[${i}].size`),
      sha256: assertHexSha256(a.sha256, `attachments[${i}].sha256`),
    };
  });

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

  const expectedCount = pages.length + assets.length + attachments.length;
  if (file_count !== expectedCount) {
    throw new Error('artifact.file_count does not match payload entries');
  }
  const expectedSize =
    pages.reduce((s, p) => s + p.size, 0) +
    assets.reduce((s, a) => s + a.size, 0) +
    attachments.reduce((s, a) => s + a.size, 0);
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
    ...pages.map((p) => ({ collection: 'pages' as const, path: p.object })),
    ...assets.map((a) => ({ collection: 'assets' as const, path: a.object })),
    ...attachments.map((a) => ({ collection: 'attachments' as const, path: a.object })),
  ];
  if (findPathCollisions(publicEntries).length > 0) {
    throw new Error('manifest public path collision');
  }
  if (findPathCollisions(objectEntries).length > 0) {
    throw new Error('manifest object path collision');
  }

  const manifest: ManifestV1 = {
    schema_version: 1,
    site_id,
    generator,
    site: { title, language, direction, root },
    pages,
    assets,
    attachments,
    artifact: { digest, file_count, uncompressed_size },
  };

  if (options.verifyArtifactDigest !== false) {
    const expected = await computeArtifactDigest(manifest);
    if (expected !== digest) throw new Error('artifact.digest mismatch');
  }

  return manifest;
}

/** Manifest JSON shape with artifact.digest omitted for hashing. */
export function manifestDescriptorWithoutDigest(manifest: ManifestV1): CanonicalJson {
  return {
    schema_version: manifest.schema_version,
    site_id: manifest.site_id,
    generator: { ...manifest.generator },
    site: {
      title: manifest.site.title,
      language: manifest.site.language,
      direction: manifest.site.direction,
      root: { ...manifest.site.root },
    },
    pages: manifest.pages.map((p) => ({ ...p })),
    assets: manifest.assets.map((a) => ({ ...a })),
    attachments: manifest.attachments.map((a) => ({ ...a })),
    artifact: {
      file_count: manifest.artifact.file_count,
      uncompressed_size: manifest.artifact.uncompressed_size,
    },
  };
}

export async function computeArtifactDigest(manifest: ManifestV1): Promise<string> {
  return artifactDigestFromDescriptor(manifestDescriptorWithoutDigest(manifest));
}

export type ManifestDraft = Omit<ManifestV1, 'artifact'> & {
  artifact: Omit<ManifestArtifact, 'digest'>;
};

export async function sealManifest(draft: ManifestDraft): Promise<ManifestV1> {
  const descriptor: CanonicalJson = {
    schema_version: draft.schema_version,
    site_id: draft.site_id,
    generator: { ...draft.generator },
    site: {
      title: draft.site.title,
      language: draft.site.language,
      direction: draft.site.direction,
      root: { ...draft.site.root },
    },
    pages: draft.pages.map((p) => ({ ...p })),
    assets: draft.assets.map((a) => ({ ...a })),
    attachments: draft.attachments.map((a) => ({ ...a })),
    artifact: {
      file_count: draft.artifact.file_count,
      uncompressed_size: draft.artifact.uncompressed_size,
    },
  };
  const digest = await artifactDigestFromDescriptor(descriptor);
  return {
    ...draft,
    artifact: {
      digest,
      file_count: draft.artifact.file_count,
      uncompressed_size: draft.artifact.uncompressed_size,
    },
  };
}
