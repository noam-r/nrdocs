import type { NrdocsTokenPayload } from '../auth/jwt-utils';
import { verifyJwtStrict } from '../auth/jwt-utils';
import type { DataStore } from '../interfaces/data-store';
import type { BootstrapToken, RepoPublishToken } from '../types';

export interface TokenValidationSuccess {
  valid: true;
  payload: NrdocsTokenPayload;
  dbRecord: BootstrapToken | RepoPublishToken;
}

export interface TokenValidationFailure {
  valid: false;
  reason: string;
  statusCode: number;
}

export type TokenValidationResult = TokenValidationSuccess | TokenValidationFailure;

const SUPPORTED_VERSIONS = new Set([1]);
const RECOGNIZED_TYPES = new Set(['org_bootstrap', 'repo_publish']);

/**
 * Implements the 17-step server-side token validation sequence.
 *
 * Steps 1-8:  structural + cryptographic validation (via verifyJwtStrict)
 * Steps 9-12: claim validation (v, typ, iss, exp)
 * Steps 14-16: DB lookup + status check
 * Step 17:    return validated payload and DB record
 */
export async function validateToken(
  token: string,
  signingKey: string,
  expectedIssuer: string,
  dataStore: DataStore,
  expectedType?: 'org_bootstrap' | 'repo_publish',
): Promise<TokenValidationResult> {
  // Steps 1-8: structural + cryptographic validation
  let payload: Record<string, unknown>;
  try {
    const result = await verifyJwtStrict(token, signingKey);
    payload = result.payload;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid token';
    return { valid: false, reason: message, statusCode: 401 };
  }

  // Step 9: verify v claim is present and supported
  if (payload.v === undefined || !SUPPORTED_VERSIONS.has(payload.v as number)) {
    return { valid: false, reason: 'Unsupported token version', statusCode: 401 };
  }

  // Step 10: verify typ claim is present and recognized
  if (payload.typ === undefined || !RECOGNIZED_TYPES.has(payload.typ as string)) {
    return { valid: false, reason: 'Unrecognized token type', statusCode: 401 };
  }

  // If expectedType is provided, verify typ matches
  if (expectedType && payload.typ !== expectedType) {
    return { valid: false, reason: 'Unrecognized token type', statusCode: 401 };
  }

  // Step 11: verify iss claim is present and matches expectedIssuer
  if (payload.iss === undefined || payload.iss !== expectedIssuer) {
    return { valid: false, reason: 'Invalid token issuer', statusCode: 401 };
  }

  // Step 12: verify exp claim is present and not in the past
  if (payload.exp === undefined || typeof payload.exp !== 'number') {
    return { valid: false, reason: 'Token has expired', statusCode: 401 };
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSeconds) {
    return { valid: false, reason: 'Token has expired', statusCode: 401 };
  }

  // Build the typed payload
  const typedPayload: NrdocsTokenPayload = {
    v: payload.v as number,
    typ: payload.typ as string,
    iss: payload.iss as string,
    exp: payload.exp as number,
    jti: payload.jti as string,
  };

  // Steps 14-15: load Token_DB_Record via jti
  if (!payload.jti || typeof payload.jti !== 'string') {
    return { valid: false, reason: 'Invalid token', statusCode: 401 };
  }

  let dbRecord: BootstrapToken | RepoPublishToken | null = null;

  if (typedPayload.typ === 'org_bootstrap') {
    dbRecord = await dataStore.getBootstrapTokenByJti(typedPayload.jti);
  } else if (typedPayload.typ === 'repo_publish') {
    dbRecord = await dataStore.getRepoPublishTokenByJti(typedPayload.jti);
  }

  if (!dbRecord) {
    return { valid: false, reason: 'Invalid token', statusCode: 401 };
  }

  // Step 16: verify DB record status is active
  if (dbRecord.status !== 'active') {
    return { valid: false, reason: 'Token is no longer active', statusCode: 401 };
  }

  // Step 17: return validated payload and DB record
  return { valid: true, payload: typedPayload, dbRecord };
}
