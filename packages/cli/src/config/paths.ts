import * as os from 'node:os';
import * as path from 'node:path';

const APP_NAME = 'nrdocs';
const CONFIG_FILE = 'config.json';

/**
 * Returns the config directory path for nrdocs.
 * Uses XDG_CONFIG_HOME on Linux/macOS, or falls back to ~/.config.
 */
export function getConfigDir(overrideDir?: string): string {
  if (overrideDir) return overrideDir;

  const xdg = process.env['XDG_CONFIG_HOME'];
  const base = xdg || path.join(os.homedir(), '.config');
  return path.join(base, APP_NAME);
}

/**
 * Returns the full path to the config file.
 */
export function getConfigPath(overrideDir?: string): string {
  return path.join(getConfigDir(overrideDir), CONFIG_FILE);
}
