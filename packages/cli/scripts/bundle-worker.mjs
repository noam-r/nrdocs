/**
 * Bundles the Worker for `nrdocs deploy` from the published npm package.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.join(__dirname, '..');
const workerRoot = path.join(cliRoot, '../worker');
const outDir = path.join(cliRoot, 'dist/deploy-worker');

fs.mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(workerRoot, 'src/index.ts')],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  outfile: path.join(outDir, 'index.js'),
  packages: 'bundle',
});

const migrationsSrc = path.join(workerRoot, 'migrations');
const migrationsDst = path.join(outDir, 'migrations');
fs.rmSync(migrationsDst, { recursive: true, force: true });
fs.cpSync(migrationsSrc, migrationsDst, { recursive: true });

console.log('Worker bundled to dist/deploy-worker/');
