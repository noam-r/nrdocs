import path from 'node:path';
import fsp from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { assertContainedRealPath, isRealFile, toPosix } from '../paths.js';
import { OpenApiError } from './errors.js';
import {
  OPENAPI_ENTRY_MAX_BYTES,
  OPENAPI_MAX_DEPENDENCY_FILES,
  OPENAPI_MAX_PARSED_NODES,
  OPENAPI_MAX_REF_DEPTH,
  OPENAPI_SCHEMA_ID_RE,
  OPENAPI_TOTAL_SOURCE_MAX_BYTES,
} from './limits.js';

export type LoadedOpenApiFile = {
  relativePath: string;
  absolutePath: string;
  bytes: Uint8Array;
  text: string;
  document: unknown;
};

export type LoadedOpenApi = {
  rootDir: string;
  entryPath: string;
  files: Map<string, LoadedOpenApiFile>;
  /**
   * Document with local file `$ref` targets hoisted into `components` and rewritten
   * to `#/components/...` refs. Entry-document internal `#/...` refs are preserved.
   */
  document: unknown;
  sourcePaths: Set<string>;
  totalBytes: number;
  parsedNodeCount: number;
};

type HoistCategory =
  | 'schemas'
  | 'parameters'
  | 'responses'
  | 'requestBodies'
  | 'headers'
  | 'securitySchemes';

type HoistRegistry = {
  /** Same `file#pointer` identity → same component placement. */
  byIdentity: Map<string, { category: HoistCategory; key: string }>;
  /** Values stored once under components[category][key]. */
  components: Record<string, Record<string, unknown>>;
};

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function decodeUtf8(bytes: Uint8Array, sourceFile: string): string {
  let offset = 0;
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === UTF8_BOM[0] &&
    bytes[1] === UTF8_BOM[1] &&
    bytes[2] === UTF8_BOM[2]
  ) {
    offset = 3;
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text: string;
  try {
    text = decoder.decode(bytes.subarray(offset));
  } catch {
    throw new OpenApiError(
      'openapi_invalid_document',
      `OpenAPI file is not valid UTF-8:\n  ${sourceFile}`,
      {
        sourceFile,
      },
    );
  }
  if (text.includes('\uFEFF')) {
    throw new OpenApiError(
      'openapi_invalid_document',
      `OpenAPI file contains an invalid UTF-8 BOM:\n  ${sourceFile}`,
      { sourceFile },
    );
  }
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function parseDocument(text: string, sourceFile: string): unknown {
  const trimmed = text.trimStart();
  try {
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return JSON.parse(text) as unknown;
    }
    return parseYaml(text, { uniqueKeys: true }) as unknown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new OpenApiError(
      'openapi_invalid_document',
      `OpenAPI document is malformed YAML/JSON:\n  ${sourceFile}\n  ${msg}`,
      { sourceFile },
    );
  }
}

function countNodes(value: unknown, counter: { n: number }): void {
  if (counter.n > OPENAPI_MAX_PARSED_NODES) {
    throw new OpenApiError(
      'openapi_limit_exceeded',
      `OpenAPI parsed node count exceeds ${OPENAPI_MAX_PARSED_NODES}`,
    );
  }
  counter.n += 1;
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) countNodes(item, counter);
    return;
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    countNodes(v, counter);
  }
}

function isRemoteRef(ref: string): boolean {
  if (ref.startsWith('#') || ref.startsWith('#/')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref)) return true;
  if (ref.startsWith('//')) return true;
  return false;
}

function splitRef(ref: string): { filePart: string; pointer: string } {
  const hash = ref.indexOf('#');
  if (hash < 0) return { filePart: ref, pointer: '' };
  return { filePart: ref.slice(0, hash), pointer: ref.slice(hash + 1) };
}

function decodePointerToken(token: string): string {
  return decodeURIComponent(token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function getJsonPointer(doc: unknown, pointer: string): unknown {
  if (!pointer || pointer === '/') return doc;
  const raw = pointer.startsWith('/') ? pointer.slice(1) : pointer;
  if (raw.length === 0) return doc;
  const parts = raw.split('/').map(decodePointerToken);
  let cur: unknown = doc;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') {
      return undefined;
    }
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined;
      cur = cur[idx];
    } else {
      const obj = cur as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(obj, part)) return undefined;
      cur = obj[part];
    }
  }
  return cur;
}

function normalizeSpecPath(specification: string): string {
  const posix = toPosix(specification);
  if (
    !posix ||
    posix.startsWith('/') ||
    posix.includes('\\') ||
    posix.split('/').some((p) => p === '' || p === '.' || p === '..')
  ) {
    throw new OpenApiError(
      'openapi_ref_resolution',
      `OpenAPI specification path is unsafe:\n  ${specification}`,
      { sourceFile: specification },
    );
  }
  return posix;
}

async function loadFile(
  rootDir: string,
  relativePath: string,
  files: Map<string, LoadedOpenApiFile>,
  totals: { bytes: number },
): Promise<LoadedOpenApiFile> {
  const existing = files.get(relativePath);
  if (existing) return existing;

  if (files.size >= OPENAPI_MAX_DEPENDENCY_FILES + 1) {
    throw new OpenApiError(
      'openapi_limit_exceeded',
      `OpenAPI dependency file count exceeds ${OPENAPI_MAX_DEPENDENCY_FILES}`,
      { sourceFile: relativePath },
    );
  }

  let abs: string;
  try {
    abs = await assertContainedRealPath(rootDir, relativePath, 'OpenAPI source');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new OpenApiError('openapi_ref_resolution', msg, { sourceFile: relativePath });
  }

  if (!(await isRealFile(abs))) {
    throw new OpenApiError(
      'openapi_ref_resolution',
      `OpenAPI source is not a regular file:\n  ${relativePath}`,
      { sourceFile: relativePath },
    );
  }

  const buf = await fsp.readFile(abs);
  const bytes = new Uint8Array(buf);
  totals.bytes += bytes.byteLength;
  if (totals.bytes > OPENAPI_TOTAL_SOURCE_MAX_BYTES) {
    throw new OpenApiError(
      'openapi_limit_exceeded',
      `Total OpenAPI source bytes exceed ${OPENAPI_TOTAL_SOURCE_MAX_BYTES}`,
      { sourceFile: relativePath },
    );
  }

  const text = decodeUtf8(bytes, relativePath);
  const document = parseDocument(text, relativePath);
  const loaded: LoadedOpenApiFile = {
    relativePath,
    absolutePath: abs,
    bytes,
    text,
    document,
  };
  files.set(relativePath, loaded);
  return loaded;
}

function resolveRelativeFile(fromFile: string, refPath: string): string {
  if (refPath.startsWith('/')) {
    throw new OpenApiError(
      'openapi_ref_resolution',
      `OpenAPI $ref escapes the publication root:\n  ${refPath}`,
      { sourceFile: fromFile },
    );
  }
  const fromDir = path.posix.dirname(fromFile);
  const joined = toPosix(
    path.posix.normalize(fromDir === '.' ? refPath : path.posix.join(fromDir, refPath)),
  );
  if (
    joined.startsWith('../') ||
    joined === '..' ||
    joined.split('/').some((p) => p === '..' || p === '')
  ) {
    throw new OpenApiError(
      'openapi_ref_resolution',
      `OpenAPI $ref escapes the publication root:\n  ${refPath}`,
      { sourceFile: fromFile },
    );
  }
  return joined;
}

type ResolveCtx = {
  rootDir: string;
  entryPath: string;
  files: Map<string, LoadedOpenApiFile>;
  totals: { bytes: number };
  stack: string[];
  depth: number;
  hoist: HoistRegistry;
};

function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function rejectRefSiblings(
  sibling: Record<string, unknown>,
  currentFile: string,
  pointer: string,
): void {
  const keys = Object.keys(sibling).filter((k) => k !== '$ref');
  if (keys.length > 0) {
    throw new OpenApiError(
      'openapi_invalid_document',
      `OpenAPI $ref siblings are not supported:\n  ${pointer}`,
      { sourceFile: currentFile, pointer },
    );
  }
}

/** Sanitize an arbitrary string into a portable OpenAPI component id. */
function sanitizeComponentKey(raw: string, loc: { sourceFile: string; pointer: string }): string {
  let key = raw.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!/^[A-Za-z]/.test(key)) {
    key = `C_${key}`;
  }
  if (key.length > 128) {
    key = key.slice(0, 128);
  }
  if (!OPENAPI_SCHEMA_ID_RE.test(key)) {
    throw new OpenApiError(
      'openapi_schema_id',
      `Cannot derive a valid component id from file $ref target:\n  ${raw}`,
      loc,
    );
  }
  return key;
}

function parseComponentsPointer(
  pointerPath: string,
): { category: HoistCategory; name: string } | null {
  const m = pointerPath.match(
    /^\/components\/(schemas|parameters|responses|requestBodies|headers|securitySchemes)\/([^/]+)$/,
  );
  if (!m) return null;
  return { category: m[1] as HoistCategory, name: decodePointerToken(m[2]!) };
}

function chooseHoistPlacement(
  targetFile: string,
  pointerPath: string,
  loc: { sourceFile: string; pointer: string },
): { category: HoistCategory; key: string } {
  const parsed = parseComponentsPointer(pointerPath);
  if (parsed) {
    if (OPENAPI_SCHEMA_ID_RE.test(parsed.name)) {
      return { category: parsed.category, key: parsed.name };
    }
    return {
      category: parsed.category,
      key: sanitizeComponentKey(parsed.name, loc),
    };
  }
  const raw = `${targetFile}${pointerPath || ''}`;
  return {
    category: 'schemas',
    key: sanitizeComponentKey(raw, loc),
  };
}

function allocateHoistKey(
  hoist: HoistRegistry,
  category: HoistCategory,
  preferredKey: string,
  identity: string,
): string {
  const existing = hoist.byIdentity.get(identity);
  if (existing) return existing.key;

  const bucket = hoist.components[category] ?? (hoist.components[category] = {});
  let key = preferredKey;
  if (Object.prototype.hasOwnProperty.call(bucket, key)) {
    // Different identity colliding on the preferred name — disambiguate.
    let n = 2;
    while (Object.prototype.hasOwnProperty.call(bucket, `${preferredKey}_${n}`)) {
      n += 1;
    }
    key = `${preferredKey}_${n}`;
    if (!OPENAPI_SCHEMA_ID_RE.test(key)) {
      key = sanitizeComponentKey(key, { sourceFile: identity, pointer: '' });
    }
  }
  hoist.byIdentity.set(identity, { category, key });
  return key;
}

function mergeHoistedComponents(document: unknown, hoist: HoistRegistry): unknown {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return document;
  }
  const doc = { ...(document as Record<string, unknown>) };
  const existing =
    doc.components !== null && typeof doc.components === 'object' && !Array.isArray(doc.components)
      ? { ...(doc.components as Record<string, unknown>) }
      : {};

  for (const category of Object.keys(hoist.components)) {
    const hoisted = hoist.components[category]!;
    const prior =
      existing[category] !== null &&
      typeof existing[category] === 'object' &&
      !Array.isArray(existing[category])
        ? { ...(existing[category] as Record<string, unknown>) }
        : {};
    for (const [key, value] of Object.entries(hoisted)) {
      if (Object.prototype.hasOwnProperty.call(prior, key) && prior[key] !== value) {
        throw new OpenApiError(
          'openapi_ref_resolution',
          `Hoisted component collides with existing components.${category}.${key}`,
          { pointer: `/components/${category}/${key}` },
        );
      }
      prior[key] = value;
    }
    existing[category] = prior;
  }
  doc.components = existing;
  return doc;
}

async function resolveValue(
  value: unknown,
  currentFile: string,
  ctx: ResolveCtx,
  pointer: string,
): Promise<unknown> {
  if (ctx.depth > OPENAPI_MAX_REF_DEPTH) {
    throw new OpenApiError(
      'openapi_limit_exceeded',
      `$ref resolution depth exceeds ${OPENAPI_MAX_REF_DEPTH}`,
      { sourceFile: currentFile, pointer },
    );
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      out.push(await resolveValue(value[i], currentFile, ctx, `${pointer}/${i}`));
    }
    return out;
  }

  const obj = value as Record<string, unknown>;
  if (typeof obj.$ref === 'string') {
    return resolveRef(obj.$ref, currentFile, ctx, pointer, obj);
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = await resolveValue(v, currentFile, ctx, `${pointer}/${escapePointerToken(k)}`);
  }
  return out;
}

async function hoistFileRefTarget(
  target: unknown,
  targetFile: string,
  pointerPath: string,
  identity: string,
  currentFile: string,
  ctx: ResolveCtx,
  pointer: string,
): Promise<{ $ref: string }> {
  const existing = ctx.hoist.byIdentity.get(identity);
  if (existing) {
    return { $ref: `#/components/${existing.category}/${existing.key}` };
  }

  ctx.stack.push(identity);
  ctx.depth += 1;
  try {
    const resolved = await resolveValue(target, targetFile, ctx, pointerPath || '/');
    const placement = chooseHoistPlacement(targetFile, pointerPath, {
      sourceFile: currentFile,
      pointer,
    });
    const key = allocateHoistKey(ctx.hoist, placement.category, placement.key, identity);
    const bucket =
      ctx.hoist.components[placement.category] ?? (ctx.hoist.components[placement.category] = {});
    // Only store on first allocation; allocateHoistKey already recorded identity.
    if (!Object.prototype.hasOwnProperty.call(bucket, key)) {
      bucket[key] = resolved;
    }
    return { $ref: `#/components/${placement.category}/${key}` };
  } finally {
    ctx.stack.pop();
    ctx.depth -= 1;
  }
}

async function resolveRef(
  ref: string,
  currentFile: string,
  ctx: ResolveCtx,
  pointer: string,
  sibling: Record<string, unknown>,
): Promise<unknown> {
  if (isRemoteRef(ref)) {
    throw new OpenApiError('openapi_remote_ref', `Remote OpenAPI $ref is not allowed:\n  ${ref}`, {
      sourceFile: currentFile,
      pointer,
    });
  }

  rejectRefSiblings(sibling, currentFile, pointer);

  const { filePart, pointer: frag } = splitRef(ref);
  let targetFile = currentFile;
  let targetDoc: unknown;
  const isFileRef = filePart.length > 0;

  if (isFileRef) {
    targetFile = resolveRelativeFile(currentFile, filePart);
    const loaded = await loadFile(ctx.rootDir, targetFile, ctx.files, ctx.totals);
    targetDoc = loaded.document;
  } else {
    targetDoc = ctx.files.get(currentFile)!.document;
  }

  const pointerPath = frag.startsWith('/') ? frag : frag ? `/${frag}` : '';
  const identity = `${targetFile}#${pointerPath}`;
  if (ctx.stack.includes(identity)) {
    throw new OpenApiError(
      'openapi_ref_resolution',
      `OpenAPI $ref cycle detected:\n  ${identity}`,
      { sourceFile: currentFile, pointer },
    );
  }

  const target = pointerPath ? getJsonPointer(targetDoc, pointerPath) : targetDoc;
  if (target === undefined) {
    throw new OpenApiError(
      'openapi_ref_resolution',
      `OpenAPI $ref target was not found:\n  ${ref}`,
      { sourceFile: currentFile, pointer },
    );
  }

  // Entry-document internal refs stay as $ref for schema identity.
  // Dependency-file internal refs are hoisted (same as file refs) so targets
  // remain reachable after merge into the entry document.
  if (!isFileRef && currentFile === ctx.entryPath) {
    return { $ref: ref.startsWith('#') ? ref : `#${pointerPath || ''}` };
  }

  return hoistFileRefTarget(target, targetFile, pointerPath, identity, currentFile, ctx, pointer);
}

/**
 * Load the OpenAPI entry document and resolve local file `$ref` values only.
 * Remote refs, symlinks, path escape, cycles, and size limits fail closed.
 * File `$ref` targets are hoisted into `components` and rewritten to `#/components/...`.
 */
export async function loadOpenApi(rootDir: string, specification: string): Promise<LoadedOpenApi> {
  const entryPath = normalizeSpecPath(specification);
  const files = new Map<string, LoadedOpenApiFile>();
  const totals = { bytes: 0 };

  let abs: string;
  try {
    abs = await assertContainedRealPath(rootDir, entryPath, 'OpenAPI specification');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new OpenApiError('openapi_ref_resolution', msg, { sourceFile: entryPath });
  }
  if (!(await isRealFile(abs))) {
    throw new OpenApiError(
      'openapi_ref_resolution',
      `OpenAPI specification is not a regular file:\n  ${entryPath}`,
      { sourceFile: entryPath },
    );
  }

  const buf = await fsp.readFile(abs);
  const bytes = new Uint8Array(buf);
  if (bytes.byteLength > OPENAPI_ENTRY_MAX_BYTES) {
    throw new OpenApiError(
      'openapi_limit_exceeded',
      `OpenAPI entry file exceeds ${OPENAPI_ENTRY_MAX_BYTES} bytes`,
      { sourceFile: entryPath },
    );
  }
  totals.bytes += bytes.byteLength;
  const text = decodeUtf8(bytes, entryPath);
  const document = parseDocument(text, entryPath);
  files.set(entryPath, {
    relativePath: entryPath,
    absolutePath: abs,
    bytes,
    text,
    document,
  });

  const hoist: HoistRegistry = {
    byIdentity: new Map(),
    components: {},
  };
  const ctx: ResolveCtx = {
    rootDir,
    entryPath,
    files,
    totals,
    stack: [],
    depth: 0,
    hoist,
  };

  const resolvedTree = await resolveValue(document, entryPath, ctx, '');
  const resolved = mergeHoistedComponents(resolvedTree, hoist);
  const counter = { n: 0 };
  countNodes(resolved, counter);

  return {
    rootDir,
    entryPath,
    files,
    document: resolved,
    sourcePaths: new Set(files.keys()),
    totalBytes: totals.bytes,
    parsedNodeCount: counter.n,
  };
}
