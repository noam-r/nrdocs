import type { SessionTokenPayload, TokenValidationResult } from '../types';

const CURRENT_TOKEN_VERSION = 1;

/** Encode bytes to base64url (no padding). */
function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
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
  const keyBytes = encoder.encode(signingKey);
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
   * Create a session token for a project.
   *
   * @param projectId - Internal project UUID
   * @param passwordVersion - Current password version at time of issuance
   * @param signingKey - HMAC signing key string
   * @param ttl - Token time-to-live in seconds
   * @returns Token string in format `base64url(payload).base64url(signature)`
   */
  async create(
    projectId: string,
    passwordVersion: number,
    signingKey: string,
    ttl: number,
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload: SessionTokenPayload = {
      v: CURRENT_TOKEN_VERSION,
      pid: projectId,
      iat: now,
      exp: now + ttl,
      pv: passwordVersion,
    };

    const encoder = new TextEncoder();
    const payloadBytes = encoder.encode(JSON.stringify(payload));
    const payloadB64 = toBase64Url(payloadBytes.buffer as ArrayBuffer);

    const key = await importSigningKey(signingKey);
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, payloadBytes);
    const signatureB64 = toBase64Url(signatureBuffer);

    return `${payloadB64}.${signatureB64}`;
  },

  /**
   * Validate a session token.
   *
   * @param token - Token string to validate
   * @param signingKey - HMAC signing key string
   * @param currentPasswordVersion - Current password version from D1
   * @returns Validation result with projectId on success, or rejection reason
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

    // Check token version
    if (payload.v !== CURRENT_TOKEN_VERSION) {
      return { valid: false, reason: 'unrecognized token version' };
    }

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      return { valid: false, reason: 'token expired' };
    }

    // Check password version
    if (payload.pv !== currentPasswordVersion) {
      return { valid: false, reason: 'password version mismatch' };
    }

    return { valid: true, projectId: payload.pid };
  },
};
