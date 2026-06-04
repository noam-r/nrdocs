import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCliVersion } from '../version.js';

describe('CLI', () => {
  it('reports version from package.json', () => {
    const pkgPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../package.json',
    );
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
    expect(getCliVersion()).toBe(pkg.version);
  });
});
