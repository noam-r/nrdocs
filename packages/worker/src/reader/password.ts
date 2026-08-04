import { base64UrlToBytes, timingSafeEqual } from './crypto.js';

const VERIFIER_RE = /^pbkdf2-sha256\$600000\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;

/**
 * Verify a reader password against a stored PBKDF2 verifier.
 * Password bytes are used exactly as entered (no trim/NFC).
 */
export async function verifyReaderPassword(
  password: string,
  storedVerifier: string,
): Promise<boolean> {
  const m = VERIFIER_RE.exec(storedVerifier);
  if (!m) return false;
  const salt = base64UrlToBytes(m[1]!);
  const expected = base64UrlToBytes(m[2]!);
  if (!salt || salt.byteLength !== 16 || !expected || expected.byteLength !== 32) return false;

  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: Uint8Array.from(salt),
      iterations: 600_000,
    },
    key,
    256,
  );
  return timingSafeEqual(new Uint8Array(bits), expected);
}

export function passwordInputLooksPlausible(password: string): boolean {
  const scalars = [...password];
  if (scalars.length < 12 || scalars.length > 256) return false;
  if (new TextEncoder().encode(password).byteLength > 1024) return false;
  for (const ch of scalars) {
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0x00 && cp <= 0x1f) || (cp >= 0x7f && cp <= 0x9f)) return false;
  }
  return true;
}
