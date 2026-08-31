#!/usr/bin/env node
/**
 * Release packaging for the published `nrdocs` CLI.
 *
 * - Bundle Mermaid into packaged/mermaid.js and regenerate the Worker embed
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
const mermaidGeneratedPath = path.join(
  repoRoot,
  'packages/worker/src/reader/mermaid-bundle.generated.ts',
);
const MERMAID_STUB = `/** Stub Mermaid ESM; overwritten with the real bundle during \`bundle:release\`. */
export const MERMAID_BUNDLE = 'export default {};\\n';
`;

async function writeMermaidBundle() {
  await fs.mkdir(packagedDir, { recursive: true });
  const outfile = path.join(packagedDir, 'mermaid.js');
  await esbuild.build({
    absWorkingDir: repoRoot,
    entryPoints: [path.join(cliRoot, 'scripts/mermaid-entry.mjs')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile,
    logLevel: 'warning',
    mainFields: ['module', 'browser', 'main'],
    conditions: ['import', 'module', 'browser', 'default'],
  });
  const js = await fs.readFile(outfile, 'utf8');
  if (!js.includes('initialize') && js.length < 1000) {
    throw new Error('Mermaid bundle looks empty or incomplete');
  }
  await fs.writeFile(
    mermaidGeneratedPath,
    `export const MERMAID_BUNDLE = ${JSON.stringify(js)};\n`,
    'utf8',
  );
}

async function restoreMermaidStub() {
  await fs.writeFile(mermaidGeneratedPath, MERMAID_STUB, 'utf8');
}

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
  const cssV2SuffixMatch = assetsSource.match(
    /export const PLATFORM_CSS_V2 = `\$\{PLATFORM_CSS\.replaceAll\([^`]+\)\}([\s\S]*?)`;/,
  );
  const jsV2SuffixMatch = assetsSource.match(
    /export const PLATFORM_JS_V2 = `\$\{PLATFORM_JS\.replaceAll\([^`]+\)\}([\s\S]*?)`;/,
  );
  const apiCssMatch = assetsSource.match(/const PLATFORM_API_CSS = `([\s\S]*?)`;/);
  const apiJsMatch = assetsSource.match(/const PLATFORM_API_JS = `([\s\S]*?)`;/);
  if (!cssMatch || !jsMatch) {
    throw new Error('Failed to extract PLATFORM_CSS/PLATFORM_JS from platform-assets.ts');
  }
  if (!cssV2SuffixMatch || !jsV2SuffixMatch || !apiCssMatch || !apiJsMatch) {
    throw new Error('Failed to extract v2/v3 platform asset suffixes from platform-assets.ts');
  }

  // Template-literal bodies in platform-assets.ts use JS escapes (e.g. \\ → \). Decode them
  // so packaged reader-*.js is valid JavaScript (type=module fails closed on syntax errors).
  function decodeTemplateLiteralBody(body) {
    let out = '';
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '\\' && i + 1 < body.length) {
        const n = body[i + 1];
        if (n === '\\' || n === '`' || n === "'" || n === '"') {
          out += n;
          i += 1;
          continue;
        }
        if (n === 'n') {
          out += '\n';
          i += 1;
          continue;
        }
        if (n === 'r') {
          out += '\r';
          i += 1;
          continue;
        }
        if (n === 't') {
          out += '\t';
          i += 1;
          continue;
        }
        if (n === '$' && body[i + 2] === '{') {
          out += '${';
          i += 2;
          continue;
        }
      }
      out += body[i];
    }
    return out;
  }

  const cssV1 = cssMatch[1];
  const jsV1 = decodeTemplateLiteralBody(jsMatch[1]);
  const cssV2 = `${cssV1.replaceAll('/_nrdocs/v1/', '/_nrdocs/v2/')}${cssV2SuffixMatch[1]}`;
  const jsV2 = `${jsV1.replaceAll('/_nrdocs/v1/', '/_nrdocs/v2/')}${decodeTemplateLiteralBody(jsV2SuffixMatch[1])}`;
  const cssV3 = `${cssV2.replaceAll('/_nrdocs/v2/', '/_nrdocs/v3/')}${apiCssMatch[1]}`;
  const jsV3 = `${jsV2.replaceAll('/_nrdocs/v2/', '/_nrdocs/v3/')}\n${decodeTemplateLiteralBody(apiJsMatch[1])}`;

  await fs.writeFile(path.join(packagedDir, 'reader.css'), cssV1, 'utf8');
  await fs.writeFile(path.join(packagedDir, 'reader.js'), jsV1, 'utf8');
  await fs.writeFile(path.join(packagedDir, 'reader-v2.css'), cssV2, 'utf8');
  await fs.writeFile(path.join(packagedDir, 'reader-v2.js'), jsV2, 'utf8');
  await fs.writeFile(path.join(packagedDir, 'reader-v3.css'), cssV3, 'utf8');
  await fs.writeFile(path.join(packagedDir, 'reader-v3.js'), jsV3, 'utf8');
  await fs.copyFile(
    path.join(repoRoot, 'assets/nrdocs-logo.svg'),
    path.join(packagedDir, 'logo.svg'),
  );
  // mermaid.js already written by writeMermaidBundle (prefer esbuild output over TS stub)
  const mermaidStat = await fs.stat(path.join(packagedDir, 'mermaid.js')).catch(() => null);
  if (!mermaidStat) {
    throw new Error('Missing packaged/mermaid.js from Mermaid esbuild step');
  }
  await fs.writeFile(
    path.join(packagedDir, 'MANIFEST.txt'),
    [
      'nrdocs release unit assets',
      'worker.mjs',
      'reader.css',
      'reader.js',
      'reader-v2.css',
      'reader-v2.js',
      'reader-v3.css',
      'reader-v3.js',
      'mermaid.js',
      'logo.svg',
      '',
    ].join('\n'),
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
    // Registry packages stay external (must also be package.json dependencies so
    // `node dist/bin.js` works in the monorepo and after npm pack). Workspace
    // packages (@nrdocs/*) are inlined.
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
  const pkg = JSON.parse(await fs.readFile(path.join(cliRoot, 'package.json'), 'utf8'));
  const minMajor = minNodeMajor(pkg.engines?.node);
  // Static `import './bin.bundle.js'` is hoisted and would load `node:sqlite`
  // (and any other Node-24-only builtins) before a version check can run.
  await fs.writeFile(
    path.join(distDir, 'bin.js'),
    `#!/usr/bin/env node
const major = Number.parseInt(process.versions.node, 10);
if (!Number.isFinite(major) || major < ${minMajor}) {
  process.stderr.write(
    \`nrdocs requires Node.js ${minMajor} or later. This is Node.js \${process.versions.node}.\\n\\nInstall Node.js ${minMajor} from https://nodejs.org/\\n\`,
  );
  process.exit(50);
}
function onInterrupt() {
  process.stderr.write('\\n');
  process.exit(130);
}
process.once('SIGINT', onInterrupt);
process.once('SIGTERM', onInterrupt);
import('./bin.bundle.js').catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message) process.stderr.write(message + '\\n');
  process.exit(1);
});
`,
    'utf8',
  );
  await fs.chmod(path.join(distDir, 'bin.js'), 0o755);
}

function minNodeMajor(enginesNode) {
  const match = String(enginesNode ?? '').match(/(\d+)/);
  if (!match) {
    throw new Error('packages/cli package.json engines.node must include a major version');
  }
  return Number(match[1]);
}

async function writeRuntimePackageJson() {
  const pkg = JSON.parse(await fs.readFile(path.join(cliRoot, 'package.json'), 'utf8'));
  const runtimeDeps = { ...(pkg.dependencies ?? {}) };
  for (const key of Object.keys(runtimeDeps)) {
    if (key.startsWith('@nrdocs/')) delete runtimeDeps[key];
  }
  const runtime = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    type: 'module',
    bin: { nrdocs: './dist/bin.js' },
    files: ['dist/bin.js', 'dist/bin.bundle.js', 'packaged', 'README.md'],
    engines: pkg.engines,
    dependencies: runtimeDeps,
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
  console.log('Bundling Mermaid platform asset…');
  await writeMermaidBundle();
  try {
    console.log('Bundling Worker + platform assets…');
    await bundleWorker();
  } finally {
    await restoreMermaidStub();
  }
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
