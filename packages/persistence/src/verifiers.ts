/** Verifier shape validation for durable rows (cryptography lives elsewhere). */

const TOKEN_VERIFIER_RE = /^sha256:[0-9a-f]{64}$/;
const PASSWORD_VERIFIER_RE = /^pbkdf2-sha256\$600000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/;

export function parseTokenVerifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return TOKEN_VERIFIER_RE.test(value) ? value : null;
}

export function assertTokenVerifier(value: unknown): string {
  const v = parseTokenVerifier(value);
  if (!v) throw new Error('invalid token_verifier');
  return v;
}

export function parsePasswordVerifier(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  return PASSWORD_VERIFIER_RE.test(value) ? value : null;
}

export function assertPasswordVerifier(value: unknown): string {
  if (typeof value !== 'string' || !PASSWORD_VERIFIER_RE.test(value)) {
    throw new Error('invalid password_verifier');
  }
  return value;
}
