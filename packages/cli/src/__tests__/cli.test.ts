import { describe, it, expect } from 'vitest';
import { NRDOCS_VERSION } from '@nrdocs/shared';

describe('CLI', () => {
  it('exports version from shared package', () => {
    expect(NRDOCS_VERSION).toBe('0.1.0');
  });
});
