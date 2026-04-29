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
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Import a secret string as a CryptoKey for HMAC-SHA256. */
async function importKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

const JWT_HEADER = '{"alg":"HS256","typ":"JWT"}';

/**
 * Create an HMAC-SHA256 signed JWT.
 *
 * @param payload - Claims to include in the token
 * @param secret - HMAC signing key string
 * @returns Signed JWT string: base64url(header).base64url(payload).base64url(signature)
 */
export async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();

  const headerB64 = toBase64Url(encoder.encode(JWT_HEADER).buffer as ArrayBuffer);
  const payloadB64 = toBase64Url(encoder.encode(JSON.stringify(payload)).buffer as ArrayBuffer);
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));

  return `${signingInput}.${toBase64Url(signature)}`;
}

/**
 * Verify an HMAC-SHA256 signed JWT and return the decoded payload.
 * Throws if the signature is invalid or the token is malformed.
 *
 * @param token - JWT string to verify
 * @param secret - HMAC signing key string
 * @returns Decoded payload object
 */
export async function verifyJwt(
  token: string,
  secret: string,
): Promise<Record<string, unknown>> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importKey(secret);
  const encoder = new TextEncoder();
  const signatureBytes = fromBase64Url(signatureB64);

  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    encoder.encode(signingInput),
  );

  if (!valid) {
    throw new Error('Invalid JWT signature');
  }

  return JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
}

/**
 * Decode the payload segment of a JWT without verifying the signature.
 *
 * @param token - JWT string
 * @returns Decoded payload object
 */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  return JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1])));
}

/** Claims present in all NRDocs tokens (Phase 1). */
export interface NrdocsTokenPayload {
  v: number;
  typ: string;
  iss: string;
  exp: number;
  jti: string;
}

/**
 * Decode the header segment of a JWT without verifying the signature.
 * Throws on malformed tokens (not 3 segments, invalid base64url, invalid JSON).
 *
 * @param token - JWT string
 * @returns Decoded header object
 */
export function decodeJwtHeader(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
  } catch {
    throw new Error('Invalid JWT header');
  }
}

/**
 * Validate a decoded JWT header object.
 * Returns `{ valid: true }` if the header is exactly `{ alg: "HS256", typ: "JWT" }`.
 * Returns `{ valid: false, reason }` otherwise.
 *
 * @param header - Decoded header object
 */
export function validateJwtHeader(
  header: Record<string, unknown>,
): { valid: true } | { valid: false; reason: string } {
  if (header.alg !== 'HS256') {
    return { valid: false, reason: 'Unsupported algorithm' };
  }
  if (header.typ !== 'JWT') {
    return { valid: false, reason: 'Unsupported header type' };
  }
  const keys = Object.keys(header);
  if (keys.length !== 2) {
    return { valid: false, reason: 'Invalid token header: unexpected fields' };
  }
  return { valid: true };
}

const ALLOWED_NRDOCS_CLAIMS = new Set(['v', 'typ', 'iss', 'exp', 'jti']);

/**
 * Sign a token with the NRDocs payload format.
 * Enforces that only v, typ, iss, exp, jti are present before signing.
 *
 * @param payload - NRDocs token payload
 * @param secret - HMAC signing key string
 * @returns Signed JWT string
 */
export async function signNrdocsToken(
  payload: NrdocsTokenPayload,
  secret: string,
): Promise<string> {
  const keys = Object.keys(payload);
  if (keys.length !== ALLOWED_NRDOCS_CLAIMS.size || !keys.every((k) => ALLOWED_NRDOCS_CLAIMS.has(k))) {
    throw new Error('Payload must contain exactly v, typ, iss, exp, jti');
  }
  return signJwt(payload as unknown as Record<string, unknown>, secret);
}

/**
 * Full server-side JWT verification: parse segments, validate header,
 * verify HMAC-SHA256 signature, return decoded header and payload.
 * Does NOT check payload claims (v, typ, iss, exp) — that is the caller's responsibility.
 *
 * @param token - JWT string to verify
 * @param secret - HMAC signing key string
 * @returns Decoded header and payload objects
 */
export async function verifyJwtStrict(
  token: string,
  secret: string,
): Promise<{ header: Record<string, unknown>; payload: Record<string, unknown> }> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  // Decode and validate header
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
  } catch {
    throw new Error('Invalid token header');
  }

  const headerResult = validateJwtHeader(header);
  if (!headerResult.valid) {
    throw new Error(headerResult.reason);
  }

  // Verify HMAC-SHA256 signature
  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importKey(secret);
  const encoder = new TextEncoder();
  const signatureBytes = fromBase64Url(signatureB64);

  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    encoder.encode(signingInput),
  );

  if (!valid) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
  return { header, payload };
}
