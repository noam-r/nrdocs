import { describe, it, expect } from 'vitest';
import { requireOperator, timingSafeEqual } from '../auth.js';
import type { Env } from '../index.js';

function makeEnv(token = 'test-operator-token'): Env {
  return {
    OPERATOR_TOKEN: token,
    DB: {} as D1Database,
    ARTIFACTS: {} as R2Bucket,
    SESSION_SECRET: 'secret',
    BASE_URL: 'https://docs.example.com',
  };
}

describe('requireOperator', () => {
  it('returns authenticated true for valid token', () => {
    const request = new Request('http://localhost/api/repos', {
      headers: { Authorization: 'Bearer test-operator-token' },
    });
    const result = requireOperator(request, makeEnv());
    expect(result.authenticated).toBe(true);
  });

  it('returns 401 when Authorization header is missing', () => {
    const request = new Request('http://localhost/api/repos');
    const result = requireOperator(request, makeEnv());
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) {
      expect(result.response.status).toBe(401);
    }
  });

  it('returns 401 for invalid header format (no Bearer prefix)', () => {
    const request = new Request('http://localhost/api/repos', {
      headers: { Authorization: 'Basic abc123' },
    });
    const result = requireOperator(request, makeEnv());
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) {
      expect(result.response.status).toBe(401);
    }
  });

  it('returns 401 for wrong token', () => {
    const request = new Request('http://localhost/api/repos', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    const result = requireOperator(request, makeEnv());
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) {
      expect(result.response.status).toBe(401);
    }
  });

  it('returns error body in standard format', async () => {
    const request = new Request('http://localhost/api/repos');
    const result = requireOperator(request, makeEnv());
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) {
      const body = await result.response.json() as { ok: boolean; error: { code: string; message: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toBeDefined();
    }
  });
});

describe('timingSafeEqual', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeEqual('hello', 'hello')).toBe(true);
    expect(timingSafeEqual('', '')).toBe(true);
    expect(timingSafeEqual('a-long-token-value', 'a-long-token-value')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(timingSafeEqual('hello', 'world')).toBe(false);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
  });

  it('returns false for different length strings', () => {
    expect(timingSafeEqual('short', 'longer-string')).toBe(false);
    expect(timingSafeEqual('longer-string', 'short')).toBe(false);
  });

  it('returns false when one string is empty', () => {
    expect(timingSafeEqual('', 'notempty')).toBe(false);
    expect(timingSafeEqual('notempty', '')).toBe(false);
  });
});
