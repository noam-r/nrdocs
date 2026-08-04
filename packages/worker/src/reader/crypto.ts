import { canonicalizeJson, type CanonicalJson } from '@nrdocs/contracts';

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  // btoa is available in Workers; Buffer in Node tests.
  if (typeof btoa === 'function') {
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  return Buffer.from(bytes).toString('base64url');
}

export function base64UrlToBytes(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const b64 = padded + pad;
    if (typeof atob === 'function') {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)!;
      return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  } catch {
    return null;
  }
}

export async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    Uint8Array.from(keyBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

export async function signV1Token(
  keyBytes: Uint8Array,
  payload: Record<string, CanonicalJson>,
): Promise<string> {
  const encoded = bytesToBase64Url(new TextEncoder().encode(canonicalizeJson(payload)));
  const signingInput = `v1.${encoded}`;
  const mac = await hmacSha256(keyBytes, signingInput);
  return `${signingInput}.${bytesToBase64Url(mac)}`;
}

export async function verifyV1Token(
  keyBytes: Uint8Array,
  token: string,
): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const [, encoded, sig] = parts;
  if (!encoded || !sig) return null;
  const signingInput = `v1.${encoded}`;
  const expected = await hmacSha256(keyBytes, signingInput);
  const actual = base64UrlToBytes(sig);
  if (!actual || actual.byteLength !== expected.byteLength) return null;
  let diff = 0;
  for (let i = 0; i < expected.byteLength; i++) diff |= expected[i]! ^ actual[i]!;
  if (diff !== 0) return null;
  const payloadBytes = base64UrlToBytes(encoded);
  if (!payloadBytes) return null;
  try {
    const raw = JSON.parse(new TextDecoder().decode(payloadBytes)) as unknown;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function unixSeconds(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000);
}
