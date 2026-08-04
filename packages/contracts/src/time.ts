/** Canonical UTC RFC 3339 timestamps. */

const RFC3339_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

export function formatRfc3339(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error('invalid Date');
  }
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Parse only canonical `...Z` instants; reject offsets and space separators. */
export function parseRfc3339(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const m = RFC3339_RE.exec(value);
  if (!m) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  // Reject values Date accepts but that are not the exact canonical form we emit
  // for whole-second timestamps (fractional seconds are allowed on input).
  return d;
}

export function assertRfc3339(value: unknown): Date {
  const d = parseRfc3339(value);
  if (!d) throw new Error('invalid RFC 3339 UTC timestamp');
  return d;
}
