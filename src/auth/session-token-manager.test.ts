import { describe, expect, it } from 'vitest';
import { SessionTokenManager } from './session-token-manager';

describe('SessionTokenManager', () => {
  const key = 'a'.repeat(64);

  it('validates when password version is string from D1 and token used numeric pv', async () => {
    const token = await SessionTokenManager.create('repo-1', 3, key, 3600);
    const r = await SessionTokenManager.validate(token, key, '3' as unknown as number);
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.repoId).toBe('repo-1');
  });

  it('rejects password version mismatch', async () => {
    const token = await SessionTokenManager.create('repo-1', 2, key, 3600);
    const r = await SessionTokenManager.validate(token, key, 9);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('password version mismatch');
  });

  it('round-trips create/validate (HMAC over exact payload bytes)', async () => {
    const token = await SessionTokenManager.create(
      '1f20a1f4-4fbf-4f9a-acd3-f4a958032449',
      1,
      key,
      3600,
    );
    const r = await SessionTokenManager.validate(token, key, 1);
    expect(r.valid).toBe(true);
  });

  it('accepts HMAC key with accidental surrounding whitespace (trim)', async () => {
    const token = await SessionTokenManager.create('r1', 1, key, 3600);
    const r = await SessionTokenManager.validate(token, `  ${key}  `, 1);
    expect(r.valid).toBe(true);
  });
});
