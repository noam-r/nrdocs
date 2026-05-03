import type { NrdocsTokenPayload } from '../auth/jwt-utils';
import { verifyJwtStrict } from '../auth/jwt-utils';
import type { DataStore } from '../interfaces/data-store';
import type { RepoPublishToken } from '../types';

export interface TokenValidationSuccess {
  valid: true;
  payload: NrdocsTokenPayload;
  dbRecord: RepoPublishToken;
}

export interface TokenValidationFailure {
  valid: false;
  reason: string;
  statusCode: number;
}

export type TokenValidationResult = TokenValidationSuccess | TokenValidationFailure;

const SUPPORTED_VERSIONS = new Set([1]);
const RECOGNIZED_TYPES = new Set(['repo_publish']);

/**
 * Server-side token validation for repo_publish JWTs.
 */
export async function validateToken(
  token: string,
  signingKey: string,
  expectedIssuer: string,
  dataStore: DataStore,
  expectedType?: 'repo_publish',
): Promise<TokenValidationResult> {
  let payload: Record<string, unknown>;
  try {
    const result = await verifyJwtStrict(token, signingKey);
    payload = result.payload;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid token';
    return { valid: false, reason: message, statusCode: 401 };
  }

  if (payload.v === undefined || !SUPPORTED_VERSIONS.has(payload.v as number)) {
    return { valid: false, reason: 'Unsupported token version', statusCode: 401 };
  }

  if (payload.typ === undefined || !RECOGNIZED_TYPES.has(payload.typ as string)) {
    return { valid: false, reason: 'Unrecognized token type', statusCode: 401 };
  }

  if (expectedType && payload.typ !== expectedType) {
    return { valid: false, reason: 'Unrecognized token type', statusCode: 401 };
  }

  if (payload.iss === undefined || payload.iss !== expectedIssuer) {
    return { valid: false, reason: 'Invalid token issuer', statusCode: 401 };
  }

  if (payload.exp === undefined || typeof payload.exp !== 'number') {
    return { valid: false, reason: 'Token has expired', statusCode: 401 };
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSeconds) {
    return { valid: false, reason: 'Token has expired', statusCode: 401 };
  }

  const typedPayload: NrdocsTokenPayload = {
    v: payload.v as number,
    typ: payload.typ as string,
    iss: payload.iss as string,
    exp: payload.exp as number,
    jti: payload.jti as string,
  };

  if (!payload.jti || typeof payload.jti !== 'string') {
    return { valid: false, reason: 'Invalid token', statusCode: 401 };
  }

  const dbRecord = await dataStore.getRepoPublishTokenByJti(typedPayload.jti);

  if (!dbRecord) {
    return { valid: false, reason: 'Invalid token', statusCode: 401 };
  }

  if (dbRecord.status !== 'active') {
    return { valid: false, reason: 'Token is no longer active', statusCode: 401 };
  }

  return { valid: true, payload: typedPayload, dbRecord };
}
