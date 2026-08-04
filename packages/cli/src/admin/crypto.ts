import { sha256Hex, formatSha256Digest } from '@nrdocs/contracts';

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function isControl(cp: number): boolean {
  return (cp >= 0x00 && cp <= 0x1f) || (cp >= 0x7f && cp <= 0x9f);
}

/** Validate reader password input rules (07-security). */
export function assertReaderPassword(password: string): void {
  const scalars = [...password];
  if (scalars.length < 12 || scalars.length > 256) {
    throw new Error('Reader password must contain 12 through 256 characters.');
  }
  const utf8 = new TextEncoder().encode(password);
  if (utf8.byteLength > 1024) {
    throw new Error('Reader password exceeds 1024 UTF-8 bytes.');
  }
  for (const ch of scalars) {
    if (isControl(ch.codePointAt(0)!)) {
      throw new Error('Reader password must not contain control characters.');
    }
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
      iterations: 600_000,
    },
    key,
    256,
  );
  const derived = new Uint8Array(bits);
  return `pbkdf2-sha256$600000$${bytesToBase64Url(salt)}$${bytesToBase64Url(derived)}`;
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
