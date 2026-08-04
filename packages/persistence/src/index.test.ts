import { describe, expect, it } from 'vitest';
import { PERSISTENCE_PACKAGE, persistenceDependsOnContracts } from './index.js';

describe('@nrdocs/persistence', () => {
  it('imports contracts without network I/O', () => {
    expect(PERSISTENCE_PACKAGE).toBe('@nrdocs/persistence');
    expect(persistenceDependsOnContracts()).toBe('@nrdocs/contracts');
  });
});
