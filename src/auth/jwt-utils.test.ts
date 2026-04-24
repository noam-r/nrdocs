import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt, decodeJwtPayload } from './jwt-utils';

describe('jwt-utils', () => {
  const secret = 'test-secret-key-for-hmac';

  describe('signJwt + verifyJwt round-trip', () => {
    it('produces a valid JWT that verifyJwt accepts', async () => {
      const payload = { sub: 'user-1', org_id: 'org-abc', exp: 9999999999 };
      const token = await signJwt(payload, secret);

      const decoded = await verifyJwt(token, secret);
      expect(decoded).toEqual(payload);
    });

    it('returns a three-part dot-separated string', async () => {
      const token = await signJwt({ foo: 'bar' }, secret);
      const parts = token.split('.');
      expect(parts).toHaveLength(3);
      // Each part should be non-empty base64url
      for (const part of parts) {
        expect(part.length).toBeGreaterThan(0);
        expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
      }
    });

    it('header decodes to HS256 JWT header', async () => {
      const token = await signJwt({ x: 1 }, secret);
      const headerB64 = token.split('.')[0];
      const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));
      expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    });
  });

  describe('verifyJwt', () => {
    it('rejects a tampered payload', async () => {
      const token = await signJwt({ data: 'original' }, secret);
      const parts = token.split('.');

      // Tamper with the payload
      const tamperedPayload = btoa(JSON.stringify({ data: 'tampered' }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      await expect(verifyJwt(tampered, secret)).rejects.toThrow('Invalid JWT signature');
    });

    it('rejects a wrong secret', async () => {
      const token = await signJwt({ data: 'test' }, secret);
      await expect(verifyJwt(token, 'wrong-secret')).rejects.toThrow('Invalid JWT signature');
    });

    it('rejects a malformed token with fewer than 3 parts', async () => {
      await expect(verifyJwt('only.two', secret)).rejects.toThrow('Invalid JWT format');
      await expect(verifyJwt('noparts', secret)).rejects.toThrow('Invalid JWT format');
    });
  });

  describe('decodeJwtPayload', () => {
    it('extracts payload without verification', async () => {
      const payload = { jti: 'abc', org_id: 'org-1', aud: 'https://api.example.com' };
      const token = await signJwt(payload, secret);

      // Should decode even without the secret
      const decoded = decodeJwtPayload(token);
      expect(decoded).toEqual(payload);
    });

    it('decodes payload even with an invalid signature', async () => {
      const token = await signJwt({ key: 'value' }, secret);
      const parts = token.split('.');
      // Replace signature with garbage
      const broken = `${parts[0]}.${parts[1]}.invalidsignature`;

      const decoded = decodeJwtPayload(broken);
      expect(decoded).toEqual({ key: 'value' });
    });

    it('throws on malformed token', () => {
      expect(() => decodeJwtPayload('not-a-jwt')).toThrow('Invalid JWT format');
    });
  });
});
