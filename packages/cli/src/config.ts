import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseNrdocsConfig, type NrdocsConfig, type ParseConfigOptions } from '@nrdocs/contracts';
import type { Runtime } from './runtime.js';
import { assertRealDirectory, assertRegularNonSymlinkFile } from './fs-safe.js';
import { localValidationError, ioError } from './errors.js';

export async function resolvePublicationDirectory(
  runtime: Runtime,
  directoryArg: string | undefined,
): Promise<string> {
  const selected = directoryArg === undefined ? runtime.cwd : directoryArg;
  const absolute = path.resolve(runtime.cwd, selected);
  return assertRealDirectory(runtime, absolute);
}

/** Resolve the docs directory for generate nav when no path argument is given. */
export async function resolveGenerateNavDirectory(
  runtime: Runtime,
  directoryArg: string | undefined,
): Promise<string> {
  if (directoryArg !== undefined) {
    return resolvePublicationDirectory(runtime, directoryArg);
  }

  const cwd = path.resolve(runtime.cwd);
  try {
    await assertRegularNonSymlinkFile(runtime, configPathFor(cwd), 'nrdocs.yml');
    return assertRealDirectory(runtime, cwd);
  } catch {
    // Continue to search immediate child directories.
  }

  let entries: string[];
  try {
    entries = await runtime.fs.readdir(cwd);
  } catch {
    return assertRealDirectory(runtime, cwd);
  }

  const candidates: string[] = [];
  for (const name of entries.sort()) {
    const child = path.join(cwd, name);
    try {
      const st = await runtime.fs.lstat(child);
      if (!st.isDirectory() || st.isSymbolicLink()) continue;
      await assertRegularNonSymlinkFile(runtime, configPathFor(child), 'nrdocs.yml');
      candidates.push(child);
    } catch {
      continue;
    }
  }

  if (candidates.length === 1) {
    return candidates[0]!;
  }

  return assertRealDirectory(runtime, cwd);
}

export function configPathFor(root: string): string {
  return path.join(root, 'nrdocs.yml');
}

export async function loadNrdocsConfig(
  runtime: Runtime,
  root: string,
  options: ParseConfigOptions = {},
): Promise<{ path: string; config: NrdocsConfig; raw: unknown }> {
  const configPath = configPathFor(root);
  try {
    await assertRegularNonSymlinkFile(runtime, configPath, 'nrdocs.yml');
  } catch (error) {
    if (error instanceof Error && /was not found/.test(error.message)) {
      throw localValidationError(
        `nrdocs.yml was not found in:\n  ${root}\n\nRun:\n  nrdocs connect ${root}\n\nOr prepare an unconnected preview configuration with:\n  nrdocs generate nav ${root}`,
      );
    }
    throw error;
  }

  let text: string;
  try {
    text = await runtime.fs.readFile(configPath, 'utf8');
  } catch {
    throw ioError(`Unable to read nrdocs.yml:\n  ${configPath}`);
  }

  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch {
    throw localValidationError(`nrdocs.yml is not valid YAML:\n  ${configPath}`);
  }

  try {
    const config = parseNrdocsConfig(raw, options);
    return { path: configPath, config, raw };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'invalid configuration';
    throw localValidationError(`Invalid nrdocs.yml (${msg}):\n  ${configPath}`);
  }
}
