/**
 * Session cookie management for password-protected docs.
 * Uses HMAC-SHA256 signing with the SESSION_SECRET.
 */

export interface SessionData {
  repo_id: string;
  password_version: number;
  expires_at: number;
}

/**
 * Creates a signed session cookie value.
 * Format: base64url(JSON(data)).base64url(HMAC-SHA256(data, secret))
 */
export async function createSessionCookie(
  data: SessionData,
  secret: string,
): Promise<string> {
  const payload = JSON.stringify(data);
  const payloadB64 = base64urlEncode(payload);
  const signature = await hmacSign(payload, secret);
  const signatureB64 = base64urlEncode(signature);
  return `${payloadB64}.${signatureB64}`;
}

/**
 * Validates and decodes a session cookie.
 * Returns null if invalid, expired, or tampered.
 */
export async function validateSessionCookie(
  cookie: string,
  secret: string,
): Promise<SessionData | null> {
  const dotIndex = cookie.indexOf('.');
  if (dotIndex === -1) return null;

  const payloadB64 = cookie.slice(0, dotIndex);
  const signatureB64 = cookie.slice(dotIndex + 1);

  if (!payloadB64 || !signatureB64) return null;

  let payload: string;
  try {
    payload = base64urlDecode(payloadB64);
  } catch {
    return null;
  }

  // Verify signature
  const expectedSignature = await hmacSign(payload, secret);
  const expectedB64 = base64urlEncode(expectedSignature);

  if (!constantTimeEqual(signatureB64, expectedB64)) {
    return null;
  }

  // Parse and validate data
  let data: SessionData;
  try {
    data = JSON.parse(payload) as SessionData;
  } catch {
    return null;
  }

  if (!data.repo_id || typeof data.password_version !== 'number' || typeof data.expires_at !== 'number') {
    return null;
  }

  // Check expiration
  if (Date.now() > data.expires_at) {
    return null;
  }

  return data;
}

/**
 * Extracts a session cookie from the request for a specific repo path.
 * Cookie name: __nrdocs_session_{owner}_{repo}
 */
export function getSessionCookie(
  request: Request,
  repoPath: string,
): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookieName = getSessionCookieName(repoPath);
  const cookies = parseCookies(cookieHeader);
  return cookies[cookieName] ?? null;
}

/**
 * Creates the Set-Cookie header value for a password session.
 */
export function buildSetCookieHeader(
  cookieValue: string,
  repoPath: string,
  maxAgeSeconds: number,
): string {
  const cookieName = getSessionCookieName(repoPath);
  const path = repoPath.endsWith('/') ? repoPath : `${repoPath}/`;
  return `${cookieName}=${cookieValue}; HttpOnly; Secure; SameSite=Lax; Path=${path}; Max-Age=${maxAgeSeconds}`;
}

/** Session cookie name derived from repo path. */
function getSessionCookieName(repoPath: string): string {
  // repoPath is like /owner/repo — normalize to owner_repo
  const normalized = repoPath.replace(/^\//, '').replace(/\/$/, '').replace(/\//g, '_');
  return `__nrdocs_session_${normalized}`;
}

/** Parse a Cookie header into key-value pairs. */
function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  const pairs = header.split(';');
  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) continue;
    const key = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();
    if (key) {
      cookies[key] = value;
    }
  }
  return cookies;
}

/** HMAC-SHA256 sign a string with a secret, returning raw bytes as a string of hex chars. */
async function hmacSign(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  // Return as hex string for consistent encoding
  const bytes = new Uint8Array(signature);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Base64url encode a string. */
function base64urlEncode(input: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64url decode to a string. */
function base64urlDecode(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

/** Constant-time string comparison. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
