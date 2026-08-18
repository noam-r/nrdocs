import { base64UrlToBytes, timingSafeEqual } from './crypto.js';

const VERIFIER_RE = /^pbkdf2-sha256\$(\d{1,7})\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;
/** Current CLI mint; Cloudflare Workers cap PBKDF2 at this count. */
export const READER_PASSWORD_PBKDF2_ITERATIONS = 100_000;
/** Legacy label from the spec and from CLI builds that hashed at 100k but wrote 600000. */
const LEGACY_PBKDF2_ITERATIONS = 600_000;

type PasswordSubtle = Pick<SubtleCrypto, 'importKey' | 'deriveBits' | 'deriveKey' | 'exportKey'>;

/**
 * Verify a reader password against a stored PBKDF2 verifier.
 * Password bytes are used exactly as entered (no trim/NFC).
 */
export async function verifyReaderPassword(
  password: string,
  storedVerifier: string,
  subtle: PasswordSubtle = globalThis.crypto.subtle,
): Promise<boolean> {
  const m = VERIFIER_RE.exec(storedVerifier);
  if (!m) return false;
  const labeled = Number(m[1]);
  if (labeled !== READER_PASSWORD_PBKDF2_ITERATIONS && labeled !== LEGACY_PBKDF2_ITERATIONS) {
    return false;
  }
  const salt = base64UrlToBytes(m[2]!);
  const expected = base64UrlToBytes(m[3]!);
  if (!salt || salt.byteLength !== 16 || !expected || expected.byteLength !== 32) return false;

  const key = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey'],
  );
  const saltCopy = Uint8Array.from(salt);
  const candidates =
    labeled === LEGACY_PBKDF2_ITERATIONS
      ? [LEGACY_PBKDF2_ITERATIONS, READER_PASSWORD_PBKDF2_ITERATIONS]
      : [READER_PASSWORD_PBKDF2_ITERATIONS];

  for (const iterations of candidates) {
    try {
      const derived = await pbkdf2Sha256(subtle, key, saltCopy, iterations);
      if (timingSafeEqual(derived, expected)) return true;
    } catch (error) {
      if (!isUnsupportedPbkdf2(error)) throw error;
    }
  }
  return false;
}

async function pbkdf2Sha256(
  subtle: PasswordSubtle,
  key: CryptoKey,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const params = {
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt,
    iterations,
  } as const;
  try {
    const bits = await subtle.deriveBits(params, key, 256);
    return new Uint8Array(bits);
  } catch (error) {
    if (isUnsupportedPbkdf2(error)) throw error;
    // Some runtimes reject deriveBits(PBKDF2) but support deriveKey+export.
    const derivedKey = await subtle.deriveKey(
      params,
      key,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      true,
      ['sign'],
    );
    const raw = await subtle.exportKey('raw', derivedKey);
    return new Uint8Array(raw);
  }
}

function isUnsupportedPbkdf2(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  return name === 'NotSupportedError' || /iteration/i.test(message) || /Pbkdf2/i.test(message);
}

export function passwordInputLooksPlausible(password: string): boolean {
  const length = [...password].length;
  return length >= 1 && length <= 256;
}
