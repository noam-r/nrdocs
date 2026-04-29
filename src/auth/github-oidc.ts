const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB_OIDC_JWKS_URL = 'https://token.actions.githubusercontent.com/.well-known/jwks';

function base64urlToUint8Array(input: string): Uint8Array {
  const pad = '='.repeat((4 - (input.length % 4)) % 4);
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64urlToJson(input: string): Record<string, unknown> {
  const bytes = base64urlToUint8Array(input);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as Record<string, unknown>;
}

function jsonError(message: string): Error {
  return new Error(message);
}

function isJsonWebKey(value: unknown): value is JsonWebKey {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.kty === 'string';
}

export interface GitHubOidcClaims {
  issuer: string;
  audience: string | string[];
  repository: string;
  repository_owner?: string;
  ref?: string;
  sha?: string;
  workflow?: string;
  job_workflow_ref?: string;
  run_id?: number;
  exp: number;
  iat?: number;
}

/**
 * Verify a GitHub Actions OIDC token (JWT) using the issuer JWKS.
 *
 * - Verifies RS256 signature (WebCrypto)
 * - Verifies iss, aud, and exp
 * - Extracts the repo identity from the `repository` claim ("owner/repo")
 */
export async function verifyGitHubActionsOidcToken(
  token: string,
  opts: { expectedAudience: string },
): Promise<GitHubOidcClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw jsonError('Invalid OIDC token (not a JWT)');
  const [headerB64, payloadB64, sigB64] = parts;
  const header = base64urlToJson(headerB64);
  const payload = base64urlToJson(payloadB64);

  const alg = header['alg'];
  const kid = header['kid'];
  if (alg !== 'RS256') throw jsonError(`Unsupported OIDC token alg: ${String(alg)}`);
  if (typeof kid !== 'string' || !kid) throw jsonError('OIDC token missing kid');

  // Fetch JWKS
  const jwksRes = await fetch(GITHUB_OIDC_JWKS_URL);
  if (!jwksRes.ok) throw jsonError(`Failed to fetch GitHub OIDC JWKS (${jwksRes.status})`);
  const jwks = (await jwksRes.json()) as { keys?: Array<Record<string, unknown>> };
  const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
  const jwk = keys.find((k) => k && typeof k === 'object' && k['kid'] === kid);
  if (!jwk) throw jsonError('GitHub OIDC JWKS key not found for token kid');
  if (!isJsonWebKey(jwk)) throw jsonError('GitHub OIDC JWKS key is invalid');

  // Import public key and verify signature
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64urlToUint8Array(sigB64);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signingInput);
  if (!ok) throw jsonError('Invalid OIDC token signature');

  // Validate standard claims
  const iss = payload['iss'];
  if (iss !== GITHUB_OIDC_ISSUER) throw jsonError('Invalid OIDC token issuer');

  const aud = payload['aud'];
  const expectedAud = opts.expectedAudience;
  const audOk = Array.isArray(aud)
    ? aud.includes(expectedAud)
    : aud === expectedAud;
  if (!audOk) throw jsonError('Invalid OIDC token audience');

  const exp = payload['exp'];
  if (typeof exp !== 'number') throw jsonError('OIDC token missing exp');
  const now = Math.floor(Date.now() / 1000);
  if (exp <= now) throw jsonError('OIDC token expired');

  const repository = payload['repository'];
  if (typeof repository !== 'string' || !repository.includes('/')) {
    throw jsonError('OIDC token missing repository claim');
  }

  return {
    issuer: iss as string,
    audience: aud as string | string[],
    repository,
    repository_owner: typeof payload['repository_owner'] === 'string' ? payload['repository_owner'] as string : undefined,
    ref: typeof payload['ref'] === 'string' ? payload['ref'] as string : undefined,
    sha: typeof payload['sha'] === 'string' ? payload['sha'] as string : undefined,
    workflow: typeof payload['workflow'] === 'string' ? payload['workflow'] as string : undefined,
    job_workflow_ref: typeof payload['job_workflow_ref'] === 'string' ? payload['job_workflow_ref'] as string : undefined,
    run_id: typeof payload['run_id'] === 'number' ? payload['run_id'] as number : undefined,
    exp,
    iat: typeof payload['iat'] === 'number' ? payload['iat'] as number : undefined,
  };
}

