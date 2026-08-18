#!/usr/bin/env node
/**
 * Pack the self-contained nrdocs CLI and verify a clean install outside the monorepo.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(cliRoot, '../..');

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: opts.cwd ?? cliRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env ?? {}) },
    shell: false,
  });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
  }
  return result;
}

async function main() {
  const runtimePkgPath = path.join(cliRoot, 'package.runtime.json');
  const workspacePkgPath = path.join(cliRoot, 'package.json');
  const runtimePkg = JSON.parse(await fs.readFile(runtimePkgPath, 'utf8'));
  const workspacePkg = JSON.parse(await fs.readFile(workspacePkgPath, 'utf8'));

  // Temporarily swap package.json for packing.
  const backup = await fs.readFile(workspacePkgPath, 'utf8');
  await fs.writeFile(workspacePkgPath, `${JSON.stringify(runtimePkg, null, 2)}\n`);
  let tgz;
  try {
    const pack = run('npm', ['pack', '--json']);
    const parsed = JSON.parse(pack.stdout.trim() || '[]');
    tgz = path.join(cliRoot, parsed[0]?.filename ?? `nrdocs-${runtimePkg.version}.tgz`);
  } finally {
    await fs.writeFile(workspacePkgPath, backup);
  }

  if (!(await fs.stat(tgz).catch(() => null))) {
    throw new Error(`Packed tarball not found: ${tgz}`);
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-pack-'));
  try {
    run('npm', ['install', '--ignore-scripts', tgz], { cwd: tmp });
    const bin = path.join(tmp, 'node_modules', 'nrdocs', 'dist', 'bin.js');
    const packagedWorker = path.join(tmp, 'node_modules', 'nrdocs', 'packaged', 'worker.mjs');
    const packagedCss = path.join(tmp, 'node_modules', 'nrdocs', 'packaged', 'reader.css');
    const packagedLogo = path.join(tmp, 'node_modules', 'nrdocs', 'packaged', 'logo.svg');
    for (const required of [bin, packagedWorker, packagedCss, packagedLogo]) {
      if (!(await fs.stat(required).catch(() => null))) {
        throw new Error(`Missing required packed file: ${required}`);
      }
    }
    const workerText = await fs.readFile(packagedWorker, 'utf8');
    if (!workerText.includes('handleRequest') && !workerText.includes('NRDOCS_PACKAGE_VERSION')) {
      throw new Error('Packed Worker module does not look like the release Worker.');
    }
    if (workerText.includes("return new Response('nrdocs'") && workerText.length < 2000) {
      throw new Error('Packed Worker still looks like the smoke stub.');
    }
    const pkgJson = JSON.parse(
      await fs.readFile(path.join(tmp, 'node_modules', 'nrdocs', 'package.json'), 'utf8'),
    );
    if (JSON.stringify(pkgJson).includes('workspace:')) {
      throw new Error('Packed package.json still contains workspace: protocol.');
    }
    for (const dep of [
      'yaml',
      'highlight.js',
      'mdast-util-from-markdown',
      'mdast-util-gfm',
      'micromark-extension-gfm',
      'unist-util-visit',
    ]) {
      if (!pkgJson.dependencies?.[dep]) {
        throw new Error(`Packed package.json missing runtime dependency: ${dep}`);
      }
    }
    const help = run(process.execPath, [bin, '--help'], { cwd: tmp });
    if (!help.stdout.includes('nrdocs')) {
      throw new Error('Packed CLI --help did not print nrdocs.');
    }
    const version = run(process.execPath, [bin, '--version'], { cwd: tmp });
    if (!version.stdout.includes(workspacePkg.version)) {
      throw new Error(
        `Packed CLI --version expected ${workspacePkg.version}, got: ${version.stdout}`,
      );
    }
    const wrapper = await fs.readFile(bin, 'utf8');
    if (
      !wrapper.includes('requires Node.js') ||
      /^\s*import\s+['"]\.\/bin\.bundle\.js['"]/m.test(wrapper)
    ) {
      throw new Error(
        'Packed CLI wrapper must check the Node.js version before loading the bundle.',
      );
    }
    const bundle = await fs.readFile(
      path.join(tmp, 'node_modules', 'nrdocs', 'dist', 'bin.bundle.js'),
      'utf8',
    );
    if (bundle.includes('node:sqlite')) {
      throw new Error('Packed CLI bundle must not import node:sqlite (test-only adapter).');
    }
    console.log('pack-check ok:', path.relative(repoRoot, tgz));
    console.log('version:', workspacePkg.version);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.rm(tgz, { force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
