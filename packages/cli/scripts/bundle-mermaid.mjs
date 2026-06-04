/**
 * Bundles mermaid for browser use in published doc artifacts.
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.join(__dirname, '..');
const entry = path.join(cliRoot, 'scripts/mermaid-entry.mjs');
const outputs = [
  path.join(cliRoot, 'dist/runtime/mermaid.min.js'),
  path.join(cliRoot, 'src/renderer/runtime/mermaid.min.js'),
];

for (const outfile of outputs) {
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'browser',
    target: 'es2020',
    format: 'iife',
    outfile,
    minify: true,
    footer: {
      js: ';(function(g){var m=g.mermaid;if(m&&m.default&&typeof m.default.initialize==="function")g.mermaid=m.default;})(typeof globalThis!=="undefined"?globalThis:window);',
    },
  });
}

console.log('Mermaid bundled to dist/runtime and src/renderer/runtime/mermaid.min.js');
