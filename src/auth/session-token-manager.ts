import type { SessionTokenPayload, TokenValidationResult } from '../types';

const CURRENT_TOKEN_VERSION = 1;

/**
 * Encode bytes to base64url (no padding).
 * Pass a Uint8Array (or exact slice) — do NOT pass `u8.buffer` alone; pooled encoders
 * reuse a large ArrayBuffer and only the view’s length is valid (Workers vs Node).
 */
function toBase64UrlBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode base64url string to bytes. */
function fromBase64Url(str: string): Uint8Array {
  // Restore standard base64 characters and padding
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Import a signing key string as a CryptoKey for HMAC-SHA256. */
async function importSigningKey(signingKey: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(signingKey.trim());
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export const SessionTokenManager = {
  /**
   * Create a session token for a repo (docs site).
   *
   * @param repoId - Internal repo UUID
   * @param passwordVersion - Current password version at time of issuance
   * @param signingKey - HMAC signing key string
   * @param ttl - Token time-to-live in seconds
   * @returns Token string in format `base64url(payload).base64url(signature)`
   */
  async create(
    repoId: string,
    passwordVersion: number,
    signingKey: string,
    ttl: number,
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const pv = Number(passwordVersion);
    const payload: SessionTokenPayload = {
      v: CURRENT_TOKEN_VERSION,
      rid: repoId,
      iat: now,
      exp: now + ttl,
      pv: Number.isFinite(pv) ? pv : 0,
    };

    const encoder = new TextEncoder();
    const payloadBytes = encoder.encode(JSON.stringify(payload));
    const payloadB64 = toBase64UrlBytes(payloadBytes);

    const key = await importSigningKey(signingKey);
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, payloadBytes);
    const signatureB64 = toBase64UrlBytes(new Uint8Array(signatureBuffer));

    return `${payloadB64}.${signatureB64}`;
  },

  /**
   * Validate a session token.
   *
   * @param token - Token string to validate
   * @param signingKey - HMAC signing key string
   * @param currentPasswordVersion - Current password version from D1
   * @returns Validation result with repoId on success, or rejection reason
   */
  async validate(
    token: string,
    signingKey: string,
    currentPasswordVersion: number,
  ): Promise<TokenValidationResult> {
    const dotIndex = token.indexOf('.');
    if (dotIndex === -1 || dotIndex === 0 || dotIndex === token.length - 1) {
      return { valid: false, reason: 'invalid token format' };
    }

    const payloadB64 = token.substring(0, dotIndex);
    const signatureB64 = token.substring(dotIndex + 1);

    // Verify HMAC signature
    let payloadBytes: Uint8Array;
    let signatureBytes: Uint8Array;
    try {
      payloadBytes = fromBase64Url(payloadB64);
      signatureBytes = fromBase64Url(signatureB64);
    } catch {
      return { valid: false, reason: 'invalid token encoding' };
    }

    const key = await importSigningKey(signingKey);
    const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, payloadBytes);
    if (!valid) {
      return { valid: false, reason: 'invalid signature' };
    }

    // Parse payload
    let payload: SessionTokenPayload;
    try {
      const decoder = new TextDecoder();
      payload = JSON.parse(decoder.decode(payloadBytes));
    } catch {
      return { valid: false, reason: 'invalid payload' };
    }

    // Check token version (coerce: JSON may parse numeric fields loosely)
    if (Number(payload.v) !== CURRENT_TOKEN_VERSION) {
      return { valid: false, reason: 'unrecognized token version' };
    }

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      return { valid: false, reason: 'token expired' };
    }

    // Check password version (coerce: D1/SQLite may return numeric columns as strings)
    const tokenPv = Number(payload.pv);
    const rowPv = Number(currentPasswordVersion);
    if (!Number.isFinite(tokenPv) || !Number.isFinite(rowPv) || tokenPv !== rowPv) {
      return { valid: false, reason: 'password version mismatch' };
    }

    return { valid: true, repoId: String(payload.rid ?? '').trim() };
  },
};
