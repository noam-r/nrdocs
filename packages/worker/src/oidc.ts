/**
 * GitHub OIDC JWT token verification using Web Crypto.
 */

export interface OidcClaims {
  repository: string;
  repository_id: string;
  repository_owner: string;
  repository_owner_id: string;
  ref: string;
  sha: string;
  workflow_ref?: string;
  run_id?: string;
  aud?: string;
  iss?: string;
}

const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB_JWKS_URL = 'https://token.actions.githubusercontent.com/.well-known/jwks';

// Cache JWKS keys in module scope (per-isolate)
let cachedKeys: Map<string, CryptoKey> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Verifies a GitHub OIDC JWT token.
 */
export async function verifyGithubOidc(
  token: string,
  expectedAudience: string,
): Promise<{ ok: true; claims: OidcClaims } | { ok: false; error: string }> {
  // Split JWT
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { ok: false, error: 'Invalid JWT format: expected 3 parts' };
  }

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  // Decode header
  let header: JwtHeader;
  try {
    header = JSON.parse(base64urlDecode(headerB64)) as JwtHeader;
  } catch (_e) {
    return { ok: false, error: 'Invalid JWT header' };
  }

  if (header.alg !== 'RS256') {
    return { ok: false, error: `Unsupported algorithm: ${header.alg}` };
  }

  if (!header.kid) {
    return { ok: false, error: 'JWT header missing kid' };
  }

  // Decode payload
  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64)) as JwtPayload;
  } catch (_e) {
    return { ok: false, error: 'Invalid JWT payload' };
  }

  // Validate standard claims
  const claimError = validateStandardClaims(payload, expectedAudience);
  if (claimError) {
    return { ok: false, error: claimError };
  }

  // Fetch JWKS and verify signature
  const keys = await fetchJwks();
  const key = keys.get(header.kid);
  if (!key) {
    // Try refreshing cache in case keys rotated
    cachedKeys = null;
    const refreshedKeys = await fetchJwks();
    const refreshedKey = refreshedKeys.get(header.kid);
    if (!refreshedKey) {
      return { ok: false, error: `Unknown key ID: ${header.kid}` };
    }
    const valid = await verifySignature(refreshedKey, headerB64, payloadB64, signatureB64);
    if (!valid) {
      return { ok: false, error: 'Invalid JWT signature' };
    }
  } else {
    const valid = await verifySignature(key, headerB64, payloadB64, signatureB64);
    if (!valid) {
      return { ok: false, error: 'Invalid JWT signature' };
    }
  }

  // Extract claims
  const claims: OidcClaims = {
    repository: payload.repository ?? '',
    repository_id: payload.repository_id ?? '',
    repository_owner: payload.repository_owner ?? '',
    repository_owner_id: payload.repository_owner_id ?? '',
    ref: payload.ref ?? '',
    sha: payload.sha ?? '',
    workflow_ref: payload.workflow_ref,
    run_id: payload.run_id,
    aud: typeof payload.aud === 'string' ? payload.aud : payload.aud?.[0],
    iss: payload.iss,
  };

  if (!claims.repository) {
    return { ok: false, error: 'Token missing repository claim' };
  }

  return { ok: true, claims };
}

/**
 * Validates standard JWT claims (iss, aud, exp, nbf).
 * Exported for unit testing.
 */
export function validateStandardClaims(
  payload: JwtPayload,
  expectedAudience: string,
): string | null {
  // Validate issuer
  if (payload.iss !== GITHUB_OIDC_ISSUER) {
    return `Invalid issuer: ${payload.iss}`;
  }

  // Validate audience
  const aud = typeof payload.aud === 'string' ? [payload.aud] : payload.aud;
  if (!aud || !aud.includes(expectedAudience)) {
    return `Invalid audience: expected ${expectedAudience}`;
  }

  const now = Math.floor(Date.now() / 1000);

  // Validate expiration (with 60s clock skew tolerance)
  if (payload.exp !== undefined && payload.exp < now - 60) {
    return 'Token has expired';
  }

  // Validate not-before (with 60s clock skew tolerance)
  if (payload.nbf !== undefined && payload.nbf > now + 60) {
    return 'Token not yet valid';
  }

  return null;
}

/**
 * Decodes a base64url-encoded string to a UTF-8 string.
 * Exported for unit testing.
 */
export function base64urlDecode(input: string): string {
  const bytes = base64urlDecodeBytes(input);
  return new TextDecoder().decode(bytes);
}

/**
 * Decodes a base64url-encoded string to bytes.
 */
export function base64urlDecodeBytes(input: string): Uint8Array {
  // Convert base64url to base64
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Verifies an RS256 signature using Web Crypto.
 */
async function verifySignature(
  key: CryptoKey,
  headerB64: string,
  payloadB64: string,
  signatureB64: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${headerB64}.${payloadB64}`);
  const signature = base64urlDecodeBytes(signatureB64);

  return crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    signature,
    data,
  );
}

/**
 * Fetches and caches GitHub's JWKS keys.
 */
async function fetchJwks(): Promise<Map<string, CryptoKey>> {
  const now = Date.now();
  if (cachedKeys && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedKeys;
  }

  const response = await fetch(GITHUB_JWKS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status}`);
  }

  const jwks = (await response.json()) as JwksResponse;
  const keys = new Map<string, CryptoKey>();

  for (const jwk of jwks.keys) {
    if (jwk.kty !== 'RSA' || jwk.alg !== 'RS256' || !jwk.kid) continue;

    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: jwk.kty,
        n: jwk.n,
        e: jwk.e,
        alg: 'RS256',
      },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    keys.set(jwk.kid, cryptoKey);
  }

  cachedKeys = keys;
  cacheTimestamp = now;
  return keys;
}

// --- Internal types ---

interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

export interface JwtPayload {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  sub?: string;
  repository?: string;
  repository_id?: string;
  repository_owner?: string;
  repository_owner_id?: string;
  ref?: string;
  sha?: string;
  workflow_ref?: string;
  run_id?: string;
  [key: string]: unknown;
}

interface JwksResponse {
  keys: JwkKey[];
}

interface JwkKey {
  kty: string;
  alg?: string;
  kid?: string;
  n?: string;
  e?: string;
  use?: string;
}
