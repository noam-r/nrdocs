import { describe, expect, it } from 'vitest';
import { CONTRACTS_PACKAGE, contractsReady } from './index.js';

describe('@nrdocs/contracts', () => {
  it('exports a stable package identity', () => {
    expect(CONTRACTS_PACKAGE).toBe('@nrdocs/contracts');
    expect(contractsReady()).toBe(true);
  });
});
