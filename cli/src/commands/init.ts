import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setRepoPasswordWithPublishToken, getRepoStatus } from '../api-client';
import { isValidSlug, inferSlug, inferTitle } from '../slug-validator';
import { isInteractive, prompt, confirm } from '../prompts';
import { getDefaultApiUrl } from '../global-state';
import {
  generateProjectYml,
  generateNavYml,
  generateHomeMd,
  generatePublishWorkflow,
  checkExistingFile,
  type ScaffoldConfig,
} from '../scaffolder';
import {
  isGhInstalled,
  isGhAuthenticated,
} from '../gh-integration';
import { printInitHelp } from './help';

const REPO_IDENTITY_PATTERN = /^github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const DEFAULT_PUBLISH_BRANCH = 'main';
const STATUS_METADATA_PATH = join('.nrdocs', 'status.json');

/**
 * Parse a named flag value from args: --name <value>
 */
function parseFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

/**
 * Check if the current directory is inside a git repository.
 */
function isGitRepo(): boolean {
  if (existsSync('.git')) return true;
  try {
    const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
      stdio: 'pipe',
      timeout: 5000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Detect git remote origin URL. Returns undefined if not available.
 */
function detectGitRemote(): string | undefined {
  try {
    const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
      stdio: 'pipe',
      timeout: 5000,
    });
    if (result.status !== 0) return undefined;
    const url = result.stdout?.toString().trim();
    return url || undefined;
  } catch {
    return undefined;
  }
}

function detectCurrentGitBranch(): string | undefined {
  try {
    const headPath = join('.git', 'HEAD');
    if (existsSync(headPath)) {
      const head = readFileSync(headPath, 'utf-8').trim();
      const prefix = 'ref: refs/heads/';
      if (head.startsWith(prefix)) return head.slice(prefix.length);
    }
  } catch {
    // Fall through to git for normal repositories and worktrees.
  }

  try {
    const result = spawnSync('git', ['branch', '--show-current'], {
      stdio: 'pipe',
      timeout: 5000,
    });
    const branch = result.stdout?.toString().trim();
    if (result.status === 0 && branch) return branch;
  } catch {
    return undefined;
  }
}

export function inferPublishBranchDefault(flagPublishBranch?: string): string {
  return flagPublishBranch ?? detectCurrentGitBranch() ?? DEFAULT_PUBLISH_BRANCH;
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

/**
 * Derive repo_identity from a git remote URL.
 * HTTPS: https://github.com/owner/repo.git → github.com/owner/repo
 * SSH: git@github.com:owner/repo.git → github.com/owner/repo
 * SSH host alias: git@work:owner/repo.git → github.com/owner/repo
 */
export function inferRepoIdentity(remoteUrl: string): string | undefined {
  // HTTPS
  const httpsMatch = remoteUrl.match(
    /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  );
  if (httpsMatch) {
    const host = httpsMatch[1].toLowerCase();
    if (host !== 'github.com') return undefined;
    return `github.com/${httpsMatch[2]}/${httpsMatch[3]}`;
  }

  const sshUrlMatch = remoteUrl.match(
    /^ssh:\/\/git@([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  );
  if (sshUrlMatch) {
    const host = sshUrlMatch[1].toLowerCase();
    if (host !== 'github.com') return undefined;
    return `github.com/${sshUrlMatch[2]}/${sshUrlMatch[3]}`;
  }

  // SCP-like SSH. The host can be a local SSH alias; GitHub Actions still
  // identifies the repository as github.com/<owner>/<repo>.
  const sshMatch = remoteUrl.match(
    /^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/,
  );
  if (sshMatch) {
    return `github.com/${sshMatch[2]}/${sshMatch[3]}`;
  }
  return undefined;
}

/**
 * Extract the repo name (last segment) from a repo identity string.
 */
function repoNameFromIdentity(repoIdentity: string): string {
  const parts = repoIdentity.split('/');
  return parts[parts.length - 1] || '';
}

/**
 * Conservative GitHub branch/ref-name validation for workflow triggers.
 */
function isValidPublishBranch(branch: string): boolean {
  if (!branch || branch.length > 255) return false;
  if (branch.startsWith('/') || branch.endsWith('/')) return false;
  if (branch.startsWith('.') || branch.endsWith('.')) return false;
  if (
    branch.includes('..') ||
    branch.includes('@{') ||
    branch.includes('\\') ||
    branch.includes('//')
  ) {
    return false;
  }
  return /^[A-Za-z0-9._/-]+$/.test(branch);
}

function publishedDocsUrl(baseUrl: string | undefined, siteSlug: string): string | undefined {
  const base = baseUrl?.trim().replace(/\/$/, '');
  if (!base) return undefined;
  return `${base}/${siteSlug}/`;
}

function writeStatusMetadata(metadata: Record<string, unknown>): void {
  mkdirSync('.nrdocs', { recursive: true });
  writeFileSync(STATUS_METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

/**
 * Run the `nrdocs init` command — 6-phase onboarding flow.
 */
export async function runInit(args: string[]): Promise<void> {
  // Handle --help / -h
  if (args.includes('--help') || args.includes('-h')) {
    printInitHelp();
    return;
  }

  // ── Parse flags ────────────────────────────────────────────────────
  const flagApiUrl = parseFlag(args, '--api-url');
  const flagRepoId = parseFlag(args, '--repo-id') ?? parseFlag(args, '--project-id');
  const flagSlug = parseFlag(args, '--slug');
  const flagTitle = parseFlag(args, '--title');
  const flagRepoIdentity = parseFlag(args, '--repo-identity');
  const flagDocsDir = parseFlag(args, '--docs-dir');
  const flagDescription = parseFlag(args, '--description');
  const flagPublishBranch = parseFlag(args, '--publish-branch');
  const flagAccessMode = parseFlag(args, '--access-mode');
  const overwriteScaffold = hasFlag(args, '--overwrite-scaffold');
  const skipCiCheck = hasFlag(args, '--skip-ci-check');
  const skipGhPermissionCheck = hasFlag(args, '--skip-gh-permission-check');
  const publishBranchDefault = inferPublishBranchDefault(flagPublishBranch);

  // ══════════════════════════════════════════════════════════════════
  // Phase 1: Preflight Checks
  // ══════════════════════════════════════════════════════════════════

  // 1a. Verify git repo
  if (!isGitRepo()) {
    console.error('Error: This command must be run from within a git repository.');
    process.exitCode = 1;
    return;
  }

  // 1b. Resolve API base URL
  const apiBaseUrl = flagApiUrl?.trim() || process.env.NRDOCS_API_URL?.trim() || getDefaultApiUrl() || '';
  if (!apiBaseUrl) {
    console.error(
      'Error: Missing Control Plane URL.\n\n' +
        'Set one of:\n' +
        '  - --api-url https://<control-plane-worker>\n' +
        '  - NRDOCS_API_URL in the environment\n' +
        '  - nrdocs config set api-url <url>  (stored in ~/.nrdocs/config.json)\n',
    );
    process.exitCode = 1;
    return;
  }

  // 1d. Detect git remote
  const remoteUrl = detectGitRemote();
  let inferredRepoIdentity: string | undefined;
  if (remoteUrl) {
    inferredRepoIdentity = inferRepoIdentity(remoteUrl);
  }
  if (!remoteUrl || !inferredRepoIdentity) {
    console.error('Warning: Could not infer repo identity from git remote origin.');
  }

  // OIDC-based publishing is secretless; `gh` is not required for init.
  // Keep the flag accepted for backward compatibility, but do not warn by default.
  void skipGhPermissionCheck;
  void (await isGhInstalled());
  void (await isGhAuthenticated());

  // ══════════════════════════════════════════════════════════════════
  // Phase 2: Optional repo id (operator-first / local status only)
  // ══════════════════════════════════════════════════════════════════

  let deliveryBaseUrl: string | undefined;
  const repoIdFromEnv = flagRepoId?.trim() || process.env.NRDOCS_REPO_ID?.trim() || '';

  // ══════════════════════════════════════════════════════════════════
  // Phase 3: Local Repository Discovery
  // ══════════════════════════════════════════════════════════════════

  let repoIdentity: string;
  let slug: string;
  let title: string;
  let docsDir: string;
  let description: string;
  let publishBranch: string;
  let accessMode: 'public' | 'password';

  if (!isInteractive()) {
    // Non-interactive mode: use flags, error if required values missing
    const missing: string[] = [];
    if (!flagSlug) missing.push('--slug');
    if (!flagTitle) missing.push('--title');
    if (!flagRepoIdentity && !inferredRepoIdentity) missing.push('--repo-identity');

    if (missing.length > 0) {
      console.error(
        `Error: Non-interactive mode requires --slug, --title, and --repo-identity flags. Missing: ${missing.join(', ')}`,
      );
      process.exitCode = 1;
      return;
    }

    repoIdentity = flagRepoIdentity ?? inferredRepoIdentity!;
    slug = flagSlug!;
    title = flagTitle!;
    docsDir = flagDocsDir ?? 'docs';
    description = flagDescription ?? '';
    publishBranch = publishBranchDefault;
    accessMode = (flagAccessMode as 'public' | 'password' | null) ?? 'public';
  } else {
    // Interactive mode: prompt with inferred defaults

    // 3a. Repo identity
    const repoIdentityDefault = flagRepoIdentity ?? inferredRepoIdentity;
    let validRepoIdentity = false;
    repoIdentity = '';
    while (!validRepoIdentity) {
      repoIdentity = await prompt('Repo identity', repoIdentityDefault);
      if (REPO_IDENTITY_PATTERN.test(repoIdentity)) {
        validRepoIdentity = true;
      } else {
        console.error('Invalid repo identity. Expected format: github.com/<owner>/<repo>');
      }
    }

    // Warn if manually provided (different from inferred)
    if (inferredRepoIdentity && repoIdentity !== inferredRepoIdentity) {
      console.log(
        'Note: The generated workflow assumes the current repository matches the provided identity. A mismatch will cause publish failures.',
      );
    }

    // 3b. Slug
    const repoName = repoNameFromIdentity(repoIdentity);
    const slugDefault = flagSlug ?? (repoName ? inferSlug(repoName) : undefined);
    let validSlug = false;
    slug = '';
    while (!validSlug) {
      slug = await prompt('Project slug', slugDefault);
      if (isValidSlug(slug)) {
        validSlug = true;
      } else {
        console.error(
          'Invalid slug. Must be lowercase alphanumeric and hyphens only (e.g., my-project).',
        );
      }
    }

    // 3c. Title
    const titleDefault = flagTitle ?? (repoName ? inferTitle(repoName) : undefined);
    title = await prompt('Project title', titleDefault);
    if (!title) {
      console.error('Error: Title cannot be empty.');
      process.exitCode = 1;
      return;
    }

    // 3d. Docs directory
    docsDir = await prompt('Docs directory', flagDocsDir ?? 'docs');

    // 3e. Description
    description = await prompt('Description', flagDescription ?? '');

    // 3f. Access mode
    console.log('\nAccess mode controls reader access to your published docs.');
    console.log('  - public: anyone can read (recommended to start)');
    console.log('  - password: readers must sign in with a shared password you set after first publish');
    let validAccessMode = false;
    accessMode = 'public';
    while (!validAccessMode) {
      const value = (await prompt('Access mode (public|password)', flagAccessMode ?? 'public')).trim();
      if (value === 'public' || value === 'password') {
        accessMode = value;
        validAccessMode = true;
      } else {
        console.error('Invalid access mode. Expected: public or password');
      }
    }

    // 3g. Publish branch
    if (!flagPublishBranch) {
      console.log(
        '\nPublish branch is the Git branch whose pushes trigger publishing. ' +
          'Use your generated docs branch after import (usually nrdocs), or main if docs live on main.',
      );
    }
    publishBranch = await prompt('Publish branch (GitHub trigger branch)', publishBranchDefault);
  }

  // Validate slug and repo_identity in non-interactive mode too
  if (!isInteractive()) {
    if (!isValidSlug(slug)) {
      console.error(
        'Error: Invalid slug format. Must be lowercase alphanumeric and hyphens only (e.g., my-project).',
      );
      process.exitCode = 1;
      return;
    }
    if (!REPO_IDENTITY_PATTERN.test(repoIdentity)) {
      console.error(
        'Error: Invalid repo identity format. Expected: github.com/<owner>/<repo>',
      );
      process.exitCode = 1;
      return;
    }
    if (accessMode !== 'public' && accessMode !== 'password') {
      console.error('Error: Invalid access mode. Expected: public or password');
      process.exitCode = 1;
      return;
    }
  }

  if (!isValidPublishBranch(publishBranch)) {
    console.error(
      'Error: Invalid publish branch. Use a branch name like "main", "docs", or "docs/site" (letters, numbers, dot, underscore, slash, hyphen).',
    );
    process.exitCode = 1;
    return;
  }

  if (accessMode === 'password') {
    console.log('');
    console.log('Password mode: after the first successful publish, set the shared reader password:');
    console.log('  nrdocs password set');
    console.log('Your operator can set it with: nrdocs admin set-password <repo-id>');
    console.log('Until a password is set, readers cannot complete sign-in for this site.');
  }

  // ══════════════════════════════════════════════════════════════════
  // Phase 4: Optional — validate linked Control Plane project (--repo-id)
  // ══════════════════════════════════════════════════════════════════

  const repoId = repoIdFromEnv;
  const repoPublishToken: string | null = null;

  if (repoIdFromEnv) {
    try {
      const remote = await getRepoStatus(apiBaseUrl, repoId);
      deliveryBaseUrl = remote.delivery_url ?? deliveryBaseUrl ?? undefined;
      const remoteRepoIdentity = (remote.repo_identity ?? '').trim();
      if (!remoteRepoIdentity) {
        console.error('Error: Registered repo is missing repo_identity on the Control Plane.');
        console.error('GitHub Actions OIDC resolves the repo via that field (repo_url alone is not enough).');
        console.error('');
        console.error('Use the same control plane URL as register/approve: --api-url, NRDOCS_API_URL, or ~/.nrdocs (nrdocs config set api-url).');
        console.error('');
        if (remote.status === 'approved') {
          console.error('This repo is already approved; approving again will not change repo_identity.');
          console.error('Operator: mint a publish token with the repo identity:');
          console.error(`  nrdocs admin mint-publish-token ${repoId} --repo-identity github.com/<owner>/<repo>`);
          console.error('If that fails with a unique conflict, delete or retarget the other repo row, then retry.');
        } else {
          console.error('Operator: approve with repo identity (status must be awaiting_approval):');
          console.error(`  nrdocs admin approve ${repoId} --repo-identity github.com/<owner>/<repo>`);
        }
        process.exitCode = 1;
        return;
      }
      if (remoteRepoIdentity !== repoIdentity) {
        console.error('Error: Control Plane repo_identity does not match this git repository.');
        console.error(`  Repo id: ${repoId}`);
        console.error(`  Control Plane repo_identity: ${remoteRepoIdentity}`);
        console.error(`  Local repo_identity:         ${repoIdentity}`);
        console.error('');
        console.error('Fix: run init from the correct repo, or ask your operator to fix repo_identity on the server.');
        process.exitCode = 1;
        return;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: Could not load repo status from Control Plane: ${message}`);
      process.exitCode = 1;
      return;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // Phase 5: Local Scaffolding
  // ══════════════════════════════════════════════════════════════════

  const scaffoldConfig: ScaffoldConfig = {
    slug,
    title,
    description,
    docsDir,
    apiUrl: apiBaseUrl,
    repoIdentity,
    publishBranch,
    accessMode,
  };

  const projectYmlPath = join(docsDir, 'project.yml');
  const navYmlPath = join(docsDir, 'nav.yml');
  const homeMdPath = join(docsDir, 'content', 'home.md');
  const workflowPath = join('.github', 'workflows', 'publish-docs.yml');

  const projectYmlContent = generateProjectYml(scaffoldConfig);
  const navYmlContent = generateNavYml();
  const homeMdContent = generateHomeMd(title);
  const workflowContent = generatePublishWorkflow(scaffoldConfig);

  // Check scaffolding files for conflicts.
  // Note: `nav.yml` and `content/*.md` are user-owned content; do not overwrite them
  // as part of init, even when `--overwrite-scaffold` is passed (this is critical
  // for import flows like MkDocs, where nav/content are generated/imported).
  const criticalFiles = [
    { path: projectYmlPath, content: projectYmlContent, name: 'project.yml' },
    { path: workflowPath, content: workflowContent, name: 'publish-docs.yml' },
  ];

  const conflicts = criticalFiles.filter(
    (f) => checkExistingFile(f.path, f.content) === 'differs',
  );

  let scaffoldingAborted = false;

  if (conflicts.length > 0) {
    console.log(
      `\nThe following files already exist and differ from what would be generated:`,
    );
    for (const c of conflicts) {
      console.log(`  - ${c.path}`);
    }
    console.log('');
    console.log('These files are considered generated scaffolding for nrdocs.');
    console.log('You can either let nrdocs overwrite them with canonical versions, or cancel and align them manually.');

    const proceed = overwriteScaffold
      ? true
      : isInteractive()
        ? await confirm('Overwrite these files with canonical nrdocs scaffolding?', false)
        : false;

    if (!proceed) {
      scaffoldingAborted = true;
    }
  }

  if (scaffoldingAborted) {
    console.error('\nInit cancelled. No local files or GitHub secrets were changed.');
    if (repoIdFromEnv) {
      console.error(
        'A linked Control Plane project was validated before this local conflict was detected.',
      );
      console.error(`Repo ID: ${repoId}`);
      console.error(
        'If you do not want that project, ask your platform operator to delete it from the control plane.',
      );
    }
    console.error(
      'To continue, align the existing files to match your intended settings, or rerun init with:',
    );
    console.error('  nrdocs init --overwrite-scaffold');
    process.exitCode = 1;
    return;
  } else {
    // Write all files
    try {
      // Ensure docs dir exists
      mkdirSync(docsDir, { recursive: true });

      // Write project.yml (skip if identical)
      if (checkExistingFile(projectYmlPath, projectYmlContent) !== 'identical') {
        writeFileSync(projectYmlPath, projectYmlContent, 'utf-8');
      }

      // Write nav.yml only if missing (never overwrite user content).
      if (checkExistingFile(navYmlPath, navYmlContent) === 'missing') {
        writeFileSync(navYmlPath, navYmlContent, 'utf-8');
      }

      // Write content/home.md (skip if identical)
      const contentDir = join(docsDir, 'content');
      mkdirSync(contentDir, { recursive: true });
      // Write home.md only if missing (never overwrite user content).
      if (checkExistingFile(homeMdPath, homeMdContent) === 'missing') {
        writeFileSync(homeMdPath, homeMdContent, 'utf-8');
      }

      // Write workflow (skip if identical)
      const workflowDir = join('.github', 'workflows');
      mkdirSync(workflowDir, { recursive: true });
      if (checkExistingFile(workflowPath, workflowContent) !== 'identical') {
        writeFileSync(workflowPath, workflowContent, 'utf-8');
      }

      writeStatusMetadata({
        ...(repoIdFromEnv ? { repo_id: repoId } : {}),
        api_url: apiBaseUrl,
        delivery_url: deliveryBaseUrl ?? null,
        slug,
        docs_dir: docsDir,
        publish_branch: publishBranch,
        repo_identity: repoIdentity,
      });

      console.log('\nScaffolded files:');
      console.log(`  ${projectYmlPath}`);
      console.log(`  ${navYmlPath}`);
      console.log(`  ${homeMdPath}`);
      console.log(`  ${workflowPath}`);
      console.log(`  ${STATUS_METADATA_PATH}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: Could not write files: ${message}`);
      if (repoIdFromEnv) {
        console.error(
          'Note: The linked Control Plane project still exists. Remove it from the control plane if you abandon this checkout.',
        );
      }
      process.exitCode = 1;
      return;
    }
  }

  // Publishing is OIDC-based (secretless) by default.
  // There is no CI secret/variable installation phase.
  void skipCiCheck;
  if (accessMode === 'password') {
    console.log('\nPassword mode selected.');
    if (repoPublishToken) {
      try {
        const password = await readPasswordHidden('Set initial docs password: ');
        const confirmPassword = process.env.NRDOCS_NEW_PASSWORD
          ? password
          : await readPasswordHidden('Confirm password: ');
        if (!password) {
          console.error('Error: Password cannot be empty.');
          process.exitCode = 1;
          return;
        }
        if (password !== confirmPassword) {
          console.error('Error: Passwords do not match.');
          process.exitCode = 1;
          return;
        }
        await setRepoPasswordWithPublishToken(apiBaseUrl, repoId, repoPublishToken, password);
        console.log('✓ Initial password configured.');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`Warning: Could not set initial password during init: ${message}`);
        console.log('You can finish this step later with: nrdocs password set');
      }
    } else {
      console.log(
        'Note: init cannot set the initial password without a publish JWT.\n' +
          'Ask your operator to run: nrdocs admin set-password <repo-id>\n' +
          'Or, as the repo owner, run: nrdocs password set (repo-proof challenge flow).',
      );
    }
  } else {
    void repoPublishToken;
  }

  // ══════════════════════════════════════════════════════════════════
  // Success Summary
  // ══════════════════════════════════════════════════════════════════

  console.log('\n✓ Documentation repo scaffolded successfully!\n');
  console.log(`  Site slug:      ${slug}`);
  console.log(`  Repo identity:  ${repoIdentity}`);
  console.log(`  Docs directory: ${docsDir}`);
  console.log(`  Publish branch: ${publishBranch}`);
  const docsUrl = publishedDocsUrl(deliveryBaseUrl, slug);
  if (docsUrl) {
    console.log(`  Docs URL:       ${docsUrl}`);
  } else {
    console.log('  Docs URL:       <not known until publish or delivery URL is configured>');
    console.log(`                  Pattern: https://<delivery-host>/${slug}/ — check the GitHub Actions summary after publish, or run nrdocs status after linking (--repo-id).`);
  }

  console.log('\nNext steps:');
  console.log('  1. Review the generated files');
  console.log('  2. Commit the changes: git add -A && git commit -m "Initialize nrdocs"');
  console.log(
    `  3. Push to ${publishBranch}: git push origin ${publishBranch} — CI registers and waits for approval, then publishes.`,
  );
  console.log(
    '  4. Find the reader URL in the workflow summary / logs (Reader URL) once DELIVERY_URL is set on the Control Plane.',
  );
  console.log('     Optional: nrdocs init --repo-id <uuid> then nrdocs status for the same URL from the API.');
  if (docsUrl) {
    console.log(`  5. Open: ${docsUrl}`);
  } else if (accessMode === 'password') {
    console.log('  5. After publish: run nrdocs password set (or ask your operator to set-password).');
  }
}
