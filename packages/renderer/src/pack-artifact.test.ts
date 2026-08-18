import { describe, expect, it } from 'vitest';
import { buildDeterministicTar, splitUstarPath } from './pack-artifact.js';
import { RendererError } from './types.js';

const LONG_PAGE =
  'pages/platform-spec/security-and-operations/reliability-observability-and-incident-response/index.html';

function readCString(buf: Uint8Array, start: number, length: number): string {
  let end = start;
  const limit = start + length;
  while (end < limit && buf[end] !== 0) end++;
  return new TextDecoder().decode(buf.subarray(start, end));
}

function headerPath(tar: Uint8Array): { name: string; prefix: string; joined: string } {
  const name = readCString(tar, 0, 100);
  const prefix = readCString(tar, 345, 155);
  return { name, prefix, joined: prefix ? `${prefix}/${name}` : name };
}

describe('splitUstarPath', () => {
  it('leaves short paths in the name field', () => {
    expect(splitUstarPath('pages/index.html')).toEqual({ name: 'pages/index.html', prefix: '' });
  });

  it('splits nested paths that exceed the 100-byte name field', () => {
    expect(LONG_PAGE.length).toBeGreaterThan(100);
    const { name, prefix } = splitUstarPath(LONG_PAGE);
    expect(prefix.length).toBeGreaterThan(0);
    expect(prefix.length).toBeLessThanOrEqual(155);
    expect(name.length).toBeGreaterThan(0);
    expect(name.length).toBeLessThanOrEqual(100);
    expect(`${prefix}/${name}`).toBe(LONG_PAGE);
  });

  it('rejects a single segment that cannot fit in name or prefix', () => {
    const huge = `pages/${'a'.repeat(160)}.html`;
    expect(() => splitUstarPath(huge)).toThrow(RendererError);
  });
});

describe('buildDeterministicTar', () => {
  it('stores a >100-byte path using the ustar prefix field', () => {
    const body = new TextEncoder().encode('hello');
    const tar = buildDeterministicTar([{ objectPath: LONG_PAGE, bytes: body }]);
    const header = headerPath(tar);
    expect(header.prefix).not.toBe('');
    expect(header.name.length).toBeLessThanOrEqual(100);
    expect(header.joined).toBe(LONG_PAGE);
    expect(new TextDecoder().decode(tar.subarray(512, 512 + body.byteLength))).toBe('hello');
  });

  it('does not set prefix for short paths', () => {
    const tar = buildDeterministicTar([
      { objectPath: 'pages/index.html', bytes: new TextEncoder().encode('x') },
    ]);
    const header = headerPath(tar);
    expect(header.prefix).toBe('');
    expect(header.name).toBe('pages/index.html');
  });
});
