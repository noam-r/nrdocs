/**
 * PasswordHasher — Workers-compatible password hashing using PBKDF2-SHA256.
 *
 * Uses Web Crypto API (available in Cloudflare Workers) with high iteration count.
 * Hash format: `pbkdf2:<iterations>:<salt_base64>:<hash_base64>`
 *
 * The interface (`hash` / `verify`) is designed so the underlying KDF can be
 * swapped to scrypt in a future iteration without changing callers.
 *
 * @module
 * Requirements: 5.2, 5.7
 */

const ALGORITHM = 'pbkdf2';
const ITERATIONS = 100_000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;
const DIGEST = 'SHA-256';

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(
  plaintext: string,
  salt: Uint8Array,
  iterations: number,
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(plaintext),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: DIGEST,
    },
    keyMaterial,
    HASH_BYTES * 8,
  );
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

export class PasswordHasher {
  /**
   * Hash a plaintext password.
   * Returns a string in the format `pbkdf2:<iterations>:<salt_base64>:<hash_base64>`.
   */
  static async hash(plaintext: string): Promise<string> {
    const salt = new Uint8Array(SALT_BYTES);
    crypto.getRandomValues(salt);

    const derived = await deriveKey(plaintext, salt, ITERATIONS);

    return [
      ALGORITHM,
      ITERATIONS.toString(),
      toBase64(salt.buffer),
      toBase64(derived),
    ].join(':');
  }

  /**
   * Verify a plaintext password against a stored hash string.
   * Uses constant-time comparison to prevent timing attacks.
   */
  static async verify(plaintext: string, storedHash: string): Promise<boolean> {
    const parts = storedHash.split(':');
    if (parts.length !== 4 || parts[0] !== ALGORITHM) {
      return false;
    }

    const iterations = parseInt(parts[1], 10);
    if (isNaN(iterations) || iterations <= 0) {
      return false;
    }

    const salt = fromBase64(parts[2]);
    const expectedHash = fromBase64(parts[3]);

    const derived = await deriveKey(plaintext, salt, iterations);

    return timingSafeEqual(new Uint8Array(derived), expectedHash);
  }
}
