/**
 * Bundles the CLI into a single file for npm publishing.
 * Inlines @nrdocs/shared so there's no workspace dependency.
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.join(__dirname, 'src/bin.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: path.join(__dirname, 'dist/bin.mjs'),
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [
    'node:fs',
    'node:path',
    'node:os',
    'node:readline',
    'node:crypto',
    'node:child_process',
    'node:zlib',
  ],
  packages: 'bundle',
});

console.log('CLI bundled to dist/bin.mjs');
