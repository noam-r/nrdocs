import { spawnSync } from 'node:child_process';

/** Canonical secret warning text. */
export const SECRET_WARNING =
  'WARNING: The output below contains a live secret (repo publish token). ' +
  'Your terminal history may retain this value. Treat it as a credential.';

/**
 * Check if gh CLI is installed.
 * Runs `gh --version` and returns true if exit code is 0.
 */
export async function isGhInstalled(): Promise<boolean> {
  try {
    const result = spawnSync('gh', ['--version'], {
      stdio: 'pipe',
      timeout: 5000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Check if gh CLI is authenticated for the current repo.
 * Runs `gh auth status` and returns true if exit code is 0.
 */
export async function isGhAuthenticated(): Promise<boolean> {
  try {
    const result = spawnSync('gh', ['auth', 'status'], {
      stdio: 'pipe',
      timeout: 5000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Set a GitHub Actions repository secret via gh CLI.
 * Pipes the value to stdin of `gh secret set <name>`.
 * Returns true on success, false on failure.
 */
export async function ghSetSecret(name: string, value: string): Promise<boolean> {
  try {
    const result = spawnSync('gh', ['secret', 'set', name], {
      input: value,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Set a GitHub Actions repository variable via gh CLI.
 * Runs `gh variable set <name> --body <value>`.
 * Returns true on success, false on failure.
 */
export async function ghSetVariable(name: string, value: string): Promise<boolean> {
  try {
    const result = spawnSync('gh', ['variable', 'set', name, '--body', value], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Build the manual gh commands for fallback display.
 * Returns formatted string with `gh secret set NRDOCS_PUBLISH_TOKEN`
 * and `gh variable set NRDOCS_PROJECT_ID` commands.
 */
export function buildManualGhCommands(
  publishToken: string,
  projectId: string,
): string {
  return [
    `echo '${publishToken}' | gh secret set NRDOCS_PUBLISH_TOKEN`,
    `gh variable set NRDOCS_PROJECT_ID --body '${projectId}'`,
  ].join('\n');
}
