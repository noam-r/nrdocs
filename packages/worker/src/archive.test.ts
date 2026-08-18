import { describe, expect, it } from 'vitest';
import { buildDeterministicTar } from '@nrdocs/renderer';
import { extractUstarFiles } from './archive.js';

describe('extractUstarFiles', () => {
  it('reconstructs paths split across ustar name and prefix fields', () => {
    const objectPath =
      'pages/platform-spec/security-and-operations/reliability-observability-and-incident-response/index.html';
    expect(objectPath.length).toBeGreaterThan(100);
    const body = new TextEncoder().encode('<html></html>');
    const tar = buildDeterministicTar([{ objectPath, bytes: body }]);
    const files = extractUstarFiles(tar);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe(objectPath);
    expect(new TextDecoder().decode(files[0]!.body)).toBe('<html></html>');
  });
});
