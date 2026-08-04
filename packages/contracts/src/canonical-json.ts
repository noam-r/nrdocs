/**
 * Canonical JSON serializer for artifact schema version 1.
 * - UTF-8, no BOM
 * - object keys sorted by Unicode code point
 * - arrays preserve order
 * - no insignificant whitespace
 * - one canonical string escaping form
 * - non-negative integers only (no floats)
 */

export type CanonicalJson =
  null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

function escapeString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (cp < 0x20) out += `\\u${cp.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

export function canonicalizeJson(value: CanonicalJson): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || !Number.isFinite(value)) {
      throw new Error('canonical JSON allows only non-negative integers');
    }
    return String(value);
  }
  if (typeof value === 'string') return escapeString(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizeJson(v)).join(',')}]`;
  }
  const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const body = keys.map((k) => `${escapeString(k)}:${canonicalizeJson(value[k]!)}`).join(',');
  return `{${body}}`;
}

export function canonicalizeJsonBytes(value: CanonicalJson): Uint8Array {
  return new TextEncoder().encode(canonicalizeJson(value));
}
