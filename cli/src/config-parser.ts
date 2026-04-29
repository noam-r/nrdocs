import { parse } from 'yaml';

export interface CliProjectConfig {
  slug: string;
  title: string;
  description: string;
  access_mode: 'public' | 'password';
}

const VALID_ACCESS_MODES = ['public', 'password'] as const;

/**
 * Parse and validate a project.yml YAML string into a CliProjectConfig.
 *
 * Validates required fields (slug, title, access_mode) and defaults
 * description to "" if absent. Throws descriptive errors for invalid
 * YAML syntax, missing fields, and invalid field values.
 */
export function parseProjectConfig(yamlContent: string): CliProjectConfig {
  let raw: unknown;
  try {
    raw = parse(yamlContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid YAML syntax: ${message}`);
  }

  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('project.yml must be a YAML mapping (object), not a scalar or array');
  }

  const obj = raw as Record<string, unknown>;

  const missing: string[] = [];
  if (obj.slug === undefined || obj.slug === null) missing.push('slug');
  if (obj.title === undefined || obj.title === null) missing.push('title');
  if (obj.access_mode === undefined || obj.access_mode === null) missing.push('access_mode');

  if (missing.length > 0) {
    throw new Error(`Missing required field(s): ${missing.join(', ')}`);
  }

  if (typeof obj.slug !== 'string' || obj.slug.trim() === '') {
    throw new Error('Invalid field "slug": must be a non-empty string');
  }

  if (typeof obj.title !== 'string' || obj.title.trim() === '') {
    throw new Error('Invalid field "title": must be a non-empty string');
  }

  if (
    typeof obj.access_mode !== 'string' ||
    !VALID_ACCESS_MODES.includes(obj.access_mode as typeof VALID_ACCESS_MODES[number])
  ) {
    throw new Error(
      `Invalid field "access_mode": must be "public" or "password", got "${String(obj.access_mode)}"`
    );
  }

  const description =
    obj.description !== undefined && obj.description !== null
      ? String(obj.description)
      : '';

  return {
    slug: obj.slug,
    title: obj.title,
    description,
    access_mode: obj.access_mode as 'public' | 'password',
  };
}

/**
 * Decode a base64url-encoded string to a UTF-8 string.
 */
function base64urlDecode(input: string): string {
  // Replace base64url characters with standard base64
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  // Pad with '=' to make length a multiple of 4
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';
  return atob(base64);
}

/**
 * Parse and structurally validate a token for CLI use.
 * Extracts iss for routing. Does NOT verify the HMAC signature.
 * Rejects tokens with aud but no iss (legacy format detection).
 */
export function parseCliToken(token: string): {
  iss: string;
  typ: string;
  v: number;
  exp: number;
  jti: string;
} {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  let payload: Record<string, unknown>;
  try {
    const decoded = base64urlDecode(parts[1]);
    payload = JSON.parse(decoded);
  } catch {
    throw new Error('Invalid token format');
  }

  // Legacy format detection: has aud but no iss
  if (payload.aud !== undefined && payload.iss === undefined) {
    throw new Error('Token format not supported. This token uses an outdated format.');
  }

  // Validate required claims
  const requiredClaims = ['v', 'typ', 'iss', 'exp', 'jti'] as const;
  for (const claim of requiredClaims) {
    if (payload[claim] === undefined) {
      throw new Error(`Invalid token: missing required claim '${claim}'`);
    }
  }

  const v = payload.v as number;
  const typ = payload.typ as string;
  const iss = payload.iss as string;
  const exp = payload.exp as number;
  const jti = payload.jti as string;

  // Validate v
  if (v !== 1) {
    throw new Error('Unsupported token version');
  }

  // Validate typ
  if (typ !== 'org_bootstrap' && typ !== 'repo_publish') {
    throw new Error('Unrecognized token type');
  }

  // Validate exp (reject expired tokens)
  if (exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Token has expired');
  }

  return { iss, typ, v, exp, jti };
}
