import { sha256Hex, formatSha256Digest } from '@nrdocs/contracts';

/** Cloudflare Workers reject PBKDF2 iteration counts above 100,000. */
export const READER_PASSWORD_PBKDF2_ITERATIONS = 100_000 as const;

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** Validate reader password input rules (07-security). */
export function assertReaderPassword(password: string): void {
  const length = [...password].length;
  if (length < 1 || length > 256) {
    throw new Error('Reader password must contain 1 through 256 characters.');
  }
}

export async function derivePasswordVerifier(
  password: string,
  randomSalt16?: Uint8Array,
): Promise<string> {
  assertReaderPassword(password);
  const salt = randomSalt16 ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
  if (salt.byteLength !== 16) throw new Error('password salt must be 16 bytes');

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
      salt,
      iterations: READER_PASSWORD_PBKDF2_ITERATIONS,
    },
    key,
    256,
  );
  const derived = new Uint8Array(bits);
  return `pbkdf2-sha256$${READER_PASSWORD_PBKDF2_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(derived)}`;
}

export async function generatePublishingToken(
  random32?: Uint8Array,
): Promise<{ plaintext: string; verifier: string }> {
  const secret = random32 ?? globalThis.crypto.getRandomValues(new Uint8Array(32));
  if (secret.byteLength !== 32) throw new Error('token secret must be 32 bytes');
  const plaintext = `nrd_pub_${bytesToBase64Url(secret)}`;
  if (!/^nrd_pub_[A-Za-z0-9_-]{43}$/.test(plaintext)) {
    throw new Error('generated publishing token has invalid shape');
  }
  const digest = await sha256Hex(new TextEncoder().encode(plaintext));
  return { plaintext, verifier: formatSha256Digest(digest) };
}
