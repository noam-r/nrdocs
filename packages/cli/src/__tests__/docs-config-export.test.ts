import { describe, it, expect } from 'vitest';
import { isExportEnabled } from '../config/docs-config.js';

describe('isExportEnabled', () => {
  it('defaults to true when export is omitted', () => {
    expect(isExportEnabled({})).toBe(true);
    expect(isExportEnabled({ site: { title: 'T' } })).toBe(true);
  });

  it('returns false only when export is explicitly false', () => {
    expect(isExportEnabled({ export: false })).toBe(false);
    expect(isExportEnabled({ export: true })).toBe(true);
  });
});
