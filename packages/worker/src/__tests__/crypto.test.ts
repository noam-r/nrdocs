import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, bytesToHex, hexToBytes } from '../crypto.js';

describe('bytesToHex', () => {
  it('converts bytes to hex string', () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 255]);
    expect(bytesToHex(bytes)).toBe('00010f10ff');
  });

  it('handles empty array', () => {
    expect(bytesToHex(new Uint8Array([]))).toBe('');
  });
});

describe('hexToBytes', () => {
  it('converts hex string to bytes', () => {
    const bytes = hexToBytes('00010f10ff');
    expect(bytes).toEqual(new Uint8Array([0, 1, 15, 16, 255]));
  });

  it('handles empty string', () => {
    expect(hexToBytes('')).toEqual(new Uint8Array([]));
  });

  it('roundtrips with bytesToHex', () => {
    const original = new Uint8Array([42, 128, 200, 0, 255]);
    const hex = bytesToHex(original);
    const restored = hexToBytes(hex);
    expect(restored).toEqual(original);
  });
});

describe('hashPassword', () => {
  it('returns hash, salt, and iteration_count', async () => {
    const result = await hashPassword('my-secret-password');
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/); // 32 bytes = 64 hex chars
    expect(result.salt).toMatch(/^[a-f0-9]{32}$/); // 16 bytes = 32 hex chars
    expect(result.iteration_count).toBe(100_000);
  });

  it('uses custom iteration count', async () => {
    const result = await hashPassword('password', 1000);
    expect(result.iteration_count).toBe(1000);
  });

  it('generates unique salts', async () => {
    const r1 = await hashPassword('same-password');
    const r2 = await hashPassword('same-password');
    expect(r1.salt).not.toBe(r2.salt);
    expect(r1.hash).not.toBe(r2.hash);
  });
});

describe('verifyPassword', () => {
  it('verifies correct password', async () => {
    const { hash, salt, iteration_count } = await hashPassword('correct-password', 1000);
    const valid = await verifyPassword('correct-password', hash, salt, iteration_count);
    expect(valid).toBe(true);
  });

  it('rejects incorrect password', async () => {
    const { hash, salt, iteration_count } = await hashPassword('correct-password', 1000);
    const valid = await verifyPassword('wrong-password', hash, salt, iteration_count);
    expect(valid).toBe(false);
  });

  it('rejects with tampered salt', async () => {
    const { hash, salt, iteration_count } = await hashPassword('my-password', 1000);
    // Flip a character in the salt
    const tamperedSalt = salt.slice(0, -1) + (salt.endsWith('0') ? '1' : '0');
    const valid = await verifyPassword('my-password', hash, tamperedSalt, iteration_count);
    expect(valid).toBe(false);
  });

  it('rejects with wrong iteration count', async () => {
    const { hash, salt } = await hashPassword('my-password', 1000);
    const valid = await verifyPassword('my-password', hash, salt, 2000);
    expect(valid).toBe(false);
  });
});
