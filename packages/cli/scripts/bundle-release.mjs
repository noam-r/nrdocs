#!/usr/bin/env node
/**
 * Release packaging for the published `nrdocs` CLI.
 *
 * - Bundle the Cloudflare Worker into packaged/worker.mjs
 * - Write fixed platform assets into packaged/
 * - Typecheck/compile the CLI with tsc
 * - Bundle the CLI into a self-contained dist/bin.bundle.js (no workspace: deps)
 * - Write dist/bin.js shebang wrapper and package.runtime.json for npm pack
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(cliRoot, '../..');
const packagedDir = path.join(cliRoot, 'packaged');
const distDir = path.join(cliRoot, 'dist');

async function bundleWorker() {
  await fs.mkdir(packagedDir, { recursive: true });
  await esbuild.build({
    absWorkingDir: repoRoot,
    entryPoints: [path.join(repoRoot, 'packages/worker/src/index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile: path.join(packagedDir, 'worker.mjs'),
    conditions: ['worker', 'browser', 'import'],
    mainFields: ['module', 'main'],
    logLevel: 'warning',
  });

  const assetsPath = path.join(repoRoot, 'packages/worker/src/reader/platform-assets.ts');
  const assetsSource = await fs.readFile(assetsPath, 'utf8');
  const cssMatch = assetsSource.match(/export const PLATFORM_CSS = `([\s\S]*?)`;/);
  const jsMatch = assetsSource.match(/export const PLATFORM_JS = `([\s\S]*?)`;/);
  const mermaidMatch = assetsSource.match(/export const PLATFORM_MERMAID = `([\s\S]*?)`;/);
  if (!cssMatch || !jsMatch || !mermaidMatch) {
    throw new Error('Failed to extract PLATFORM_* assets from platform-assets.ts');
  }
  await fs.writeFile(path.join(packagedDir, 'reader.css'), cssMatch[1], 'utf8');
  await fs.writeFile(path.join(packagedDir, 'reader.js'), jsMatch[1], 'utf8');
  await fs.writeFile(path.join(packagedDir, 'mermaid.js'), mermaidMatch[1], 'utf8');
  await fs.writeFile(
    path.join(packagedDir, 'MANIFEST.txt'),
    ['nrdocs release unit assets', 'worker.mjs', 'reader.css', 'reader.js', 'mermaid.js', ''].join(
      '\n',
    ),
    'utf8',
  );
}

async function bundleCli() {
  await fs.mkdir(distDir, { recursive: true });
  await esbuild.build({
    absWorkingDir: repoRoot,
    entryPoints: [path.join(cliRoot, 'src/bin.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: path.join(distDir, 'bin.bundle.js'),
    // Keep registry packages external; workspace packages are still inlined.
    external: [
      'yaml',
      'highlight.js',
      'mdast-util-from-markdown',
      'mdast-util-gfm',
      'micromark-extension-gfm',
      'unist-util-visit',
    ],
    banner: { js: '// nrdocs release bundle' },
    logLevel: 'warning',
  });
  await fs.writeFile(
    path.join(distDir, 'bin.js'),
    `#!/usr/bin/env node\nimport './bin.bundle.js';\n`,
    'utf8',
  );
  await fs.chmod(path.join(distDir, 'bin.js'), 0o755);
}

async function writeRuntimePackageJson() {
  const pkg = JSON.parse(await fs.readFile(path.join(cliRoot, 'package.json'), 'utf8'));
  const runtime = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    type: 'module',
    bin: { nrdocs: './dist/bin.js' },
    files: ['dist/bin.js', 'dist/bin.bundle.js', 'packaged', 'README.md'],
    engines: pkg.engines,
    dependencies: {
      yaml: '2.8.0',
      'highlight.js': '11.11.1',
      'mdast-util-from-markdown': '2.0.2',
      'mdast-util-gfm': '3.0.0',
      'micromark-extension-gfm': '3.0.0',
      'unist-util-visit': '5.0.0',
    },
  };
  await fs.writeFile(
    path.join(cliRoot, 'package.runtime.json'),
    `${JSON.stringify(runtime, null, 2)}\n`,
    'utf8',
  );
}

function runTsc() {
  const tsc = spawnSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json'], {
    cwd: cliRoot,
    stdio: 'inherit',
  });
  if (tsc.status !== 0) process.exit(tsc.status ?? 1);
}

async function main() {
  console.log('Bundling Worker + platform assets…');
  await bundleWorker();
  console.log('Compiling CLI TypeScript…');
  runTsc();
  console.log('Bundling self-contained CLI…');
  await bundleCli();
  await writeRuntimePackageJson();
  console.log('Release bundle ready under packages/cli/{dist,packaged}.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
