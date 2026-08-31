import { OpenApiError } from './errors.js';
import {
  OPENAPI_CODE_SAMPLE_LANG_RE,
  OPENAPI_COST_UNIT_RE,
  OPENAPI_HTTP_METHODS,
  OPENAPI_MAX_CODE_SAMPLE_BYTES,
  OPENAPI_MAX_CODE_SAMPLES,
  OPENAPI_MAX_EXAMPLES_PER_OPERATION,
  OPENAPI_MAX_MEDIA_TYPES,
  OPENAPI_MAX_OPERATIONS,
  OPENAPI_MAX_PARAMETERS_PER_OPERATION,
  OPENAPI_MAX_RESPONSES_PER_OPERATION,
  OPENAPI_MAX_TAGS,
  OPENAPI_OPERATION_ID_RE,
  type OpenApiHttpMethod,
} from './limits.js';
import { getJsonPointer } from './load.js';

const SUPPORTED_SCHEMA_KEYS = new Set([
  '$ref',
  'title',
  'description',
  'type',
  'format',
  'enum',
  'const',
  'default',
  'example',
  'examples',
  'nullable',
  'readOnly',
  'writeOnly',
  'deprecated',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'allOf',
  'oneOf',
  'anyOf',
  'not',
  'discriminator',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'uniqueItems',
  'pattern',
  'multipleOf',
  'minProperties',
  'maxProperties',
]);

const REJECTED_SCHEMA_KEYS = new Set([
  'unevaluatedProperties',
  'unevaluatedItems',
  'xml',
  'encoding',
]);

export type ValidatedOpenApi = {
  document: Record<string, unknown>;
  openapiVersion: string;
  dialect: '3.0' | '3.1';
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasCc(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return true;
  }
  return false;
}

function nfcTrim(text: string): string {
  return text.normalize('NFC').trim();
}

function scalarCount(text: string): number {
  return [...text].length;
}

const COST_AMOUNT_DECIMAL_RE = /^(0|[1-9]\d*)(\.\d{1,6})?$/;

/** Shortest decimal form with ≤6 fractional digits (doc 12 §8). */
function shortestAmountString(raw: string): string {
  if (!raw.includes('.')) return raw;
  const trimmed = raw.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' ? '0' : trimmed;
}

/**
 * Canonical cost amount serialization (doc 12 §8).
 * Accepts JSON/YAML numbers or decimal strings; stores/returns a canonical string.
 */
export function canonicalizeCostAmount(
  value: unknown,
  loc: { sourceFile?: string; pointer?: string },
): string {
  if (typeof value === 'string') {
    const s = value.trim();
    if (!COST_AMOUNT_DECIMAL_RE.test(s)) {
      throw new OpenApiError(
        'openapi_extension_invalid',
        'x-nrdocs-cost amount string must be a non-negative decimal with at most 6 fractional digits',
        loc,
      );
    }
    return shortestAmountString(s);
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new OpenApiError(
      'openapi_extension_invalid',
      'x-nrdocs-cost amount must be a finite number ≥ 0',
      loc,
    );
  }
  if (Object.is(value, -0) || value === 0) return '0';

  // Reject values whose default JS string is scientific notation unless a
  // ≤6-fractional-digit decimal round-trips exactly.
  for (let digits = 0; digits <= 6; digits++) {
    const fixed = value.toFixed(digits);
    const canonical = shortestAmountString(fixed);
    if (!COST_AMOUNT_DECIMAL_RE.test(canonical)) continue;
    if (Number(canonical) === value) return canonical;
  }

  throw new OpenApiError(
    'openapi_extension_invalid',
    'x-nrdocs-cost amount cannot be represented with at most 6 fractional digits',
    loc,
  );
}

export function parseRootCostDefaults(
  doc: Record<string, unknown>,
  sourceFile: string,
): { unit?: string; pricingUrl?: string } {
  const raw = doc['x-nrdocs-costs'];
  if (raw === undefined) return {};
  if (!isPlainObject(raw)) {
    throw new OpenApiError('openapi_extension_invalid', 'x-nrdocs-costs must be an object', {
      sourceFile,
      pointer: '/x-nrdocs-costs',
    });
  }
  const out: { unit?: string; pricingUrl?: string } = {};
  for (const key of Object.keys(raw)) {
    if (key !== 'unit' && key !== 'pricingUrl') {
      throw new OpenApiError('openapi_extension_invalid', `Unknown x-nrdocs-costs field: ${key}`, {
        sourceFile,
        pointer: '/x-nrdocs-costs',
      });
    }
  }
  if (raw.unit !== undefined) {
    if (typeof raw.unit !== 'string' || !OPENAPI_COST_UNIT_RE.test(nfcTrim(raw.unit))) {
      throw new OpenApiError('openapi_extension_invalid', 'x-nrdocs-costs.unit is invalid', {
        sourceFile,
        pointer: '/x-nrdocs-costs/unit',
      });
    }
    out.unit = nfcTrim(raw.unit);
  }
  if (raw.pricingUrl !== undefined) {
    out.pricingUrl = validateHttpsUrl(raw.pricingUrl, {
      sourceFile,
      pointer: '/x-nrdocs-costs/pricingUrl',
    });
  }
  return out;
}

function validateHttpsUrl(value: unknown, loc: { sourceFile?: string; pointer?: string }): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    throw new OpenApiError(
      'openapi_extension_invalid',
      'URL must be an https URL ≤ 2048 bytes',
      loc,
    );
  }
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new OpenApiError('openapi_extension_invalid', 'URL is malformed', loc);
  }
  if (u.protocol !== 'https:') {
    throw new OpenApiError('openapi_extension_invalid', 'URL must use https', loc);
  }
  if (u.username || u.password) {
    throw new OpenApiError('openapi_extension_invalid', 'URL must not include credentials', loc);
  }
  return value;
}

export type ParsedOperationCost =
  | { type: 'free' }
  | { type: 'fixed'; amount: string; unit: string }
  | { type: 'variable'; description: string; pricingUrl?: string };

export function parseOperationCost(
  raw: unknown,
  defaults: { unit?: string; pricingUrl?: string },
  loc: { sourceFile?: string; pointer?: string; method?: string; path?: string },
): ParsedOperationCost {
  if (!isPlainObject(raw)) {
    throw new OpenApiError('openapi_extension_invalid', 'x-nrdocs-cost must be an object', loc);
  }
  const type = raw.type;
  for (const key of Object.keys(raw)) {
    if (!['type', 'amount', 'unit', 'description', 'pricingUrl'].includes(key)) {
      throw new OpenApiError(
        'openapi_extension_invalid',
        `Unknown x-nrdocs-cost field: ${key}`,
        loc,
      );
    }
  }
  if (type === 'free') {
    if (raw.amount !== undefined || raw.unit !== undefined) {
      throw new OpenApiError(
        'openapi_extension_invalid',
        'x-nrdocs-cost type free forbids amount and unit',
        loc,
      );
    }
    if (raw.description !== undefined || raw.pricingUrl !== undefined) {
      throw new OpenApiError(
        'openapi_extension_invalid',
        'x-nrdocs-cost type free forbids description and pricingUrl',
        loc,
      );
    }
    return { type: 'free' };
  }
  if (type === 'fixed') {
    if (raw.description !== undefined || raw.pricingUrl !== undefined) {
      throw new OpenApiError(
        'openapi_extension_invalid',
        'x-nrdocs-cost type fixed forbids description and pricingUrl',
        loc,
      );
    }
    const amount = canonicalizeCostAmount(raw.amount, loc);
    const unitRaw = raw.unit !== undefined ? raw.unit : defaults.unit;
    if (typeof unitRaw !== 'string' || !OPENAPI_COST_UNIT_RE.test(nfcTrim(unitRaw))) {
      throw new OpenApiError(
        'openapi_extension_invalid',
        'x-nrdocs-cost fixed requires a valid unit (operation or root default)',
        loc,
      );
    }
    return { type: 'fixed', amount, unit: nfcTrim(unitRaw) };
  }
  if (type === 'variable') {
    if (raw.amount !== undefined || raw.unit !== undefined) {
      throw new OpenApiError(
        'openapi_extension_invalid',
        'x-nrdocs-cost type variable forbids amount and unit',
        loc,
      );
    }
    if (typeof raw.description !== 'string') {
      throw new OpenApiError(
        'openapi_extension_invalid',
        'x-nrdocs-cost variable requires description',
        loc,
      );
    }
    const description = nfcTrim(raw.description);
    if (description.length === 0 || scalarCount(description) > 500 || hasCc(description)) {
      throw new OpenApiError(
        'openapi_extension_invalid',
        'x-nrdocs-cost variable description must be 1–500 scalars without Cc',
        loc,
      );
    }
    const pricingUrl =
      raw.pricingUrl !== undefined ? validateHttpsUrl(raw.pricingUrl, loc) : defaults.pricingUrl;
    return pricingUrl
      ? { type: 'variable', description, pricingUrl }
      : { type: 'variable', description };
  }
  throw new OpenApiError(
    'openapi_extension_invalid',
    `Unknown x-nrdocs-cost type: ${String(type)}`,
    loc,
  );
}

export function parseCodeSamples(
  raw: unknown,
  loc: { sourceFile?: string; pointer?: string; method?: string; path?: string },
): Array<{ lang: string; label?: string; source: string }> {
  if (!Array.isArray(raw)) {
    throw new OpenApiError('openapi_extension_invalid', 'x-codeSamples must be an array', loc);
  }
  if (raw.length > OPENAPI_MAX_CODE_SAMPLES) {
    throw new OpenApiError(
      'openapi_limit_exceeded',
      `x-codeSamples exceeds ${OPENAPI_MAX_CODE_SAMPLES} items`,
      loc,
    );
  }
  const out: Array<{ lang: string; label?: string; source: string }> = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const itemLoc = { ...loc, pointer: `${loc.pointer ?? ''}/${i}` };
    if (!isPlainObject(item)) {
      throw new OpenApiError(
        'openapi_extension_invalid',
        'x-codeSamples item must be an object',
        itemLoc,
      );
    }
    for (const key of Object.keys(item)) {
      if (key !== 'lang' && key !== 'label' && key !== 'source') {
        throw new OpenApiError(
          'openapi_extension_invalid',
          `Unknown x-codeSamples field: ${key}`,
          itemLoc,
        );
      }
    }
    if (typeof item.lang !== 'string' || !OPENAPI_CODE_SAMPLE_LANG_RE.test(item.lang)) {
      throw new OpenApiError(
        'openapi_extension_invalid',
        'x-codeSamples.lang is required and must match ^[a-z][a-z0-9+-]{0,31}$',
        itemLoc,
      );
    }
    if (typeof item.source !== 'string') {
      throw new OpenApiError(
        'openapi_extension_invalid',
        'x-codeSamples.source is required',
        itemLoc,
      );
    }
    const sourceBytes = new TextEncoder().encode(item.source).byteLength;
    if (sourceBytes < 1 || sourceBytes > OPENAPI_MAX_CODE_SAMPLE_BYTES) {
      throw new OpenApiError(
        'openapi_extension_invalid',
        `x-codeSamples.source must be 1–${OPENAPI_MAX_CODE_SAMPLE_BYTES} UTF-8 bytes`,
        itemLoc,
      );
    }
    let label: string | undefined;
    if (item.label !== undefined) {
      if (typeof item.label !== 'string') {
        throw new OpenApiError(
          'openapi_extension_invalid',
          'x-codeSamples.label must be a string',
          itemLoc,
        );
      }
      label = nfcTrim(item.label);
      if (label.length === 0 || scalarCount(label) > 80 || hasCc(label)) {
        throw new OpenApiError(
          'openapi_extension_invalid',
          'x-codeSamples.label must be 1–80 scalars without Cc',
          itemLoc,
        );
      }
    }
    out.push(
      label
        ? { lang: item.lang, label, source: item.source }
        : { lang: item.lang, source: item.source },
    );
  }
  return out;
}

function assertSupportedVersion(
  version: unknown,
  sourceFile: string,
): {
  openapiVersion: string;
  dialect: '3.0' | '3.1';
} {
  if (typeof version !== 'string' || !version) {
    throw new OpenApiError('openapi_unsupported_version', 'OpenAPI version is missing or invalid', {
      sourceFile,
      pointer: '/openapi',
    });
  }
  if (/^3\.0\.\d+$/.test(version)) return { openapiVersion: version, dialect: '3.0' };
  if (/^3\.1\.\d+$/.test(version)) return { openapiVersion: version, dialect: '3.1' };
  throw new OpenApiError(
    'openapi_unsupported_version',
    `Unsupported OpenAPI version: ${version} (only 3.0.x and 3.1.x are accepted)`,
    { sourceFile, pointer: '/openapi' },
  );
}

function resolveSchemaRef(
  doc: Record<string, unknown>,
  ref: string,
  sourceFile: string,
  pointer: string,
): unknown {
  if (!ref.startsWith('#/')) {
    throw new OpenApiError(
      'openapi_remote_ref',
      `Non-local schema $ref remains after load:\n  ${ref}`,
      { sourceFile, pointer },
    );
  }
  const target = getJsonPointer(doc, ref.slice(1));
  if (target === undefined) {
    throw new OpenApiError(
      'openapi_ref_resolution',
      `OpenAPI $ref target was not found:\n  ${ref}`,
      { sourceFile, pointer },
    );
  }
  return target;
}

/** Resolve a local `#/` component `$ref` to a plain object target. */
function resolveComponentRef(
  doc: Record<string, unknown>,
  ref: string,
  sourceFile: string,
  pointer: string,
): Record<string, unknown> {
  const target = resolveSchemaRef(doc, ref, sourceFile, pointer);
  if (!isPlainObject(target)) {
    throw new OpenApiError(
      'openapi_ref_resolution',
      `OpenAPI $ref target must be an object:\n  ${ref}`,
      { sourceFile, pointer },
    );
  }
  return target;
}

function resolvePathItem(
  pathItem: Record<string, unknown>,
  doc: Record<string, unknown>,
  sourceFile: string,
  pathKey: string,
): Record<string, unknown> {
  if (typeof pathItem.$ref !== 'string') return pathItem;
  const ref = pathItem.$ref;
  const keys = Object.keys(pathItem).filter((k) => k !== '$ref');
  if (keys.length > 0) {
    throw new OpenApiError(
      'openapi_invalid_document',
      `OpenAPI path item $ref siblings are not supported at /paths/${pathKey}`,
      { sourceFile, pointer: `/paths/${escapePtr(pathKey)}`, path: pathKey },
    );
  }
  return resolveComponentRef(doc, ref, sourceFile, `/paths/${escapePtr(pathKey)}`);
}

function validateRequestBody(
  requestBody: unknown,
  doc: Record<string, unknown>,
  sourceFile: string,
  pointer: string,
  method: string,
  pathKey: string,
): void {
  if (!isPlainObject(requestBody)) {
    throw new OpenApiError('openapi_invalid_document', 'requestBody must be an object', {
      sourceFile,
      method,
      path: pathKey,
      pointer,
    });
  }
  let body = requestBody;
  if (typeof requestBody.$ref === 'string') {
    body = resolveComponentRef(doc, requestBody.$ref, sourceFile, pointer);
  }
  const content = body.content;
  if (content === undefined) return;
  if (!isPlainObject(content)) {
    throw new OpenApiError('openapi_invalid_document', 'requestBody.content must be an object', {
      sourceFile,
      method,
      path: pathKey,
      pointer: `${pointer}/content`,
    });
  }
  const mts = Object.keys(content);
  if (mts.length > OPENAPI_MAX_MEDIA_TYPES) {
    throw new OpenApiError(
      'openapi_limit_exceeded',
      `Media types exceed ${OPENAPI_MAX_MEDIA_TYPES}`,
      { sourceFile, method, path: pathKey },
    );
  }
  for (const [mt, media] of Object.entries(content)) {
    validateMediaType(media, doc, sourceFile, `${pointer}/content/${escapePtr(mt)}`);
  }
}

function validateResponseObject(
  resp: Record<string, unknown>,
  doc: Record<string, unknown>,
  sourceFile: string,
  pointer: string,
  method: string,
  pathKey: string,
): void {
  let body = resp;
  if (typeof resp.$ref === 'string') {
    body = resolveComponentRef(doc, resp.$ref, sourceFile, pointer);
  }
  if (body.links !== undefined) {
    throw new OpenApiError(
      'openapi_unsupported_construct',
      `Response links are not supported at ${pointer}`,
      { sourceFile, method, path: pathKey, pointer: `${pointer}/links` },
    );
  }
  if (body.headers !== undefined) {
    if (!isPlainObject(body.headers)) {
      throw new OpenApiError('openapi_invalid_document', 'response.headers must be an object', {
        sourceFile,
        method,
        path: pathKey,
        pointer: `${pointer}/headers`,
      });
    }
    for (const [name, header] of Object.entries(body.headers)) {
      if (!isPlainObject(header)) continue;
      let h = header;
      if (typeof header.$ref === 'string') {
        h = resolveComponentRef(
          doc,
          header.$ref,
          sourceFile,
          `${pointer}/headers/${escapePtr(name)}`,
        );
      }
      if (h.content !== undefined) {
        throw new OpenApiError(
          'openapi_unsupported_construct',
          `Header content is not supported at ${pointer}/headers/${escapePtr(name)}`,
          {
            sourceFile,
            method,
            path: pathKey,
            pointer: `${pointer}/headers/${escapePtr(name)}/content`,
          },
        );
      }
      if (h.schema !== undefined) {
        validateSchemaObject(
          h.schema,
          doc,
          sourceFile,
          `${pointer}/headers/${escapePtr(name)}/schema`,
          {
            allowBoolean: false,
            stack: [],
          },
        );
      }
    }
  }
  if (body.content === undefined) return;
  if (!isPlainObject(body.content)) {
    throw new OpenApiError('openapi_invalid_document', 'response.content must be an object', {
      sourceFile,
      method,
      path: pathKey,
      pointer: `${pointer}/content`,
    });
  }
  if (Object.keys(body.content).length > OPENAPI_MAX_MEDIA_TYPES) {
    throw new OpenApiError(
      'openapi_limit_exceeded',
      `Media types exceed ${OPENAPI_MAX_MEDIA_TYPES}`,
      { sourceFile, method, path: pathKey },
    );
  }
  for (const [mt, media] of Object.entries(body.content)) {
    validateMediaType(media, doc, sourceFile, `${pointer}/content/${escapePtr(mt)}`);
  }
}

function validateSchemaObject(
  schema: unknown,
  doc: Record<string, unknown>,
  sourceFile: string,
  pointer: string,
  opts: { allowBoolean: boolean; stack: string[] },
): void {
  if (typeof schema === 'boolean') {
    if (!opts.allowBoolean) {
      throw new OpenApiError(
        'openapi_unsupported_construct',
        `Boolean JSON Schema is not allowed here:\n  ${pointer}`,
        { sourceFile, pointer },
      );
    }
    return;
  }
  if (!isPlainObject(schema)) {
    throw new OpenApiError('openapi_invalid_document', `Schema must be an object:\n  ${pointer}`, {
      sourceFile,
      pointer,
    });
  }

  if (typeof schema.$ref === 'string') {
    const ref = schema.$ref;
    if (opts.stack.includes(ref)) return; // bounded recursion
    const target = resolveSchemaRef(doc, ref, sourceFile, pointer);
    opts.stack.push(ref);
    try {
      validateSchemaObject(target, doc, sourceFile, ref.slice(1), {
        allowBoolean: false,
        stack: opts.stack,
      });
    } finally {
      opts.stack.pop();
    }
    return;
  }

  for (const key of Object.keys(schema)) {
    if (REJECTED_SCHEMA_KEYS.has(key)) {
      throw new OpenApiError(
        'openapi_unsupported_construct',
        `Unsupported schema keyword "${key}" at ${pointer}`,
        { sourceFile, pointer },
      );
    }
    if (key.startsWith('x-')) continue;
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) {
      throw new OpenApiError(
        'openapi_unsupported_construct',
        `Unsupported schema keyword "${key}" at ${pointer}`,
        { sourceFile, pointer },
      );
    }
  }

  if (schema.properties && isPlainObject(schema.properties)) {
    for (const [name, prop] of Object.entries(schema.properties)) {
      validateSchemaObject(prop, doc, sourceFile, `${pointer}/properties/${name}`, {
        allowBoolean: false,
        stack: opts.stack,
      });
    }
  }
  if (schema.items !== undefined) {
    validateSchemaObject(schema.items, doc, sourceFile, `${pointer}/items`, {
      allowBoolean: false,
      stack: opts.stack,
    });
  }
  if (
    schema.additionalProperties !== undefined &&
    schema.additionalProperties !== true &&
    schema.additionalProperties !== false
  ) {
    validateSchemaObject(
      schema.additionalProperties,
      doc,
      sourceFile,
      `${pointer}/additionalProperties`,
      {
        allowBoolean: false,
        stack: opts.stack,
      },
    );
  }
  for (const comp of ['allOf', 'oneOf', 'anyOf'] as const) {
    const list = schema[comp];
    if (Array.isArray(list)) {
      for (let i = 0; i < list.length; i++) {
        validateSchemaObject(list[i], doc, sourceFile, `${pointer}/${comp}/${i}`, {
          allowBoolean: false,
          stack: opts.stack,
        });
      }
    }
  }
  if (schema.not !== undefined) {
    validateSchemaObject(schema.not, doc, sourceFile, `${pointer}/not`, {
      allowBoolean: false,
      stack: opts.stack,
    });
  }
  if (schema.discriminator !== undefined) {
    if (
      !isPlainObject(schema.discriminator) ||
      typeof schema.discriminator.propertyName !== 'string'
    ) {
      throw new OpenApiError(
        'openapi_invalid_document',
        `discriminator.propertyName is required at ${pointer}`,
        { sourceFile, pointer },
      );
    }
  }
}

function validateMediaType(
  mt: unknown,
  doc: Record<string, unknown>,
  sourceFile: string,
  pointer: string,
): void {
  if (!isPlainObject(mt)) {
    throw new OpenApiError(
      'openapi_invalid_document',
      `Media type must be an object at ${pointer}`,
      {
        sourceFile,
        pointer,
      },
    );
  }
  if (mt.encoding !== undefined) {
    throw new OpenApiError(
      'openapi_unsupported_construct',
      `encoding objects are not supported at ${pointer}`,
      { sourceFile, pointer },
    );
  }
  if (mt.schema !== undefined) {
    validateSchemaObject(mt.schema, doc, sourceFile, `${pointer}/schema`, {
      allowBoolean: false,
      stack: [],
    });
  }
}

/** Count declared `example` / `examples` entries on a parameter or media type. */
function countExampleFields(obj: Record<string, unknown>): number {
  let n = 0;
  if (obj.example !== undefined) n += 1;
  if (obj.examples !== undefined) {
    if (isPlainObject(obj.examples)) n += Object.keys(obj.examples).length;
    else if (Array.isArray(obj.examples)) n += obj.examples.length;
    else n += 1;
  }
  return n;
}

function countDeclaredExamplesOnSchema(
  schema: unknown,
  doc: Record<string, unknown>,
  stack: string[],
): number {
  if (!isPlainObject(schema)) return 0;
  if (typeof schema.$ref === 'string') {
    if (stack.includes(schema.$ref)) return 0;
    stack.push(schema.$ref);
    try {
      const target = getJsonPointer(doc, schema.$ref.slice(1));
      return countDeclaredExamplesOnSchema(target, doc, stack);
    } finally {
      stack.pop();
    }
  }
  let n = countExampleFields(schema);
  if (isPlainObject(schema.properties)) {
    for (const prop of Object.values(schema.properties)) {
      n += countDeclaredExamplesOnSchema(prop, doc, stack);
    }
  }
  if (schema.items !== undefined) n += countDeclaredExamplesOnSchema(schema.items, doc, stack);
  if (
    schema.additionalProperties !== undefined &&
    schema.additionalProperties !== true &&
    schema.additionalProperties !== false
  ) {
    n += countDeclaredExamplesOnSchema(schema.additionalProperties, doc, stack);
  }
  for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
    const list = schema[key];
    if (Array.isArray(list)) {
      for (const item of list) n += countDeclaredExamplesOnSchema(item, doc, stack);
    }
  }
  if (schema.not !== undefined) n += countDeclaredExamplesOnSchema(schema.not, doc, stack);
  return n;
}

function countMediaTypeExamples(mt: unknown, doc: Record<string, unknown>): number {
  if (!isPlainObject(mt)) return 0;
  let n = countExampleFields(mt);
  if (mt.schema !== undefined) n += countDeclaredExamplesOnSchema(mt.schema, doc, []);
  return n;
}

function countParameterExamples(param: unknown, doc: Record<string, unknown>): number {
  if (!isPlainObject(param)) return 0;
  if (typeof param.$ref === 'string') {
    const target = getJsonPointer(doc, param.$ref.slice(1));
    return countParameterExamples(target, doc);
  }
  let n = countExampleFields(param);
  if (param.schema !== undefined) n += countDeclaredExamplesOnSchema(param.schema, doc, []);
  return n;
}

/**
 * Declared examples + 3 generated baselines (cURL, JavaScript, HTTP) must be ≤ OPENAPI_MAX_EXAMPLES_PER_OPERATION.
 */
function assertExamplesLimit(
  op: Record<string, unknown>,
  pathItem: Record<string, unknown>,
  doc: Record<string, unknown>,
  loc: { sourceFile: string; method: string; path: string },
): void {
  let declared = 0;
  const params = [
    ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
    ...(Array.isArray(op.parameters) ? op.parameters : []),
  ];
  for (const p of params) declared += countParameterExamples(p, doc);

  let requestBody = op.requestBody;
  if (isPlainObject(requestBody) && typeof requestBody.$ref === 'string') {
    requestBody = getJsonPointer(doc, requestBody.$ref.slice(1));
  }
  if (isPlainObject(requestBody) && isPlainObject(requestBody.content)) {
    for (const mt of Object.values(requestBody.content)) {
      declared += countMediaTypeExamples(mt, doc);
    }
  }

  if (isPlainObject(op.responses)) {
    for (const resp of Object.values(op.responses)) {
      let r = resp;
      if (isPlainObject(resp) && typeof resp.$ref === 'string') {
        r = getJsonPointer(doc, resp.$ref.slice(1));
      }
      if (!isPlainObject(r)) continue;
      if (isPlainObject(r.content)) {
        for (const mt of Object.values(r.content)) {
          declared += countMediaTypeExamples(mt, doc);
        }
      }
      if (isPlainObject(r.headers)) {
        for (const header of Object.values(r.headers)) {
          declared += countParameterExamples(header, doc);
        }
      }
    }
  }

  const total = declared + 3; // cURL + JavaScript + HTTP baselines
  if (total > OPENAPI_MAX_EXAMPLES_PER_OPERATION) {
    throw new OpenApiError(
      'openapi_limit_exceeded',
      `Examples exceed ${OPENAPI_MAX_EXAMPLES_PER_OPERATION} (declared + generated baselines) for ${loc.method.toUpperCase()} ${loc.path}`,
      loc,
    );
  }
}

function validateParameter(
  param: unknown,
  doc: Record<string, unknown>,
  sourceFile: string,
  pointer: string,
  method: string,
  pathKey: string,
): void {
  if (!isPlainObject(param)) {
    throw new OpenApiError(
      'openapi_invalid_document',
      `Parameter must be an object at ${pointer}`,
      {
        sourceFile,
        pointer,
        method,
        path: pathKey,
      },
    );
  }
  if (typeof param.$ref === 'string') {
    const target = resolveSchemaRef(doc, param.$ref, sourceFile, pointer);
    validateParameter(target, doc, sourceFile, param.$ref.slice(1), method, pathKey);
    return;
  }
  if (param.content !== undefined) {
    throw new OpenApiError(
      'openapi_unsupported_construct',
      `Parameter content is not supported at ${pointer}`,
      { sourceFile, pointer, method, path: pathKey },
    );
  }
  if (param.schema !== undefined) {
    validateSchemaObject(param.schema, doc, sourceFile, `${pointer}/schema`, {
      allowBoolean: false,
      stack: [],
    });
  }
}

/**
 * Validate a loaded/resolved OpenAPI document against the doc 12 subset.
 */
export function validateOpenApi(document: unknown, sourceFile: string): ValidatedOpenApi {
  if (!isPlainObject(document)) {
    throw new OpenApiError('openapi_invalid_document', 'OpenAPI root must be an object', {
      sourceFile,
    });
  }

  const { openapiVersion, dialect } = assertSupportedVersion(document.openapi, sourceFile);

  if (document.webhooks !== undefined) {
    throw new OpenApiError('openapi_unsupported_construct', 'webhooks are not supported', {
      sourceFile,
      pointer: '/webhooks',
    });
  }

  if (!isPlainObject(document.info)) {
    throw new OpenApiError('openapi_invalid_document', 'info object is required', {
      sourceFile,
      pointer: '/info',
    });
  }
  if (typeof document.info.title !== 'string' || typeof document.info.version !== 'string') {
    throw new OpenApiError(
      'openapi_invalid_document',
      'info.title and info.version are required strings',
      { sourceFile, pointer: '/info' },
    );
  }

  // Validate root cost defaults early
  parseRootCostDefaults(document, sourceFile);

  const paths = document.paths;
  if (paths !== undefined && !isPlainObject(paths)) {
    throw new OpenApiError('openapi_invalid_document', 'paths must be an object', {
      sourceFile,
      pointer: '/paths',
    });
  }

  const operationIds = new Map<string, { method: string; path: string }>();
  let operationCount = 0;
  const usedTags = new Set<string>();

  if (isPlainObject(paths)) {
    for (const [pathKey, rawPathItem] of Object.entries(paths)) {
      if (!isPlainObject(rawPathItem)) continue;
      const pathItem = resolvePathItem(rawPathItem, document, sourceFile, pathKey);
      if (pathItem.callbacks !== undefined) {
        throw new OpenApiError(
          'openapi_unsupported_construct',
          `callbacks are not supported at /paths/${pathKey}`,
          { sourceFile, pointer: `/paths/${escapePtr(pathKey)}/callbacks`, path: pathKey },
        );
      }
      for (const method of OPENAPI_HTTP_METHODS) {
        const op = pathItem[method];
        if (op === undefined) continue;
        if (!isPlainObject(op)) {
          throw new OpenApiError(
            'openapi_invalid_document',
            `Operation must be an object at ${method.toUpperCase()} ${pathKey}`,
            { sourceFile, method, path: pathKey },
          );
        }
        operationCount += 1;
        if (operationCount > OPENAPI_MAX_OPERATIONS) {
          throw new OpenApiError(
            'openapi_limit_exceeded',
            `Operations exceed ${OPENAPI_MAX_OPERATIONS}`,
            { sourceFile },
          );
        }

        if (op.callbacks !== undefined) {
          throw new OpenApiError(
            'openapi_unsupported_construct',
            `callbacks are not supported on ${method.toUpperCase()} ${pathKey}`,
            {
              sourceFile,
              pointer: `/paths/${escapePtr(pathKey)}/${method}/callbacks`,
              method,
              path: pathKey,
            },
          );
        }

        const operationId = op.operationId;
        if (typeof operationId !== 'string' || operationId.length === 0) {
          throw new OpenApiError(
            'openapi_operation_id',
            `Missing operationId for ${method.toUpperCase()} ${pathKey}`,
            {
              sourceFile,
              method,
              path: pathKey,
              pointer: `/paths/${escapePtr(pathKey)}/${method}`,
            },
          );
        }
        if (!OPENAPI_OPERATION_ID_RE.test(operationId)) {
          throw new OpenApiError(
            'openapi_operation_id',
            `Invalid operationId "${operationId}" for ${method.toUpperCase()} ${pathKey}`,
            { sourceFile, method, path: pathKey },
          );
        }
        const prev = operationIds.get(operationId);
        if (prev) {
          throw new OpenApiError(
            'openapi_operation_id',
            `Duplicate operationId "${operationId}" (${prev.method.toUpperCase()} ${prev.path} and ${method.toUpperCase()} ${pathKey})`,
            { sourceFile, method, path: pathKey },
          );
        }
        operationIds.set(operationId, { method, path: pathKey });

        if (Array.isArray(op.tags)) {
          for (const t of op.tags) {
            if (typeof t === 'string') usedTags.add(t);
          }
        }

        const params = [
          ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
          ...(Array.isArray(op.parameters) ? op.parameters : []),
        ];
        if (params.length > OPENAPI_MAX_PARAMETERS_PER_OPERATION) {
          throw new OpenApiError(
            'openapi_limit_exceeded',
            `Parameters exceed ${OPENAPI_MAX_PARAMETERS_PER_OPERATION} for ${method.toUpperCase()} ${pathKey}`,
            { sourceFile, method, path: pathKey },
          );
        }
        for (let i = 0; i < params.length; i++) {
          validateParameter(
            params[i],
            document,
            sourceFile,
            `/paths/${escapePtr(pathKey)}/${method}/parameters/${i}`,
            method,
            pathKey,
          );
        }

        if (op.requestBody !== undefined) {
          validateRequestBody(
            op.requestBody,
            document,
            sourceFile,
            `/paths/${escapePtr(pathKey)}/${method}/requestBody`,
            method,
            pathKey,
          );
        }

        if (op.responses !== undefined) {
          if (!isPlainObject(op.responses)) {
            throw new OpenApiError('openapi_invalid_document', 'responses must be an object', {
              sourceFile,
              method,
              path: pathKey,
            });
          }
          const statuses = Object.keys(op.responses);
          if (statuses.length > OPENAPI_MAX_RESPONSES_PER_OPERATION) {
            throw new OpenApiError(
              'openapi_limit_exceeded',
              `Response status entries exceed ${OPENAPI_MAX_RESPONSES_PER_OPERATION}`,
              { sourceFile, method, path: pathKey },
            );
          }
          for (const [status, resp] of Object.entries(op.responses)) {
            if (!isPlainObject(resp)) continue;
            validateResponseObject(
              resp,
              document,
              sourceFile,
              `/paths/${escapePtr(pathKey)}/${method}/responses/${escapePtr(status)}`,
              method,
              pathKey,
            );
          }
        }

        if (op['x-codeSamples'] !== undefined) {
          parseCodeSamples(op['x-codeSamples'], {
            sourceFile,
            method,
            path: pathKey,
            pointer: `/paths/${escapePtr(pathKey)}/${method}/x-codeSamples`,
          });
        }
        if (op['x-nrdocs-cost'] !== undefined) {
          const defaults = parseRootCostDefaults(document, sourceFile);
          parseOperationCost(op['x-nrdocs-cost'], defaults, {
            sourceFile,
            method,
            path: pathKey,
            pointer: `/paths/${escapePtr(pathKey)}/${method}/x-nrdocs-cost`,
          });
        }

        assertExamplesLimit(op, pathItem, document, {
          sourceFile,
          method,
          path: pathKey,
        });
      }
    }
  }

  // Tag count
  const declaredTags = Array.isArray(document.tags)
    ? document.tags
        .filter((t) => isPlainObject(t) && typeof t.name === 'string')
        .map((t) => (t as { name: string }).name)
    : [];
  const allTags = new Set([...declaredTags, ...usedTags]);
  if (allTags.size > OPENAPI_MAX_TAGS) {
    throw new OpenApiError('openapi_limit_exceeded', `Tags exceed ${OPENAPI_MAX_TAGS}`, {
      sourceFile,
    });
  }

  // Named component schemas validated when referenced during normalize
  void dialect;
  return { document, openapiVersion, dialect };
}

function escapePtr(s: string): string {
  return s.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function isHttpMethod(m: string): m is OpenApiHttpMethod {
  return (OPENAPI_HTTP_METHODS as readonly string[]).includes(m);
}
