import { spawnSync } from 'node:child_process';
import { CliUsageError } from '../cli-usage-error';

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 10000,
  });

  if (result.status !== 0) {
    const message = result.stderr?.trim() || result.stdout?.trim() || `git ${args.join(' ')} failed`;
    throw new CliUsageError(message);
  }

  return result.stdout.trim();
}

export function isGitRepo(cwd: string): boolean {
  try {
    return git(cwd, ['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch {
    return false;
  }
}

export function currentBranch(cwd: string): string {
  return git(cwd, ['branch', '--show-current']);
}

export function branchExists(cwd: string, branch: string): boolean {
  const result = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd,
    stdio: 'pipe',
    timeout: 10000,
  });
  return result.status === 0;
}

export function isWorktreeClean(cwd: string): boolean {
  return git(cwd, ['status', '--porcelain']).length === 0;
}

export function requireCleanGitWorktree(cwd: string): void {
  if (!isGitRepo(cwd)) {
    throw new CliUsageError('MkDocs import must be run inside a git repository.');
  }

  if (!currentBranch(cwd)) {
    throw new CliUsageError('MkDocs import cannot run from a detached HEAD. Check out a branch first.');
  }

  if (!isWorktreeClean(cwd)) {
    throw new CliUsageError(
      'MkDocs import switches branches and requires a clean git worktree. Commit or stash your changes, then retry.',
    );
  }
}

export interface SwitchBranchResult {
  branch: string;
  created: boolean;
}

export function switchToImportBranch(cwd: string, branch: string, force: boolean): SwitchBranchResult {
  const exists = branchExists(cwd, branch);
  if (exists && !force) {
    throw new CliUsageError(
      `Branch '${branch}' already exists. Re-run with --force to switch to it and regenerate nrdocs files.`,
    );
  }

  if (exists) {
    git(cwd, ['switch', branch]);
    return { branch, created: false };
  }

  git(cwd, ['switch', '-c', branch]);
  return { branch, created: true };
}
