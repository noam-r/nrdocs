import { OpenApiError } from './errors.js';
import { OPENAPI_BUNDLED_MAX_BYTES } from './limits.js';
import { canonicalizeCostAmount } from './validate.js';

const PRESERVED_EXTENSIONS = new Set(['x-codeSamples', 'x-nrdocs-cost', 'x-nrdocs-costs']);
const COST_AMOUNT_TOKEN_RE = /^(0|[1-9]\d*)(\.\d{1,6})?$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const key of keys) {
    let v = value[key];
    if (key === 'x-nrdocs-cost' && isPlainObject(v) && v.amount !== undefined) {
      const amountStr = canonicalizeCostAmount(v.amount, {});
      v = { ...v, amount: amountStr };
    }
    if (key.startsWith('x-') && !PRESERVED_EXTENSIONS.has(key)) {
      continue;
    }
    out[key] = sortKeysDeep(v);
  }
  return out;
}

/**
 * Produce deterministic self-contained OpenAPI JSON (UTF-8).
 * Local file `$ref` values are expected to already be hoisted into
 * `#/components/...` by load(); remaining `#/…` refs are preserved.
 * Unsupported vendor extensions are stripped.
 */
export function bundleOpenApiJson(document: unknown): Uint8Array {
  if (!isPlainObject(document)) {
    throw new OpenApiError('openapi_invalid_document', 'Cannot bundle non-object OpenAPI document');
  }
  const sorted = sortKeysDeep(document);
  const json = `${stableStringify(sorted)}\n`;
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength > OPENAPI_BUNDLED_MAX_BYTES) {
    throw new OpenApiError(
      'openapi_limit_exceeded',
      `Bundled openapi.json exceeds ${OPENAPI_BUNDLED_MAX_BYTES} bytes`,
    );
  }
  return bytes;
}

/**
 * Pretty JSON with sorted keys. For `x-nrdocs-cost.amount`, embeds the canonical
 * decimal string as a raw JSON number token (avoids float drift / scientific notation).
 */
function stableStringify(value: unknown): string {
  return stringifyNode(value, null, 0);
}

function stringifyNode(value: unknown, parentKey: string | null, indent: number): string {
  const pad = '  '.repeat(indent);
  const padInner = '  '.repeat(indent + 1);

  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new OpenApiError(
        'openapi_invalid_document',
        'Cannot serialize non-finite number in OpenAPI bundle',
      );
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => `${padInner}${stringifyNode(item, null, indent + 1)}`);
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  if (!isPlainObject(value)) {
    throw new OpenApiError(
      'openapi_invalid_document',
      'Cannot serialize non-JSON value in OpenAPI bundle',
    );
  }

  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';

  const isCost = parentKey === 'x-nrdocs-cost';
  const parts: string[] = [];
  for (const key of keys) {
    const child = value[key];
    let serialized: string;
    if (
      isCost &&
      key === 'amount' &&
      typeof child === 'string' &&
      COST_AMOUNT_TOKEN_RE.test(child)
    ) {
      serialized = child;
    } else {
      serialized = stringifyNode(child, key, indent + 1);
    }
    parts.push(`${padInner}${JSON.stringify(key)}: ${serialized}`);
  }
  return `{\n${parts.join(',\n')}\n${pad}}`;
}
