/**
 * Authentication middleware for operator endpoints.
 */

import type { Env } from './index.js';
import { jsonError } from './responses.js';

export type AuthResult =
  | { authenticated: true }
  | { authenticated: false; response: Response };

/**
 * Validates the operator bearer token from the Authorization header.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function requireOperator(request: Request, env: Env): AuthResult {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return {
      authenticated: false,
      response: jsonError('UNAUTHORIZED', 'Missing Authorization header', 401),
    };
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return {
      authenticated: false,
      response: jsonError('UNAUTHORIZED', 'Invalid Authorization header format', 401),
    };
  }

  const token = parts[1]!;
  if (!timingSafeEqual(token, env.OPERATOR_TOKEN)) {
    return {
      authenticated: false,
      response: jsonError('UNAUTHORIZED', 'Invalid operator token', 401),
    };
  }

  return { authenticated: true };
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Compares two strings byte-by-byte without short-circuiting.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to avoid leaking length info via timing
    // Compare against itself to keep constant time
    const dummy = a;
    let result = 1; // will be non-zero = not equal
    for (let i = 0; i < dummy.length; i++) {
      result |= dummy.charCodeAt(i) ^ dummy.charCodeAt(i);
    }
    void result;
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
