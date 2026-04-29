import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseCliToken } from '../config-parser';
import { bootstrapValidate, bootstrapOnboard, setProjectPasswordWithPublishToken } from '../api-client';
import { isValidSlug, inferSlug, inferTitle } from '../slug-validator';
import { isInteractive, prompt, confirm } from '../prompts';
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

function publishedDocsUrl(baseUrl: string | undefined, orgSlug: string, projectSlug: string): string | undefined {
  const base = baseUrl?.trim().replace(/\/$/, '');
  if (!base) return undefined;
  const path = orgSlug === 'default' ? projectSlug : `${orgSlug}/${projectSlug}`;
  return `${base}/${path}/`;
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
  const token = parseFlag(args, '--token');
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

  if (!token) {
    console.error(
      'Error: Missing required flag: --token <token>\n\nUsage: nrdocs init --token <token>',
    );
    process.exitCode = 1;
    return;
  }

  // ══════════════════════════════════════════════════════════════════
  // Phase 1: Preflight Checks
  // ══════════════════════════════════════════════════════════════════

  // 1a. Verify git repo
  if (!isGitRepo()) {
    console.error('Error: This command must be run from within a git repository.');
    process.exitCode = 1;
    return;
  }

  // 1b. Parse and validate token
  let tokenPayload: ReturnType<typeof parseCliToken>;
  try {
    tokenPayload = parseCliToken(token);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
    return;
  }

  // 1c. Enforce typ === 'org_bootstrap'
  if (tokenPayload.typ !== 'org_bootstrap') {
    console.error(
      `Error: Only bootstrap tokens are accepted for the init command. This token has type '${tokenPayload.typ}'.`,
    );
    process.exitCode = 1;
    return;
  }

  const apiBaseUrl = tokenPayload.iss;

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
  // Phase 2: Token Validation Handshake
  // ══════════════════════════════════════════════════════════════════

  let orgName: string;
  let orgSlug: string;
  let remainingQuota: number;
  let deliveryBaseUrl: string | undefined;
  try {
    const validation = await bootstrapValidate(apiBaseUrl, token);
    orgName = validation.org_name;
    orgSlug = validation.org_slug;
    remainingQuota = validation.remaining_quota;
    deliveryBaseUrl = validation.delivery_url;
    console.log(`\nOrganization: ${orgName}`);
    console.log(`Remaining project quota: ${remainingQuota}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
    return;
  }

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
    accessMode = (flagAccessMode as 'public' | 'password' | null) ?? 'password';
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
    console.log('  - public: anyone can read');
    console.log('  - password: readers must login with a shared password');
    let validAccessMode = false;
    accessMode = 'password';
    while (!validAccessMode) {
      const value = (await prompt('Access mode (public|password)', flagAccessMode ?? 'password')).trim();
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

  // ══════════════════════════════════════════════════════════════════
  // Phase 4: Remote Project Creation (Onboard)
  // ══════════════════════════════════════════════════════════════════

  let projectId: string;
  let repoPublishToken: string;
  try {
    const onboardResult = await bootstrapOnboard(apiBaseUrl, token, {
      slug,
      title,
      description,
      repo_identity: repoIdentity,
      access_mode: accessMode,
    });
    projectId = onboardResult.project_id;
    repoPublishToken = onboardResult.repo_publish_token;
    deliveryBaseUrl = onboardResult.delivery_url ?? deliveryBaseUrl;
    if (onboardResult.recovered) {
      console.log(
        '\nRecovered an existing unpublished project created by this bootstrap token. Continuing local setup.',
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
    return;
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
    console.error(
      'The remote project was already created before this local conflict was detected.',
    );
    console.error(`Project ID: ${projectId}`);
    console.error(
      'To continue, either align the existing files to match your intended settings, or rerun init with:',
    );
    console.error('  nrdocs init --token <token> --overwrite-scaffold');
    console.error(
      'If you do not want this project, ask your platform operator to delete it from the control plane.',
    );
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
        project_id: projectId,
        api_url: apiBaseUrl,
        delivery_url: deliveryBaseUrl ?? null,
        org_slug: orgSlug,
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
      console.error(
        'Note: The project is already registered on the server. Remove it from the control plane if you abandon this checkout.',
      );
      process.exitCode = 1;
      return;
    }
  }

  // Publishing is OIDC-based (secretless) by default.
  // There is no CI secret/variable installation phase.
  void skipCiCheck;
  if (accessMode === 'password') {
    console.log('\nPassword mode selected.');
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
      await setProjectPasswordWithPublishToken(apiBaseUrl, projectId, repoPublishToken, password);
      console.log('✓ Initial password configured.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`Warning: Could not set initial password during init: ${message}`);
      console.log('You can finish this step later with: nrdocs password set');
    }
  } else {
    void repoPublishToken;
  }

  // ══════════════════════════════════════════════════════════════════
  // Success Summary
  // ══════════════════════════════════════════════════════════════════

  console.log('\n✓ Project onboarded successfully!\n');
  console.log(`  Project slug:   ${slug}`);
  console.log(`  Organization:   ${orgName}`);
  console.log(`  Repo identity:  ${repoIdentity}`);
  console.log(`  Docs directory: ${docsDir}`);
  console.log(`  Publish branch: ${publishBranch}`);
  const docsUrl = publishedDocsUrl(deliveryBaseUrl, orgSlug, slug);
  if (docsUrl) {
    console.log(`  Docs URL:       ${docsUrl}`);
  } else {
    console.log('  Docs URL:       <delivery URL unavailable>');
    console.log('                  Ask your platform operator for the Delivery Worker URL.');
  }

  console.log('\nNext steps:');
  console.log('  1. Review the generated files');
  console.log('  2. Commit the changes: git add -A && git commit -m "Initialize nrdocs"');
  console.log(`  3. Push to ${publishBranch} to trigger the first publish: git push origin ${publishBranch}`);
  if (docsUrl) {
    console.log(`  4. After the workflow succeeds, visit: ${docsUrl}`);
  }
}
