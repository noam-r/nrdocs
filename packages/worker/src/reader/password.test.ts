import { describe, expect, it } from 'vitest';
import { bytesToBase64Url } from './crypto.js';
import {
  READER_PASSWORD_PBKDF2_ITERATIONS,
  passwordInputLooksPlausible,
  verifyReaderPassword,
} from './password.js';

const PASSWORD = 'correct-horse-battery-staple';
const SALT = new Uint8Array(16).fill(3);

async function mint(password: string, iterations: number, salt = SALT): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return `pbkdf2-sha256$${iterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
}

function workersCappedSubtle(): Pick<
  SubtleCrypto,
  'importKey' | 'deriveBits' | 'deriveKey' | 'exportKey'
> {
  const real = globalThis.crypto.subtle;
  const tooHigh = (algorithm: AlgorithmIdentifier) => {
    if (typeof algorithm !== 'object' || algorithm === null || !('iterations' in algorithm)) {
      return false;
    }
    return Number((algorithm as { iterations: number }).iterations) > 100_000;
  };
  const reject = () => {
    const error = new Error(
      'Pbkdf2 failed: iteration counts above 100000 are not supported (requested 600000)',
    );
    error.name = 'NotSupportedError';
    return Promise.reject(error);
  };
  return {
    importKey: real.importKey.bind(real),
    exportKey: real.exportKey.bind(real),
    deriveBits: (algorithm, key, length) => {
      if (tooHigh(algorithm)) return reject();
      return real.deriveBits(algorithm, key, length);
    },
    deriveKey: (algorithm, key, derivedKeyType, extractable, keyUsages) => {
      if (tooHigh(algorithm)) return reject();
      return real.deriveKey(algorithm, key, derivedKeyType, extractable, keyUsages);
    },
  };
}

describe('verifyReaderPassword', () => {
  it('accepts a 100000-labeled digest derived at 100000', async () => {
    const stored = await mint(PASSWORD, READER_PASSWORD_PBKDF2_ITERATIONS);
    expect(stored).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(await verifyReaderPassword(PASSWORD, stored)).toBe(true);
    expect(await verifyReaderPassword('wrong', stored)).toBe(false);
  });

  it('accepts a real 600000-labeled digest', async () => {
    const stored = await mint(PASSWORD, 600_000);
    expect(await verifyReaderPassword(PASSWORD, stored)).toBe(true);
    expect(await verifyReaderPassword('wrong', stored)).toBe(false);
  });

  it('accepts a 600000 label whose digest was derived at 100000', async () => {
    const honest = await mint(PASSWORD, 100_000);
    const mislabeled = honest.replace('$100000$', '$600000$');
    expect(await verifyReaderPassword(PASSWORD, mislabeled)).toBe(true);
  });

  it('verifies 100k and mislabeled 600k hashes when the runtime caps PBKDF2 at 100k', async () => {
    const current = await mint(PASSWORD, 100_000);
    const mislabeled = current.replace('$100000$', '$600000$');
    const subtle = workersCappedSubtle();
    expect(await verifyReaderPassword(PASSWORD, current, subtle)).toBe(true);
    expect(await verifyReaderPassword(PASSWORD, mislabeled, subtle)).toBe(true);
    expect(await verifyReaderPassword('wrong', current, subtle)).toBe(false);
  });

  it('rejects unknown iteration counts and malformed verifiers', async () => {
    const oneIter = await mint(PASSWORD, 1);
    expect(await verifyReaderPassword(PASSWORD, oneIter)).toBe(false);
    expect(await verifyReaderPassword(PASSWORD, 'pbkdf2-sha256$100000$short$short')).toBe(false);
    expect(await verifyReaderPassword(PASSWORD, '')).toBe(false);
  });

  it('enforces password length bounds', () => {
    expect(passwordInputLooksPlausible('x')).toBe(true);
    expect(passwordInputLooksPlausible('')).toBe(false);
    expect(passwordInputLooksPlausible('a'.repeat(257))).toBe(false);
  });
});
