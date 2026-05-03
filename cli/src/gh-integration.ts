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
 * Returns { ok, error } on failure (error is best-effort).
 */
export async function ghSetSecret(name: string, value: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = spawnSync('gh', ['secret', 'set', name], {
      input: value,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    });
    if (result.status === 0) return { ok: true };
    const stderr = result.stderr?.toString('utf-8')?.trim();
    const stdout = result.stdout?.toString('utf-8')?.trim();
    return { ok: false, error: stderr || stdout || `gh exited with code ${result.status ?? 'unknown'}` };
  } catch {
    return { ok: false, error: 'Failed to execute gh' };
  }
}

/**
 * Set a GitHub Actions repository variable via gh CLI.
 * Runs `gh variable set <name> --body <value>`.
 * Returns { ok, error } on failure (error is best-effort).
 */
export async function ghSetVariable(name: string, value: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = spawnSync('gh', ['variable', 'set', name, '--body', value], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    });
    if (result.status === 0) return { ok: true };
    const stderr = result.stderr?.toString('utf-8')?.trim();
    const stdout = result.stdout?.toString('utf-8')?.trim();
    return { ok: false, error: stderr || stdout || `gh exited with code ${result.status ?? 'unknown'}` };
  } catch {
    return { ok: false, error: 'Failed to execute gh' };
  }
}

function ghJson(args: string[]): unknown | null {
  try {
    const result = spawnSync('gh', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
    if (result.status !== 0) return null;
    const text = result.stdout?.toString('utf-8') ?? '';
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function ghHasSecret(name: string): Promise<boolean | null> {
  const json = ghJson(['secret', 'list', '--json', 'name']);
  if (!json || !Array.isArray(json)) return null;
  return json.some((row) => row && typeof row === 'object' && (row as Record<string, unknown>).name === name);
}

export async function ghHasVariable(name: string): Promise<boolean | null> {
  const json = ghJson(['variable', 'list', '--json', 'name']);
  if (!json || !Array.isArray(json)) return null;
  return json.some((row) => row && typeof row === 'object' && (row as Record<string, unknown>).name === name);
}

function ghRun(args: string[]): { ok: boolean; error?: string } {
  try {
    const result = spawnSync('gh', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
    if (result.status === 0) return { ok: true };
    const stderr = result.stderr?.toString('utf-8')?.trim();
    const stdout = result.stdout?.toString('utf-8')?.trim();
    return { ok: false, error: stderr || stdout || `gh exited with code ${result.status ?? 'unknown'}` };
  } catch {
    return { ok: false, error: 'Failed to execute gh' };
  }
}

export async function ghCurrentRepoNameWithOwner(): Promise<string | null> {
  try {
    const out = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });
    if (out.status !== 0) return null;
    const text = out.stdout?.toString('utf-8')?.trim() ?? '';
    return text || null;
  } catch {
    return null;
  }
}

export interface GhActionsCapabilityResult {
  ok: boolean;
  repo?: string;
  secretApiError?: string;
  variableApiError?: string;
}

export async function ghCheckActionsConfigWriteAccess(): Promise<GhActionsCapabilityResult> {
  const repo = await ghCurrentRepoNameWithOwner();
  if (!repo) {
    return { ok: false, secretApiError: 'Could not detect current GitHub repository via gh' };
  }

  const secretRes = ghRun(['api', `repos/${repo}/actions/secrets/public-key`]);
  const variableRes = ghRun(['api', `repos/${repo}/actions/variables`]);

  return {
    ok: secretRes.ok && variableRes.ok,
    repo,
    secretApiError: secretRes.ok ? undefined : secretRes.error,
    variableApiError: variableRes.ok ? undefined : variableRes.error,
  };
}

/**
 * Build the manual gh commands for fallback display.
 * Returns formatted string with `gh secret set NRDOCS_PUBLISH_TOKEN`
 * and `gh variable set NRDOCS_REPO_ID` commands.
 */
export function buildManualGhCommands(
  publishToken: string,
  repoId: string,
): string {
  return [
    `echo '${publishToken}' | gh secret set NRDOCS_PUBLISH_TOKEN`,
    `gh variable set NRDOCS_REPO_ID --body '${repoId}'`,
  ].join('\n');
}
