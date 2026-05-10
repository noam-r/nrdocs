import { describe, it, expect } from 'vitest';
import { base64urlDecode, base64urlDecodeBytes, validateStandardClaims } from '../oidc.js';
import type { JwtPayload } from '../oidc.js';

describe('base64urlDecode', () => {
  it('decodes a simple base64url string', () => {
    // "hello" in base64url is "aGVsbG8"
    expect(base64urlDecode('aGVsbG8')).toBe('hello');
  });

  it('handles padding correctly', () => {
    // "a" in base64url is "YQ" (needs == padding)
    expect(base64urlDecode('YQ')).toBe('a');
    // "ab" in base64url is "YWI" (needs = padding)
    expect(base64urlDecode('YWI')).toBe('ab');
  });

  it('handles URL-safe characters', () => {
    // base64url uses - instead of + and _ instead of /
    const input = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9';
    const decoded = base64urlDecode(input);
    const parsed = JSON.parse(decoded) as Record<string, string>;
    expect(parsed.alg).toBe('RS256');
    expect(parsed.typ).toBe('JWT');
  });
});

describe('base64urlDecodeBytes', () => {
  it('returns Uint8Array', () => {
    const result = base64urlDecodeBytes('aGVsbG8');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(5);
  });

  it('decodes binary data correctly', () => {
    // [0, 1, 2, 3] in base64url is "AAECAw"
    const result = base64urlDecodeBytes('AAECAw');
    expect(Array.from(result)).toEqual([0, 1, 2, 3]);
  });
});

describe('validateStandardClaims', () => {
  const validPayload: JwtPayload = {
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'https://nrdocs.example.com',
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    nbf: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
  };

  it('accepts valid claims', () => {
    const result = validateStandardClaims(validPayload, 'https://nrdocs.example.com');
    expect(result).toBeNull();
  });

  it('rejects invalid issuer', () => {
    const payload: JwtPayload = { ...validPayload, iss: 'https://evil.com' };
    const result = validateStandardClaims(payload, 'https://nrdocs.example.com');
    expect(result).not.toBeNull();
    expect(result).toContain('Invalid issuer');
  });

  it('rejects missing issuer', () => {
    const payload: JwtPayload = { ...validPayload, iss: undefined };
    const result = validateStandardClaims(payload, 'https://nrdocs.example.com');
    expect(result).not.toBeNull();
    expect(result).toContain('Invalid issuer');
  });

  it('rejects invalid audience (string)', () => {
    const payload: JwtPayload = { ...validPayload, aud: 'https://other.com' };
    const result = validateStandardClaims(payload, 'https://nrdocs.example.com');
    expect(result).not.toBeNull();
    expect(result).toContain('Invalid audience');
  });

  it('accepts audience as array containing expected value', () => {
    const payload: JwtPayload = {
      ...validPayload,
      aud: ['https://nrdocs.example.com', 'https://other.com'],
    };
    const result = validateStandardClaims(payload, 'https://nrdocs.example.com');
    expect(result).toBeNull();
  });

  it('rejects audience array not containing expected value', () => {
    const payload: JwtPayload = {
      ...validPayload,
      aud: ['https://other.com', 'https://another.com'],
    };
    const result = validateStandardClaims(payload, 'https://nrdocs.example.com');
    expect(result).not.toBeNull();
    expect(result).toContain('Invalid audience');
  });

  it('rejects expired tokens', () => {
    const payload: JwtPayload = {
      ...validPayload,
      exp: Math.floor(Date.now() / 1000) - 120, // 2 minutes ago (beyond 60s skew)
    };
    const result = validateStandardClaims(payload, 'https://nrdocs.example.com');
    expect(result).not.toBeNull();
    expect(result).toContain('expired');
  });

  it('accepts tokens within clock skew tolerance for exp', () => {
    const payload: JwtPayload = {
      ...validPayload,
      exp: Math.floor(Date.now() / 1000) - 30, // 30 seconds ago (within 60s skew)
    };
    const result = validateStandardClaims(payload, 'https://nrdocs.example.com');
    expect(result).toBeNull();
  });

  it('rejects tokens not yet valid (nbf in future beyond skew)', () => {
    const payload: JwtPayload = {
      ...validPayload,
      nbf: Math.floor(Date.now() / 1000) + 120, // 2 minutes from now (beyond 60s skew)
    };
    const result = validateStandardClaims(payload, 'https://nrdocs.example.com');
    expect(result).not.toBeNull();
    expect(result).toContain('not yet valid');
  });

  it('accepts tokens within clock skew tolerance for nbf', () => {
    const payload: JwtPayload = {
      ...validPayload,
      nbf: Math.floor(Date.now() / 1000) + 30, // 30 seconds from now (within 60s skew)
    };
    const result = validateStandardClaims(payload, 'https://nrdocs.example.com');
    expect(result).toBeNull();
  });

  it('accepts tokens without exp/nbf', () => {
    const payload: JwtPayload = {
      iss: 'https://token.actions.githubusercontent.com',
      aud: 'https://nrdocs.example.com',
    };
    const result = validateStandardClaims(payload, 'https://nrdocs.example.com');
    expect(result).toBeNull();
  });
});
