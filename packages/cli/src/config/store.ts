import * as fs from 'node:fs';
import * as path from 'node:path';
import { getConfigDir, getConfigPath } from './paths.js';
import { createDefaultConfig, validateConfig } from './schema.js';
import type { NrdocsConfig } from './schema.js';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Ensures the config directory exists with secure permissions.
 */
function ensureConfigDir(configDir: string): void {
  fs.mkdirSync(configDir, { recursive: true, mode: DIR_MODE });
}

/**
 * Checks file permissions and warns if too broad (Unix only).
 */
export function checkPermissions(filePath: string): string | null {
  if (process.platform === 'win32') return null;

  try {
    const stat = fs.statSync(filePath);
    const mode = stat.mode & 0o777;
    if (mode & 0o077) {
      return `Warning: Config file ${filePath} has permissions ${mode.toString(8)}. Expected 600. Run: chmod 600 "${filePath}"`;
    }
  } catch {
    // File doesn't exist yet, no warning needed
  }
  return null;
}

/**
 * Loads the config from disk. Returns default config if file doesn't exist.
 * Optionally accepts a directory override for testing.
 */
export function loadConfig(overrideDir?: string): NrdocsConfig {
  const configPath = getConfigPath(overrideDir);

  const warning = checkPermissions(configPath);
  if (warning) {
    console.warn(warning);
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const data: unknown = JSON.parse(raw);
    return validateConfig(data);
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return createDefaultConfig();
    }
    throw err;
  }
}

/**
 * Saves the config to disk with secure permissions.
 * Optionally accepts a directory override for testing.
 */
export function saveConfig(config: NrdocsConfig, overrideDir?: string): void {
  const configDir = getConfigDir(overrideDir);
  const configPath = path.join(configDir, 'config.json');

  ensureConfigDir(configDir);

  const json = JSON.stringify(config, null, 2) + '\n';
  fs.writeFileSync(configPath, json, { mode: FILE_MODE });
}
