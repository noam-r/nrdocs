import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  signNrdocsToken,
  decodeJwtPayload,
  decodeJwtHeader,
  validateJwtHeader,
  verifyJwtStrict,
} from './jwt-utils';
import type { NrdocsTokenPayload } from './jwt-utils';
import { parseCliToken } from '../../cli/src/config-parser';

const NUM_RUNS = 100;
const TEST_KEY = 'pbt-test-signing-key';

/**
 * Arbitrary for NrdocsTokenPayload with fully random values.
 */
const arbPayload: fc.Arbitrary<NrdocsTokenPayload> = fc.record({
  v: fc.integer(),
  typ: fc.string(),
  iss: fc.webUrl(),
  exp: fc.integer(),
  jti: fc.uuid(),
});

describe('Feature: auth-signing — Property-Based Tests', () => {
  /**
   * Property 1: Token Signing Round-Trip
   * **Validates: Requirements 1.1, 1.6, 1.7, 1.8, 2.1, 2.2**
   */
  it('Property 1: sign/decode round-trip preserves all claims', async () => {
    await fc.assert(
      fc.asyncProperty(arbPayload, async (payload) => {
        const token = await signNrdocsToken(payload, TEST_KEY);
        const decoded = decodeJwtPayload(token);
        expect(decoded).toEqual({
          v: payload.v,
          typ: payload.typ,
          iss: payload.iss,
          exp: payload.exp,
          jti: payload.jti,
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 2: Signed Tokens Contain Exactly Five Claims
   * **Validates: Requirements 1.1, 1.2, 9.1, 9.2, 9.3**
   */
  it('Property 2: signed tokens contain exactly five claims', async () => {
    await fc.assert(
      fc.asyncProperty(arbPayload, async (payload) => {
        const token = await signNrdocsToken(payload, TEST_KEY);
        const decoded = decodeJwtPayload(token);
        const keys = Object.keys(decoded).sort();
        expect(keys).toEqual(['exp', 'iss', 'jti', 'typ', 'v']);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 3: Signature Verification with Correct Key Succeeds
   * **Validates: Requirements 2.1, 3.7**
   */
  it('Property 3: signature verification with correct key succeeds', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPayload,
        fc.string({ minLength: 1 }),
        async (payload, key) => {
          const token = await signNrdocsToken(payload, key);
          const result = await verifyJwtStrict(token, key);
          expect(result.payload).toEqual({
            v: payload.v,
            typ: payload.typ,
            iss: payload.iss,
            exp: payload.exp,
            jti: payload.jti,
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 4: Signature Verification with Wrong Key Fails
   * **Validates: Requirements 3.7, 3.8**
   */
  it('Property 4: signature verification with wrong key fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPayload,
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        async (payload, key1, key2) => {
          fc.pre(key1 !== key2);
          const token = await signNrdocsToken(payload, key1);
          await expect(verifyJwtStrict(token, key2)).rejects.toThrow();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 5: Token Header is Exactly {alg:HS256, typ:JWT}
   * **Validates: Requirements 2.3, 2.4**
   */
  it('Property 5: token header is exactly {alg:"HS256", typ:"JWT"}', async () => {
    await fc.assert(
      fc.asyncProperty(arbPayload, async (payload) => {
        const token = await signNrdocsToken(payload, TEST_KEY);
        const header = decodeJwtHeader(token);
        expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
        expect(Object.keys(header)).toHaveLength(2);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 6: Header Validation Rejects Non-Conforming Headers
   * **Validates: Requirements 3.3, 3.4, 3.5, 3.6**
   */
  it('Property 6: header validation rejects non-conforming headers', () => {
    const arbBadHeader: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
      // Wrong alg
      fc.record({
        alg: fc.string().filter((s) => s !== 'HS256'),
        typ: fc.constant('JWT'),
      }),
      // Wrong typ
      fc.record({
        alg: fc.constant('HS256'),
        typ: fc.string().filter((s) => s !== 'JWT'),
      }),
      // Extra fields
      fc.record({
        alg: fc.constant('HS256'),
        typ: fc.constant('JWT'),
        extra: fc.anything(),
      }),
      // Missing alg
      fc.record({
        typ: fc.constant('JWT'),
      }),
      // Missing typ
      fc.record({
        alg: fc.constant('HS256'),
      }),
      // Both wrong
      fc.record({
        alg: fc.string().filter((s) => s !== 'HS256'),
        typ: fc.string().filter((s) => s !== 'JWT'),
      }),
    );

    fc.assert(
      fc.property(arbBadHeader, (header) => {
        const result = validateJwtHeader(header);
        expect(result.valid).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 7: CLI Parser Extracts iss and Validates Structure
   * **Validates: Requirements 4.1, 4.2, 4.4, 9.5**
   */
  it('Property 7: CLI parser extracts iss and validates structure', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;

    const arbValidPayload: fc.Arbitrary<NrdocsTokenPayload> = fc.record({
      v: fc.constant(1),
      typ: fc.constantFrom('org_bootstrap', 'repo_publish'),
      iss: fc.webUrl({ withFragments: false, withQueryParameters: false }),
      exp: fc.integer({ min: futureExp, max: futureExp + 100_000_000 }),
      jti: fc.uuid(),
    });

    await fc.assert(
      fc.asyncProperty(arbValidPayload, async (payload) => {
        const token = await signNrdocsToken(payload, TEST_KEY);
        const parsed = parseCliToken(token);
        expect(parsed.iss).toBe(payload.iss);
        expect(parsed.typ).toBe(payload.typ);
        expect(parsed.v).toBe(payload.v);
        expect(parsed.exp).toBe(payload.exp);
        expect(parsed.jti).toBe(payload.jti);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 8: CLI Parser Rejects Tokens Missing Required Claims
   * **Validates: Requirements 4.4, 4.10**
   */
  it('Property 8: CLI parser rejects tokens missing required claims', () => {
    const requiredClaims = ['v', 'typ', 'iss', 'exp', 'jti'] as const;

    /**
     * Build a base64url-encoded string from a JS object.
     */
    function toBase64Url(obj: Record<string, unknown>): string {
      const json = JSON.stringify(obj);
      const b64 = btoa(json);
      return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    const validHeader = { alg: 'HS256', typ: 'JWT' };
    const fullPayload = {
      v: 1,
      typ: 'org_bootstrap',
      iss: 'https://example.com',
      exp: Math.floor(Date.now() / 1000) + 7200,
      jti: '550e8400-e29b-41d4-a716-446655440000',
    };

    // Arbitrary that removes at least one required claim
    const arbIncompletePayload = fc
      .subarray([...requiredClaims], { minLength: 1, maxLength: requiredClaims.length })
      .map((claimsToRemove) => {
        const partial: Record<string, unknown> = { ...fullPayload };
        for (const claim of claimsToRemove) {
          delete partial[claim];
        }
        return partial;
      })
      .filter((p) => {
        // Ensure at least one claim is actually missing
        return !requiredClaims.every((c) => c in p);
      });

    fc.assert(
      fc.property(arbIncompletePayload, (incompletePayload) => {
        const headerB64 = toBase64Url(validHeader);
        const payloadB64 = toBase64Url(incompletePayload);
        const fakeToken = `${headerB64}.${payloadB64}.fakesignature`;
        expect(() => parseCliToken(fakeToken)).toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
