import { describe, it, expect } from 'vitest';
import { buildSiteZip } from '../renderer/site-zip.js';

describe('buildSiteZip', () => {
  it('produces a valid ZIP with STORE entries', () => {
    const zip = buildSiteZip([
      { name: 'index.md', data: Buffer.from('# Home\n') },
      { name: 'guide/start.md', data: Buffer.from('# Start\n') },
    ]);
    expect(zip.length).toBeGreaterThan(0);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.includes(Buffer.from('index.md'))).toBe(true);
    expect(zip.includes(Buffer.from('# Home'))).toBe(true);
  });
});
