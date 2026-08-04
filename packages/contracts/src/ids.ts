/** Branded opaque identifiers used across CLI, Worker, and persistence. */

export type IdKind = 'inst' | 'site' | 'tok' | 'lock' | 'artifact' | 'req';

export type InstanceId = string & { readonly __brand: 'InstanceId' };
export type SiteId = string & { readonly __brand: 'SiteId' };
export type TokenRecordId = string & { readonly __brand: 'TokenRecordId' };
export type LockId = string & { readonly __brand: 'LockId' };
export type ArtifactId = string & { readonly __brand: 'ArtifactId' };
export type RequestId = string & { readonly __brand: 'RequestId' };

const ID_BODY = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const KIND_TO_PREFIX: Record<IdKind, string> = {
  inst: 'inst_',
  site: 'site_',
  tok: 'tok_',
  lock: 'lock_',
  artifact: 'artifact_',
  req: 'req_',
};

export function idPrefix(kind: IdKind): string {
  return KIND_TO_PREFIX[kind];
}

export function isIdKind(value: string): value is IdKind {
  return value in KIND_TO_PREFIX;
}

function parseKindId<T extends string>(
  kind: IdKind,
  value: unknown,
  brand: (s: string) => T,
): T | null {
  if (typeof value !== 'string') return null;
  const prefix = KIND_TO_PREFIX[kind];
  if (!value.startsWith(prefix)) return null;
  const body = value.slice(prefix.length);
  if (!ID_BODY.test(body)) return null;
  return brand(value);
}

export const parseInstanceId = (v: unknown): InstanceId | null =>
  parseKindId('inst', v, (s) => s as InstanceId);
export const parseSiteId = (v: unknown): SiteId | null =>
  parseKindId('site', v, (s) => s as SiteId);
export const parseTokenRecordId = (v: unknown): TokenRecordId | null =>
  parseKindId('tok', v, (s) => s as TokenRecordId);
export const parseLockId = (v: unknown): LockId | null =>
  parseKindId('lock', v, (s) => s as LockId);
export const parseArtifactId = (v: unknown): ArtifactId | null =>
  parseKindId('artifact', v, (s) => s as ArtifactId);
export const parseRequestId = (v: unknown): RequestId | null =>
  parseKindId('req', v, (s) => s as RequestId);

/** Crockford Base32 alphabet used for opaque ID bodies (ULID-compatible). */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function encodeCrockfordBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD[(value >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += CROCKFORD[(value << (5 - bits)) & 31]!;
  }
  return output;
}

/** Build an opaque ID from 16 random bytes (26-char Crockford body). */
export function formatId(kind: IdKind, random16: Uint8Array): string {
  if (random16.byteLength !== 16) {
    throw new Error('opaque IDs require exactly 16 random bytes');
  }
  return `${KIND_TO_PREFIX[kind]}${encodeCrockfordBase32(random16).slice(0, 26)}`;
}
