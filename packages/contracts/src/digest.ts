import { canonicalizeJsonBytes, type CanonicalJson } from './canonical-json.js';

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatSha256Digest(hex: string): string {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error('SHA-256 hex digest must be 64 lowercase hex characters');
  }
  return `sha256:${hex}`;
}

export function parseSha256Digest(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^sha256:([0-9a-f]{64})$/.exec(value);
  return m ? value : null;
}

/** Artifact digest = SHA-256 of canonical JSON of manifest with artifact.digest omitted. */
export async function artifactDigestFromDescriptor(
  descriptorWithoutDigest: CanonicalJson,
): Promise<string> {
  const bytes = canonicalizeJsonBytes(descriptorWithoutDigest);
  const hex = await sha256Hex(bytes);
  return formatSha256Digest(hex);
}
