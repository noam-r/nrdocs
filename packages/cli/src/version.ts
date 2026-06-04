import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | undefined;

/**
 * CLI version from package.json (next to dist/). Works for bundled bin.mjs and npm installs.
 */
export function getCliVersion(): string {
  if (cached) return cached;
  try {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    if (typeof pkg.version === 'string' && pkg.version.length > 0) {
      cached = pkg.version;
      return cached;
    }
  } catch {
    // fall through
  }
  cached = '0.0.0';
  return cached;
}
