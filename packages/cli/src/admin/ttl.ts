/** Exact --ttl grammar from 02-cli-configuration-and-credentials.md */

const TTL_RE = /^([1-9][0-9]*)(m|h|d|w)$/;

const UNIT_SECONDS: Record<string, number> = {
  m: 60,
  h: 3600,
  d: 86_400,
  w: 604_800,
};

/** Maximum accepted TTL: 365 days = 31_536_000 seconds. */
export const MAX_TTL_SECONDS = 31_536_000;

export function parseTtlDuration(value: string): number {
  const m = TTL_RE.exec(value);
  if (!m) {
    throw new Error(
      'Invalid --ttl. Use a positive integer with unit m|h|d|w and no whitespace (example: 7d).',
    );
  }
  const amount = Number(m[1]);
  const unit = m[2]!;
  if (!Number.isSafeInteger(amount)) {
    throw new Error('Invalid --ttl: numeric overflow.');
  }
  const seconds = amount * UNIT_SECONDS[unit]!;
  if (!Number.isSafeInteger(seconds) || seconds > MAX_TTL_SECONDS) {
    throw new Error('Invalid --ttl: maximum accepted duration is 365d.');
  }
  return seconds;
}

export function addSecondsToRfc3339(iso: string, seconds: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error('invalid authoritative timestamp');
  const d = new Date(ms + seconds * 1000);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
