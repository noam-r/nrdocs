/**
 * Loads the release-unit Worker module and fixed platform assets from
 * packages/cli/packaged/. Generated/populated by scripts/bundle-release.mjs.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function packagedDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../packaged'), // dist/bin.bundle.js → packaged/
    path.resolve(here, '../../packaged'), // dist/deploy/*.js or src/deploy/*.ts
    path.resolve(here, 'packaged'),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'worker.mjs'))) return dir;
  }
  throw new Error(
    `Missing packaged/worker.mjs (searched from ${here}). Run: pnpm --filter nrdocs run bundle:release`,
  );
}

function loadPackaged(name: string): string {
  const file = path.join(packagedDir(), name);
  try {
    return readFileSync(file, 'utf8');
  } catch {
    throw new Error(
      `Missing packaged release asset '${name}'. Run: pnpm --filter nrdocs run bundle:release`,
    );
  }
}

export const BUNDLED_WORKER_MODULE = loadPackaged('worker.mjs');
export const BUNDLED_PLATFORM_CSS = loadPackaged('reader.css');
export const BUNDLED_PLATFORM_JS = loadPackaged('reader.js');
export const BUNDLED_PLATFORM_MERMAID = loadPackaged('mermaid.js');
