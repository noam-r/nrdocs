import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('workspace bootstrap', () => {
  it('keeps only private internal packages besides nrdocs', () => {
    const packages = ['contracts', 'persistence', 'renderer', 'worker', 'cli'].map((dir) => {
      return JSON.parse(
        readFileSync(resolve(process.cwd(), `packages/${dir}/package.json`), 'utf8'),
      ) as { name: string; private?: boolean; bin?: Record<string, string> };
    });
    const publishable = packages.filter((p) => p.private !== true);
    expect(publishable.map((p) => p.name)).toEqual(['nrdocs']);
    expect(publishable[0]?.bin).toEqual({ nrdocs: './dist/bin.js' });
    expect(
      packages
        .filter((p) => p.private === true)
        .map((p) => p.name)
        .sort(),
    ).toEqual(['@nrdocs/contracts', '@nrdocs/persistence', '@nrdocs/renderer', '@nrdocs/worker']);
  });
});
