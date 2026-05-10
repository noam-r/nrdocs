/**
 * Password hashing using Web Crypto API (PBKDF2-HMAC-SHA-256).
 * Compatible with Cloudflare Workers runtime.
 */

import { DEFAULT_PBKDF2_ITERATIONS } from '@nrdocs/shared';

export interface HashResult {
  hash: string;
  salt: string;
  iteration_count: number;
}

/**
 * Hashes a password using PBKDF2-HMAC-SHA-256.
 * Returns hex-encoded hash and salt.
 */
export async function hashPassword(
  password: string,
  iterations?: number,
): Promise<HashResult> {
  const iterationCount = iterations ?? DEFAULT_PBKDF2_ITERATIONS;

  // Generate 16 bytes of random salt
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);

  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  // Import password as key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  // Derive 32 bytes (256 bits)
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: iterationCount,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );

  return {
    hash: bytesToHex(new Uint8Array(derivedBits)),
    salt: bytesToHex(saltBytes),
    iteration_count: iterationCount,
  };
}

/**
 * Verifies a password against a stored hash.
 */
export async function verifyPassword(
  password: string,
  hash: string,
  salt: string,
  iterationCount: number,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  const saltBytes = hexToBytes(salt);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: iterationCount,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );

  const derivedHex = bytesToHex(new Uint8Array(derivedBits));
  return constantTimeEqual(derivedHex, hash);
}

/** Convert a Uint8Array to a hex string. */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Convert a hex string to a Uint8Array. */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Constant-time string comparison for hex-encoded hashes. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
