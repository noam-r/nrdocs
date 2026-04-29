import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  branchExists,
  currentBranch,
  isWorktreeClean,
  requireCleanGitWorktree,
  switchToImportBranch,
} from './git';

const TMP = join('cli', 'src', '__test_import_git_tmp__');

function git(args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: TMP,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'nrdocs test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'nrdocs test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function commitFile(path: string, content: string): void {
  const full = join(TMP, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
  git(['add', '.']);
  git(['commit', '-m', 'commit']);
}

describe('importer git helpers', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    git(['init']);
    git(['checkout', '-b', 'main']);
    commitFile('README.md', '# Test\n');
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('creates and switches to a new import branch', () => {
    const result = switchToImportBranch(TMP, 'nrdocs', false);
    expect(result).toEqual({ branch: 'nrdocs', created: true });
    expect(currentBranch(TMP)).toBe('nrdocs');
    expect(branchExists(TMP, 'nrdocs')).toBe(true);
  });

  it('refuses an existing branch unless forced', () => {
    switchToImportBranch(TMP, 'nrdocs', false);
    git(['switch', 'main']);

    expect(() => switchToImportBranch(TMP, 'nrdocs', false)).toThrow(/--force/);
    const result = switchToImportBranch(TMP, 'nrdocs', true);
    expect(result).toEqual({ branch: 'nrdocs', created: false });
    expect(currentBranch(TMP)).toBe('nrdocs');
  });

  it('requires a clean worktree before branch operations', () => {
    expect(isWorktreeClean(TMP)).toBe(true);
    writeFileSync(join(TMP, 'dirty.md'), '# Dirty\n', 'utf8');
    expect(isWorktreeClean(TMP)).toBe(false);
    expect(() => requireCleanGitWorktree(TMP)).toThrow(/clean git worktree/);
  });
});
