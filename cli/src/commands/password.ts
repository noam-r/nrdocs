import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadDotEnvFromAncestors } from './admin';
import { confirm } from '../prompts';

type StatusMetadata = {
  repo_identity?: string;
  publish_branch?: string;
  api_url?: string;
  project_id?: string;
};

const STATUS_METADATA_PATH = join('.nrdocs', 'status.json');

function readStatusMetadata(): StatusMetadata | null {
  if (!existsSync(STATUS_METADATA_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(STATUS_METADATA_PATH, 'utf-8')) as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as StatusMetadata
      : null;
  } catch {
    return null;
  }
}

function printPasswordHelp(): void {
  console.log(`nrdocs password

Usage:
  nrdocs password set [--no-auto-push] [--yes]
  nrdocs password enable
  nrdocs password disable [--no-auto-push] [--yes]

Sets/rotates the reader password for a password-protected project.

This is a repo-owner command. It does NOT require GitHub secrets, PATs, or gh.
It uses a repo-proof challenge file committed to the repo; GitHub Actions verifies
the challenge with OIDC on push, enabling the Control Plane to accept the password change.
Auto-push is enabled by default; pass --no-auto-push to do git steps manually.

Reads:
  .nrdocs/status.json  (written by nrdocs init)

Environment:
  NRDOCS_NEW_PASSWORD  Non-interactive password input (otherwise prompts)`);
}

function git(args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 10000,
  });
  if (result.status !== 0) {
    const msg = result.stderr?.trim() || result.stdout?.trim() || `git ${args.join(' ')} failed`;
    throw new Error(msg);
  }
  return (result.stdout ?? '').trim();
}

function normalizePathForGit(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

type PorcelainEntry = { code: string; path: string };

function parseStatusEntries(statusPorcelain: string): PorcelainEntry[] {
  if (!statusPorcelain.trim()) return [];
  return statusPorcelain
    .split('\n')
    .map((line) => {
      const code = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const renamed = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() ?? rawPath : rawPath;
      return { code, path: normalizePathForGit(renamed) };
    })
    .filter((entry) => entry.path.length > 0);
}

function parseNameOnlyPaths(output: string): string[] {
  if (!output.trim()) return [];
  return output
    .split('\n')
    .map((line) => normalizePathForGit(line.trim()))
    .filter((line) => line.length > 0);
}

function preflightAutoPush(): { branch: string; upstream: string } | null {
  try {
    if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') {
      console.error('Error: Auto-push requires running inside a git repository.');
      return null;
    }
    const branch = git(['branch', '--show-current']);
    if (!branch) {
      console.error('Error: Auto-push cannot run from detached HEAD. Check out a branch and retry.');
      return null;
    }
    const dirtyBefore = parseStatusEntries(git(['status', '--porcelain']));
    const trackedDirty = dirtyBefore.filter((entry) => entry.code !== '??');
    if (trackedDirty.length > 0) {
      console.error('Error: Auto-push requires no tracked/staged changes before creating the challenge file.');
      console.error('Use --no-auto-push to handle git steps manually.');
      return null;
    }

    let upstream = '';
    try {
      upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    } catch {
      console.error(`Error: Branch '${branch}' has no upstream tracking branch.`);
      console.error('Set upstream first (git push -u <remote> <branch>) or use --no-auto-push.');
      return null;
    }

    const aheadCountRaw = git(['rev-list', '--count', '@{u}..HEAD']);
    const aheadCount = Number.parseInt(aheadCountRaw, 10);
    if (!Number.isFinite(aheadCount) || aheadCount > 0) {
      console.error(
        `Error: Branch '${branch}' is ahead of '${upstream}' by ${Number.isFinite(aheadCount) ? aheadCount : 'unknown'} commit(s).`,
      );
      console.error('Auto-push stops to avoid pushing existing local commits. Use --no-auto-push.');
      return null;
    }
    return { branch, upstream };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: Auto-push preflight failed: ${message}`);
    return null;
  }
}

function runAutoPushFlow(markerPath: string, challengeId: string, branch: string, upstream: string): boolean {
  const markerPathGit = normalizePathForGit(markerPath);
  try {
    console.log(`About to auto-push exactly one file: ${markerPath}`);
    console.log(`Branch: ${branch} -> ${upstream}`);

    git(['add', '--', markerPath]);
    const staged = parseNameOnlyPaths(git(['diff', '--cached', '--name-only']));
    if (staged.length !== 1 || staged[0] !== markerPathGit) {
      console.error('Error: Staged changes contain files other than the challenge file; aborting auto-push.');
      return false;
    }

    git(['commit', '-m', `nrdocs: repo-proof challenge ${challengeId}`]);
    const committedFiles = parseNameOnlyPaths(git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']));
    if (committedFiles.length !== 1 || committedFiles[0] !== markerPathGit) {
      console.error('Error: Last commit contains files other than the challenge file; refusing to push.');
      return false;
    }

    git(['push']);
    console.log('Challenge commit pushed.');
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: Auto-push failed: ${message}`);
    return false;
  }
}

function runAutoCleanupFlow(markerPath: string, challengeId: string): boolean {
  const markerPathGit = normalizePathForGit(markerPath);
  try {
    if (!existsSync(markerPath)) return true;
    const dirty = parseStatusEntries(git(['status', '--porcelain']));
    const trackedDirty = dirty.filter((entry) => entry.code !== '??');
    if (trackedDirty.length > 0) {
      console.error('Warning: Skipping automatic cleanup commit because tracked changes exist.');
      return false;
    }

    unlinkSync(markerPath);
    git(['add', '--', markerPath]);
    const staged = parseNameOnlyPaths(git(['diff', '--cached', '--name-only']));
    if (staged.length !== 1 || staged[0] !== markerPathGit) {
      console.error('Warning: Cleanup stage check failed; challenge file was not auto-committed.');
      return false;
    }

    git(['commit', '-m', `nrdocs: cleanup repo-proof challenge ${challengeId}`]);
    const committedFiles = parseNameOnlyPaths(git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']));
    if (committedFiles.length !== 1 || committedFiles[0] !== markerPathGit) {
      console.error('Warning: Cleanup commit included unexpected files; refusing to push cleanup commit.');
      return false;
    }

    git(['push']);
    console.log(`Cleanup complete: removed ${markerPath} and pushed cleanup commit.`);
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Warning: Automatic cleanup failed: ${message}`);
    return false;
  }
}

async function readPasswordHidden(promptLabel: string): Promise<string> {
  const fromEnv = process.env.NRDOCS_NEW_PASSWORD?.trim();
  if (fromEnv) return fromEnv;

  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY) {
    throw new Error('Password input requires a TTY, or set NRDOCS_NEW_PASSWORD for non-interactive use.');
  }

  return new Promise((resolve, reject) => {
    stdout.write(promptLabel);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';

    const cleanup = (): void => {
      try { stdin.setRawMode(false); } catch { /* ignore */ }
      stdin.pause();
      stdin.removeListener('data', onData);
    };

    const onData = (key: string): void => {
      if (key === '\u000d' || key === '\n' || key === '\u0004') {
        cleanup();
        stdout.write('\n');
        resolve(buf);
      } else if (key === '\u0003') {
        cleanup();
        reject(new Error('Interrupted'));
      } else if (key === '\u007f' || key === '\b') {
        buf = buf.slice(0, -1);
      } else {
        buf += key;
      }
    };

    stdin.on('data', onData);
  });
}

async function apiJson(
  apiBaseUrl: string,
  method: 'POST',
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${apiBaseUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = text;
  if (text) {
    try { data = JSON.parse(text) as unknown; } catch { /* keep raw */ }
  }
  return { ok: res.ok, status: res.status, data };
}

function apiErrorMessage(data: unknown): string {
  return typeof data === 'object' && data !== null && 'error' in data
    ? String((data as { error?: string }).error ?? '')
    : '';
}

function shouldRetryConsume(status: number, errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase();
  // Expected while waiting for the push-triggered verification to complete.
  if (status === 409 && msg.includes('not verified')) return true;
  // Transient platform/network pressure.
  if (status === 429) return true;
  if (status >= 500) return true;
  return false;
}

function requireString(value: unknown, name: string): string {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing ${name}. Run nrdocs init first.`);
  }
  return value.trim();
}

export async function runPassword(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printPasswordHelp();
    return;
  }

  loadDotEnvFromAncestors(process.cwd());

  const sub = args[0];
  const flags = new Set(args.slice(1));
  const unknownFlags = [...flags].filter((flag) => !['--no-auto-push', '--yes'].includes(flag));
  if (sub !== 'set' && sub !== 'enable' && sub !== 'disable') {
    console.error(`Unknown subcommand: ${sub}`);
    printPasswordHelp();
    process.exitCode = 1;
    return;
  }
  if (unknownFlags.length > 0) {
    console.error(`Unknown option(s): ${unknownFlags.join(', ')}`);
    printPasswordHelp();
    process.exitCode = 1;
    return;
  }

  if (sub === 'enable') {
    console.error('Error: nrdocs password enable requires setting a password. Use: nrdocs password set');
    process.exitCode = 1;
    return;
  }

  const metadata = readStatusMetadata();
  if (!metadata?.repo_identity || !metadata?.publish_branch || !metadata?.api_url || !metadata?.project_id) {
    console.error('Error: Missing .nrdocs/status.json metadata. Run nrdocs init first.');
    process.exitCode = 1;
    return;
  }

  const apiUrl = requireString(metadata.api_url, 'api_url');
  const projectId = requireString(metadata.project_id, 'project_id');
  const repoIdentity = requireString(metadata.repo_identity, 'repo_identity');

  const action = sub === 'set' ? 'set_password'
    : sub === 'enable' ? 'set_access_mode'
      : 'disable_password';
  const autoPush = !flags.has('--no-auto-push');
  const yes = flags.has('--yes');
  const autoPushContext = autoPush ? preflightAutoPush() : null;
  if (autoPush && !autoPushContext) {
    process.exitCode = 1;
    return;
  }

  // 1) Issue challenge
  const issue = await apiJson(apiUrl, 'POST', '/repo-proof/challenges', {
    project_id: projectId,
    repo_identity: repoIdentity,
    action,
  });
  if (!issue.ok) {
    console.error(`Error: Challenge request failed (${issue.status})`);
    console.error(issue.data);
    if (issue.status === 500) {
      console.error('');
      console.error('If the error mentions a missing table, apply D1 migration 0005_repo_proof_challenges.sql to your database.');
    }
    process.exitCode = 1;
    return;
  }

  const issued = issue.data as { challenge_id?: string; public_token?: string; private_token?: string | null; verify_file_path?: string };
  const challengeId = issued.challenge_id;
  const publicToken = issued.public_token;
  const privateToken = issued.private_token;
  const verifyFilePath = issued.verify_file_path ?? (challengeId ? `.nrdocs/challenges/${challengeId}.json` : undefined);

  if (!challengeId || !publicToken || !verifyFilePath) {
    console.error('Error: Challenge response missing required fields');
    console.error(issue.data);
    process.exitCode = 1;
    return;
  }
  if (!privateToken) {
    console.error('Error: Challenge response did not include private_token. Update the CLI and retry.');
    process.exitCode = 1;
    return;
  }

  // 2) Write challenge marker file
  const dir = join('.nrdocs', 'challenges');
  mkdirSync(dir, { recursive: true });
  const marker = {
    challenge_id: challengeId,
    project_id: projectId,
    repo_identity: repoIdentity,
    action,
    public_token: publicToken,
    issued_at: new Date().toISOString(),
  };
  const markerPath = verifyFilePath.startsWith('.')
    ? verifyFilePath
    : join('.', verifyFilePath);
  writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });

  console.log(`Wrote challenge file: ${markerPath}`);
  if (autoPush) {
    let approved = yes;
    if (!yes) {
      approved = await confirm(
        `Auto-push challenge file only (${markerPath}) to trigger verification?`,
        true,
      );
    }
    if (!approved) {
      console.log('Cancelled. No git commit/push was performed.');
      return;
    }
    const pushed = runAutoPushFlow(markerPath, challengeId, autoPushContext!.branch, autoPushContext!.upstream);
    if (!pushed) {
      process.exitCode = 1;
      return;
    }
    console.log('Waiting for GitHub Actions verification...');
  } else {
    console.log('');
    console.log('Next steps (required):');
    console.log(`  git add ${markerPath}`);
    console.log(`  git commit -m "nrdocs: repo-proof challenge ${challengeId}"`);
    console.log('  git push');
    console.log('');
    console.log('After the push, GitHub Actions will verify the challenge automatically.');
    console.log('When the workflow run completes, come back here and press Enter to continue.');

    if (process.stdin.isTTY) {
      await new Promise<void>((resolve) => {
        process.stdin.resume();
        process.stdin.once('data', () => resolve());
      });
    }
  }

  // 3) Consume (retry until opened or timeout)
  const deadline = Date.now() + 3 * 60 * 1000;
  if (sub === 'set') {
    const password = await readPasswordHidden('Enter new docs password: ');
    console.log('Submitting password change and waiting for challenge verification (up to 3 minutes)...');
    let attempts = 0;
    while (true) {
      attempts += 1;
      const res = await apiJson(apiUrl, 'POST', '/repo-proof/password', {
        challenge_id: challengeId,
        public_token: publicToken,
        private_token: privateToken,
        project_id: projectId,
        password,
      });
      if (res.ok) break;
      const apiError = apiErrorMessage(res.data);
      if (!shouldRetryConsume(res.status, apiError)) {
        console.error(`Error: Password change failed (${res.status})${apiError ? `: ${apiError}` : ''}`);
        console.error(res.data);
        process.exitCode = 1;
        return;
      }
      console.log(
        `  waiting (${attempts}) - status ${res.status}${apiError ? `: ${apiError}` : ''}`,
      );
      if (Date.now() > deadline) {
        console.error('Error: Timed out waiting for challenge verification.');
        console.error(res.data);
        process.exitCode = 1;
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    console.log('Password updated.');
  } else {
    const endpoint = '/repo-proof/disable-password';
    console.log('Submitting disable-password request and waiting for challenge verification (up to 3 minutes)...');
    let attempts = 0;
    while (true) {
      attempts += 1;
      const res = await apiJson(apiUrl, 'POST', endpoint, {
        challenge_id: challengeId,
        public_token: publicToken,
        private_token: privateToken,
        project_id: projectId,
      });
      if (res.ok) break;
      const apiError = apiErrorMessage(res.data);
      if (!shouldRetryConsume(res.status, apiError)) {
        console.error(`Error: Disable password failed (${res.status})${apiError ? `: ${apiError}` : ''}`);
        console.error(res.data);
        process.exitCode = 1;
        return;
      }
      console.log(
        `  waiting (${attempts}) - status ${res.status}${apiError ? `: ${apiError}` : ''}`,
      );
      if (Date.now() > deadline) {
        console.error('Error: Timed out waiting for challenge verification.');
        console.error(res.data);
        process.exitCode = 1;
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    console.log('Password protection disabled (public).');
  }

  console.log('');
  if (autoPush) {
    console.log('Finalizing: cleaning up challenge marker file...');
    const cleaned = runAutoCleanupFlow(markerPath, challengeId);
    if (!cleaned) {
      console.log(`Manual fallback: remove ${markerPath}, commit, and push to avoid re-verifying it on future pushes.`);
    }
  } else {
    console.log(`Cleanup required: remove ${markerPath} in a follow-up commit to avoid re-verifying it on future pushes.`);
  }
}

