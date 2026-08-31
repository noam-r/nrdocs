import { OpenApiError } from './errors.js';
import { getJsonPointer } from './load.js';
import {
  OPENAPI_HTTP_METHODS,
  OPENAPI_MAX_SCHEMA_PAGES,
  OPENAPI_SCHEMA_ID_RE,
  type OpenApiHttpMethod,
} from './limits.js';
import {
  parseCodeSamples,
  parseOperationCost,
  parseRootCostDefaults,
  type ValidatedOpenApi,
} from './validate.js';
import { generateOperationExamples } from './examples.js';
import type {
  NormalizedOpenApi,
  NormalizedOperation,
  NormalizedSchemaPage,
  OpenApiCost,
  OpenApiMediaType,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSchemaNode,
  OpenApiSecurityRequirement,
  OpenApiSecurityScheme,
  OpenApiServer,
} from './types.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asServers(raw: unknown): OpenApiServer[] {
  if (!Array.isArray(raw)) return [];
  const out: OpenApiServer[] = [];
  for (const s of raw) {
    if (!isPlainObject(s) || typeof s.url !== 'string') continue;
    out.push(
      s.description !== undefined && typeof s.description === 'string'
        ? { url: s.url, description: s.description }
        : { url: s.url },
    );
  }
  return out;
}

function selectExampleServerUrl(
  opServers: OpenApiServer[],
  pathServers: OpenApiServer[],
  rootServers: OpenApiServer[],
): string {
  if (opServers.length > 0) return opServers[0]!.url;
  if (pathServers.length > 0) return pathServers[0]!.url;
  if (rootServers.length > 0) return rootServers[0]!.url;
  return 'https://api.example.com';
}

const SCHEMA_PAGE_REF_PREFIX = '#/components/schemas/';
const FOLLOWED_COMPONENT_REF_PREFIXES = [
  SCHEMA_PAGE_REF_PREFIX,
  '#/components/parameters/',
  '#/components/requestBodies/',
  '#/components/responses/',
  '#/components/headers/',
] as const;

function collectSchemaRefs(
  node: unknown,
  doc: Record<string, unknown>,
  referenced: Set<string>,
  stack: string[],
): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectSchemaRefs(item, doc, referenced, stack);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj.$ref === 'string') {
    const ref = obj.$ref;
    for (const prefix of FOLLOWED_COMPONENT_REF_PREFIXES) {
      if (!ref.startsWith(prefix)) continue;
      const id = ref.slice(prefix.length);
      if (!id || id.includes('/')) break;
      if (prefix === SCHEMA_PAGE_REF_PREFIX) referenced.add(id);
      if (stack.includes(ref)) return;
      stack.push(ref);
      try {
        const target = getJsonPointer(doc, ref.slice(1));
        collectSchemaRefs(target, doc, referenced, stack);
      } finally {
        stack.pop();
      }
      return;
    }
  }
  for (const v of Object.values(obj)) collectSchemaRefs(v, doc, referenced, stack);
}

function toSchemaNode(
  schema: unknown,
  doc: Record<string, unknown>,
  stack: string[],
  depth: number,
): OpenApiSchemaNode | undefined {
  if (schema === undefined) return undefined;
  if (typeof schema === 'boolean') {
    return {
      type: schema ? 'any' : 'never',
      constraints: [schema ? 'always valid' : 'never valid'],
    };
  }
  if (!isPlainObject(schema)) return undefined;

  if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/components/schemas/')) {
    const id = schema.$ref.slice('#/components/schemas/'.length);
    if (stack.includes(schema.$ref) || depth > 8) {
      return { ref: id, recursiveRef: id };
    }
    stack.push(schema.$ref);
    try {
      const target = getJsonPointer(doc, schema.$ref.slice(1));
      const inner = toSchemaNode(target, doc, stack, depth + 1);
      return { ref: id, ...(inner ?? {}) };
    } finally {
      stack.pop();
    }
  }

  const node: OpenApiSchemaNode = {};
  if (typeof schema.title === 'string') node.title = schema.title;
  if (typeof schema.description === 'string') node.description = schema.description;
  if (Array.isArray(schema.type)) {
    node.type = schema.type.filter((t): t is string => typeof t === 'string');
  } else if (typeof schema.type === 'string') {
    node.type = schema.type;
  }
  if (typeof schema.format === 'string') node.format = schema.format;
  if (Array.isArray(schema.enum)) node.enum = schema.enum;
  if (schema.const !== undefined) node.const = schema.const;
  if (schema.default !== undefined) node.default = schema.default;
  if (schema.example !== undefined) node.example = schema.example;
  if (schema.examples !== undefined) node.examples = schema.examples;
  if (schema.nullable === true) node.nullable = true;
  if (schema.readOnly === true) node.readOnly = true;
  if (schema.writeOnly === true) node.writeOnly = true;
  if (schema.deprecated === true) node.deprecated = true;
  if (Array.isArray(schema.required)) {
    node.required = schema.required.filter((r): r is string => typeof r === 'string');
  }

  const constraints: string[] = [];
  for (const [k, label] of [
    ['minimum', 'minimum'],
    ['maximum', 'maximum'],
    ['exclusiveMinimum', 'exclusiveMinimum'],
    ['exclusiveMaximum', 'exclusiveMaximum'],
    ['minLength', 'minLength'],
    ['maxLength', 'maxLength'],
    ['minItems', 'minItems'],
    ['maxItems', 'maxItems'],
    ['minProperties', 'minProperties'],
    ['maxProperties', 'maxProperties'],
    ['pattern', 'pattern'],
    ['multipleOf', 'multipleOf'],
  ] as const) {
    if (schema[k] !== undefined) constraints.push(`${label}: ${String(schema[k])}`);
  }
  if (schema.uniqueItems === true) constraints.push('uniqueItems: true');
  if (constraints.length) node.constraints = constraints;

  if (isPlainObject(schema.properties)) {
    node.properties = {};
    for (const [name, prop] of Object.entries(schema.properties)) {
      const child = toSchemaNode(prop, doc, stack, depth + 1);
      if (child) node.properties[name] = child;
    }
  }
  if (schema.additionalProperties === true || schema.additionalProperties === false) {
    node.additionalProperties = schema.additionalProperties;
  } else if (schema.additionalProperties !== undefined) {
    const ap = toSchemaNode(schema.additionalProperties, doc, stack, depth + 1);
    if (ap) node.additionalProperties = ap;
  }
  if (schema.items !== undefined) {
    const items = toSchemaNode(schema.items, doc, stack, depth + 1);
    if (items) node.items = items;
  }
  for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
    if (Array.isArray(schema[key])) {
      node[key] = (schema[key] as unknown[])
        .map((s) => toSchemaNode(s, doc, stack, depth + 1))
        .filter((s): s is OpenApiSchemaNode => s !== undefined);
    }
  }
  if (schema.not !== undefined) {
    const notNode = toSchemaNode(schema.not, doc, stack, depth + 1);
    if (notNode) node.not = notNode;
  }
  if (
    isPlainObject(schema.discriminator) &&
    typeof schema.discriminator.propertyName === 'string'
  ) {
    node.discriminator = {
      propertyName: schema.discriminator.propertyName,
      ...(isPlainObject(schema.discriminator.mapping)
        ? {
            mapping: Object.fromEntries(
              Object.entries(schema.discriminator.mapping).filter(
                (e): e is [string, string] => typeof e[1] === 'string',
              ),
            ),
          }
        : {}),
    };
  }
  return node;
}

function derefParam(param: unknown, doc: Record<string, unknown>): Record<string, unknown> | null {
  if (!isPlainObject(param)) return null;
  if (typeof param.$ref === 'string') {
    const target = getJsonPointer(doc, param.$ref.slice(1));
    return isPlainObject(target) ? target : null;
  }
  return param;
}

function toParameter(param: unknown, doc: Record<string, unknown>): OpenApiParameter | null {
  const p = derefParam(param, doc);
  if (!p || typeof p.name !== 'string') return null;
  const inn = p.in;
  if (inn !== 'path' && inn !== 'query' && inn !== 'header' && inn !== 'cookie') return null;
  const out: OpenApiParameter = {
    name: p.name,
    in: inn,
    required: p.required === true || inn === 'path',
    deprecated: p.deprecated === true,
  };
  if (typeof p.description === 'string') out.description = p.description;
  if (p.schema !== undefined) {
    const schema = toSchemaNode(p.schema, doc, [], 0);
    if (schema) out.schema = schema;
  }
  if (p.example !== undefined) out.example = p.example;
  if (p.examples !== undefined) out.examples = p.examples;
  return out;
}

function toMediaTypes(content: unknown, doc: Record<string, unknown>): OpenApiMediaType[] {
  if (!isPlainObject(content)) return [];
  return Object.entries(content).map(([mediaType, body]) => {
    const b = isPlainObject(body) ? body : {};
    const out: OpenApiMediaType = { mediaType };
    if (b.schema !== undefined) {
      const schema = toSchemaNode(b.schema, doc, [], 0);
      if (schema) out.schema = schema;
    }
    if (b.example !== undefined) out.example = b.example;
    if (b.examples !== undefined) out.examples = b.examples;
    return out;
  });
}

function toRequestBody(raw: unknown, doc: Record<string, unknown>): OpenApiRequestBody | undefined {
  if (!isPlainObject(raw)) return undefined;
  let body = raw;
  if (typeof raw.$ref === 'string') {
    const t = getJsonPointer(doc, raw.$ref.slice(1));
    if (!isPlainObject(t)) return undefined;
    body = t;
  }
  return {
    required: body.required === true,
    ...(typeof body.description === 'string' ? { description: body.description } : {}),
    content: toMediaTypes(body.content, doc),
  };
}

function toResponses(raw: unknown, doc: Record<string, unknown>): OpenApiResponse[] {
  if (!isPlainObject(raw)) return [];
  const out: OpenApiResponse[] = [];
  for (const [status, resp] of Object.entries(raw)) {
    let r = resp;
    if (isPlainObject(resp) && typeof resp.$ref === 'string') {
      const t = getJsonPointer(doc, resp.$ref.slice(1));
      if (!isPlainObject(t)) continue;
      r = t;
    }
    if (!isPlainObject(r)) continue;
    const headers: OpenApiResponse['headers'] = [];
    if (isPlainObject(r.headers)) {
      for (const [name, rawHeader] of Object.entries(r.headers)) {
        if (!isPlainObject(rawHeader)) continue;
        let h: Record<string, unknown> = rawHeader;
        if (typeof rawHeader.$ref === 'string') {
          const t = getJsonPointer(doc, rawHeader.$ref.slice(1));
          if (!isPlainObject(t)) continue;
          h = t;
        }
        const header: { name: string; description?: string; schema?: OpenApiSchemaNode } = { name };
        if (typeof h.description === 'string') header.description = h.description;
        if (h.schema !== undefined) {
          const schema = toSchemaNode(h.schema, doc, [], 0);
          if (schema) header.schema = schema;
        }
        headers.push(header);
      }
    }
    out.push({
      status,
      ...(typeof r.description === 'string' ? { description: r.description } : {}),
      content: toMediaTypes(r.content, doc),
      ...(headers.length ? { headers } : {}),
    });
  }
  return out;
}

function toSecurity(raw: unknown): OpenApiSecurityRequirement[] {
  if (!Array.isArray(raw)) return [];
  const out: OpenApiSecurityRequirement[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const req: OpenApiSecurityRequirement = {};
    for (const [k, v] of Object.entries(item)) {
      req[k] = Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
    }
    out.push(req);
  }
  return out;
}

function toSecuritySchemes(doc: Record<string, unknown>): OpenApiSecurityScheme[] {
  const schemes =
    isPlainObject(doc.components) && isPlainObject(doc.components.securitySchemes)
      ? doc.components.securitySchemes
      : {};
  const out: OpenApiSecurityScheme[] = [];
  for (const [name, raw] of Object.entries(schemes)) {
    if (!isPlainObject(raw) || typeof raw.type !== 'string') continue;
    out.push({
      name,
      type: raw.type,
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
      ...(typeof raw.scheme === 'string' ? { scheme: raw.scheme } : {}),
      ...(typeof raw.bearerFormat === 'string' ? { bearerFormat: raw.bearerFormat } : {}),
      ...(typeof raw.in === 'string' ? { in: raw.in } : {}),
      ...(typeof raw.name === 'string' ? { paramName: raw.name } : {}),
      ...(typeof raw.openIdConnectUrl === 'string'
        ? { openIdConnectUrl: raw.openIdConnectUrl }
        : {}),
      ...(raw.flows !== undefined ? { flows: raw.flows } : {}),
    });
  }
  return out;
}

function httpsExternalDocs(raw: unknown): { url: string; description?: string } | undefined {
  if (!isPlainObject(raw) || typeof raw.url !== 'string') return undefined;
  const url = validateHttpOrHttpsUrl(raw.url);
  if (!url) return undefined;
  return typeof raw.description === 'string' ? { url, description: raw.description } : { url };
}

/** Allow http/https absolute URLs without credentials (landing contact/license/ToS). */
function validateHttpOrHttpsUrl(value: string): string | undefined {
  if (value.length === 0 || value.length > 2048) return undefined;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  if (u.username || u.password) return undefined;
  return value;
}

/**
 * Build the version-independent normalized OpenAPI model.
 */
export function normalizeOpenApi(
  validated: ValidatedOpenApi,
  sourceFile: string,
): NormalizedOpenApi {
  const doc = validated.document;
  const rootServers = asServers(doc.servers);
  const rootSecurity = toSecurity(doc.security);
  const rootCostDefaults = parseRootCostDefaults(doc, sourceFile);
  const infoRaw = doc.info as Record<string, unknown>;

  const tagMeta = new Map<string, string | undefined>();
  const tagOrder: string[] = [];
  if (Array.isArray(doc.tags)) {
    for (const t of doc.tags) {
      if (!isPlainObject(t) || typeof t.name !== 'string') continue;
      if (!tagMeta.has(t.name)) {
        tagMeta.set(t.name, typeof t.description === 'string' ? t.description : undefined);
        tagOrder.push(t.name);
      }
    }
  }

  const referencedSchemas = new Set<string>();
  const operationsByTag = new Map<string, NormalizedOperation[]>();
  const otherOperations: NormalizedOperation[] = [];
  const allOperations: NormalizedOperation[] = [];
  const seenExtraTags: string[] = [];

  const paths = isPlainObject(doc.paths) ? doc.paths : {};
  // Preserve path key order from document
  for (const [pathKey, rawPathItem] of Object.entries(paths)) {
    if (!isPlainObject(rawPathItem)) continue;
    let pathItem = rawPathItem;
    if (typeof rawPathItem.$ref === 'string') {
      const ref = rawPathItem.$ref;
      if (!ref.startsWith('#/')) {
        throw new OpenApiError(
          'openapi_ref_resolution',
          `Non-local path item $ref remains after load:\n  ${ref}`,
          { sourceFile, pointer: `/paths/${pathKey}`, path: pathKey },
        );
      }
      const target = getJsonPointer(doc, ref.slice(1));
      if (!isPlainObject(target)) {
        throw new OpenApiError(
          'openapi_ref_resolution',
          `OpenAPI path item $ref target was not found:\n  ${ref}`,
          { sourceFile, pointer: `/paths/${pathKey}`, path: pathKey },
        );
      }
      pathItem = target;
    }
    const pathServers = asServers(pathItem.servers);
    for (const method of OPENAPI_HTTP_METHODS) {
      const op = pathItem[method];
      if (!isPlainObject(op)) continue;

      const operationId = op.operationId as string;
      const tags = Array.isArray(op.tags)
        ? op.tags.filter((t): t is string => typeof t === 'string')
        : [];
      const primaryTag = tags.length > 0 ? tags[0]! : null;

      const opServers = asServers(op.servers);
      const exampleServerUrl = selectExampleServerUrl(opServers, pathServers, rootServers);
      const displayServers =
        opServers.length > 0 ? opServers : pathServers.length > 0 ? pathServers : rootServers;

      const parameters: OpenApiParameter[] = [];
      for (const p of [
        ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
        ...(Array.isArray(op.parameters) ? op.parameters : []),
      ]) {
        const np = toParameter(p, doc);
        if (np) parameters.push(np);
      }

      let cost: OpenApiCost = { type: 'absent' };
      if (op['x-nrdocs-cost'] !== undefined) {
        const parsed = parseOperationCost(op['x-nrdocs-cost'], rootCostDefaults, {
          sourceFile,
          method,
          path: pathKey,
        });
        cost = parsed;
      }

      const codeSamples =
        op['x-codeSamples'] !== undefined
          ? parseCodeSamples(op['x-codeSamples'], { sourceFile, method, path: pathKey })
          : [];

      const requestBody = toRequestBody(op.requestBody, doc);
      const responses = toResponses(op.responses, doc);
      const security = op.security !== undefined ? toSecurity(op.security) : rootSecurity;

      // Collect schema refs from this operation
      collectSchemaRefs(op, doc, referencedSchemas, []);
      collectSchemaRefs(pathItem.parameters, doc, referencedSchemas, []);

      const normalized: NormalizedOperation = {
        operationId,
        method: method as OpenApiHttpMethod,
        path: pathKey,
        deprecated: op.deprecated === true,
        tags,
        primaryTag,
        servers: displayServers,
        exampleServerUrl,
        security,
        parameters,
        responses,
        cost,
        codeSamples,
        examples: { http: '', curl: '', javascript: '' },
      };
      if (typeof op.summary === 'string') normalized.summary = op.summary;
      if (typeof op.description === 'string') normalized.description = op.description;
      if (requestBody) normalized.requestBody = requestBody;
      const opDocs = httpsExternalDocs(op.externalDocs);
      if (opDocs) normalized.externalDocs = opDocs;
      normalized.examples = generateOperationExamples(normalized);

      allOperations.push(normalized);
      if (primaryTag === null) {
        otherOperations.push(normalized);
      } else {
        if (!tagMeta.has(primaryTag) && !seenExtraTags.includes(primaryTag)) {
          seenExtraTags.push(primaryTag);
        }
        const list = operationsByTag.get(primaryTag) ?? [];
        list.push(normalized);
        operationsByTag.set(primaryTag, list);
      }
    }
  }

  const tagGroups = [...tagOrder, ...seenExtraTags]
    .filter((name) => (operationsByTag.get(name) ?? []).length > 0)
    .map((name) => {
      const group: { name: string; description?: string; operations: NormalizedOperation[] } = {
        name,
        operations: operationsByTag.get(name)!,
      };
      const desc = tagMeta.get(name);
      if (desc) group.description = desc;
      return group;
    });

  // Schema pages
  const componentsSchemas =
    isPlainObject(doc.components) && isPlainObject(doc.components.schemas)
      ? doc.components.schemas
      : {};
  const schemaPages: NormalizedSchemaPage[] = [];
  const sortedIds = [...referencedSchemas].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (sortedIds.length > OPENAPI_MAX_SCHEMA_PAGES) {
    throw new OpenApiError(
      'openapi_limit_exceeded',
      `Canonical schema pages exceed ${OPENAPI_MAX_SCHEMA_PAGES}`,
      { sourceFile },
    );
  }
  for (const schemaId of sortedIds) {
    if (!OPENAPI_SCHEMA_ID_RE.test(schemaId)) {
      throw new OpenApiError(
        'openapi_schema_id',
        `Invalid schema name requiring a page: ${schemaId}`,
        { sourceFile, pointer: `/components/schemas/${schemaId}` },
      );
    }
    if (!Object.prototype.hasOwnProperty.call(componentsSchemas, schemaId)) continue;
    const raw = componentsSchemas[schemaId];
    if (typeof raw === 'boolean') {
      throw new OpenApiError(
        'openapi_unsupported_construct',
        `Referenced boolean schema is not supported: ${schemaId}`,
        { sourceFile, pointer: `/components/schemas/${schemaId}` },
      );
    }
    const schema = toSchemaNode(raw, doc, [], 0) ?? {};
    schema.schemaId = schemaId;
    schemaPages.push({ schemaId, schema });
  }

  const contactUrl =
    isPlainObject(infoRaw.contact) && typeof infoRaw.contact.url === 'string'
      ? validateHttpOrHttpsUrl(infoRaw.contact.url)
      : undefined;
  const contact = isPlainObject(infoRaw.contact)
    ? {
        ...(typeof infoRaw.contact.name === 'string' ? { name: infoRaw.contact.name } : {}),
        ...(contactUrl ? { url: contactUrl } : {}),
        ...(typeof infoRaw.contact.email === 'string' ? { email: infoRaw.contact.email } : {}),
      }
    : undefined;
  const licenseUrl =
    isPlainObject(infoRaw.license) && typeof infoRaw.license.url === 'string'
      ? validateHttpOrHttpsUrl(infoRaw.license.url)
      : undefined;
  const license =
    isPlainObject(infoRaw.license) && typeof infoRaw.license.name === 'string'
      ? {
          name: infoRaw.license.name,
          ...(licenseUrl ? { url: licenseUrl } : {}),
        }
      : undefined;

  const info: NormalizedOpenApi['info'] = {
    title: infoRaw.title as string,
    version: infoRaw.version as string,
  };
  if (typeof infoRaw.description === 'string') info.description = infoRaw.description;
  if (contact && Object.keys(contact).length) info.contact = contact;
  if (license) info.license = license;
  if (typeof infoRaw.termsOfService === 'string') {
    const tos = validateHttpOrHttpsUrl(infoRaw.termsOfService);
    if (tos) info.termsOfService = tos;
  }
  const infoDocs = httpsExternalDocs(infoRaw.externalDocs);
  if (infoDocs) info.externalDocs = infoDocs;

  return {
    openapiVersion: validated.openapiVersion,
    info,
    servers: rootServers,
    security: rootSecurity,
    securitySchemes: toSecuritySchemes(doc),
    tagGroups,
    otherOperations,
    operations: [...tagGroups.flatMap((g) => g.operations), ...otherOperations],
    schemas: schemaPages,
    rootCostDefaults,
  };
}
