import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseCliToken } from '../config-parser';
import { bootstrapValidate, bootstrapOnboard } from '../api-client';
import { isValidSlug, inferSlug, inferTitle } from '../slug-validator';
import { isInteractive, prompt, confirm } from '../prompts';
import {
  generateProjectYml,
  generateNavYml,
  generateHomeMd,
  generatePublishWorkflow,
  checkExistingFile,
  validateExistingProjectYml,
  validateExistingNavYml,
  validateExistingWorkflow,
  type ScaffoldConfig,
} from '../scaffolder';
import {
  isGhInstalled,
  isGhAuthenticated,
  ghSetSecret,
  ghSetVariable,
  buildManualGhCommands,
  SECRET_WARNING,
} from '../gh-integration';
import { printInitHelp } from './help';

const REPO_IDENTITY_PATTERN = /^github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

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

/**
 * Derive repo_identity from a git remote URL.
 * HTTPS: https://github.com/owner/repo.git → github.com/owner/repo
 * SSH: git@github.com:owner/repo.git → github.com/owner/repo
 */
function inferRepoIdentity(remoteUrl: string): string | undefined {
  // HTTPS
  const httpsMatch = remoteUrl.match(
    /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  );
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}/${httpsMatch[3]}`;
  }
  // SSH
  const sshMatch = remoteUrl.match(
    /^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/,
  );
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}/${sshMatch[3]}`;
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

  // ══════════════════════════════════════════════════════════════════
  // Phase 2: Token Validation Handshake
  // ══════════════════════════════════════════════════════════════════

  let orgName: string;
  let remainingQuota: number;
  try {
    const validation = await bootstrapValidate(apiBaseUrl, token);
    orgName = validation.org_name;
    remainingQuota = validation.remaining_quota;
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
  }

  // ══════════════════════════════════════════════════════════════════
  // Phase 4: Local Scaffolding
  // ══════════════════════════════════════════════════════════════════

  const scaffoldConfig: ScaffoldConfig = {
    slug,
    title,
    description,
    docsDir,
    apiUrl: apiBaseUrl,
    repoIdentity,
  };

  const projectYmlPath = join(docsDir, 'project.yml');
  const navYmlPath = join(docsDir, 'nav.yml');
  const homeMdPath = join(docsDir, 'content', 'home.md');
  const workflowPath = join('.github', 'workflows', 'publish-docs.yml');

  const projectYmlContent = generateProjectYml(scaffoldConfig);
  const navYmlContent = generateNavYml();
  const homeMdContent = generateHomeMd(title);
  const workflowContent = generatePublishWorkflow(scaffoldConfig);

  // Check critical files for conflicts
  const criticalFiles = [
    { path: projectYmlPath, content: projectYmlContent, name: 'project.yml' },
    { path: navYmlPath, content: navYmlContent, name: 'nav.yml' },
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
    console.log(
      'Proceeding may leave the repository in an inconsistent state.',
    );

    const proceed = isInteractive()
      ? await confirm('Continue with partial scaffolding?', false)
      : false;

    if (!proceed) {
      scaffoldingAborted = true;
    }
  }

  if (scaffoldingAborted) {
    // Validate existing files
    console.log('Scaffolding aborted. Validating existing files...');

    if (!validateExistingProjectYml(docsDir)) {
      console.error(
        'Error: Existing project.yml does not meet validity requirements. Must contain slug and title fields.',
      );
      process.exitCode = 1;
      return;
    }
    if (!validateExistingNavYml(docsDir)) {
      console.error(
        'Error: Existing nav.yml does not meet validity requirements. Must be valid YAML.',
      );
      process.exitCode = 1;
      return;
    }
    if (!validateExistingWorkflow()) {
      console.error(
        'Error: Existing publish-docs.yml does not meet validity requirements. Must reference NRDOCS_PUBLISH_TOKEN, NRDOCS_PROJECT_ID, and X-Repo-Identity.',
      );
      process.exitCode = 1;
      return;
    }

    console.log('Existing files pass validity checks. Continuing to project creation.');
  } else {
    // Write all files
    try {
      // Ensure docs dir exists
      mkdirSync(docsDir, { recursive: true });

      // Write project.yml (skip if identical)
      if (checkExistingFile(projectYmlPath, projectYmlContent) !== 'identical') {
        writeFileSync(projectYmlPath, projectYmlContent, 'utf-8');
      }

      // Write nav.yml (skip if identical)
      if (checkExistingFile(navYmlPath, navYmlContent) !== 'identical') {
        writeFileSync(navYmlPath, navYmlContent, 'utf-8');
      }

      // Write content/home.md (skip if identical)
      const contentDir = join(docsDir, 'content');
      mkdirSync(contentDir, { recursive: true });
      if (checkExistingFile(homeMdPath, homeMdContent) !== 'identical') {
        writeFileSync(homeMdPath, homeMdContent, 'utf-8');
      }

      // Write workflow (skip if identical)
      const workflowDir = join('.github', 'workflows');
      mkdirSync(workflowDir, { recursive: true });
      if (checkExistingFile(workflowPath, workflowContent) !== 'identical') {
        writeFileSync(workflowPath, workflowContent, 'utf-8');
      }

      console.log('\nScaffolded files:');
      console.log(`  ${projectYmlPath}`);
      console.log(`  ${navYmlPath}`);
      console.log(`  ${homeMdPath}`);
      console.log(`  ${workflowPath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: Could not write files: ${message}`);
      process.exitCode = 1;
      return;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // Phase 5: Remote Project Creation (Onboard)
  // ══════════════════════════════════════════════════════════════════

  let projectId: string;
  let repoPublishToken: string;
  try {
    const onboardResult = await bootstrapOnboard(apiBaseUrl, token, {
      slug,
      title,
      description,
      repo_identity: repoIdentity,
    });
    projectId = onboardResult.project_id;
    repoPublishToken = onboardResult.repo_publish_token;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
    return;
  }

  // ══════════════════════════════════════════════════════════════════
  // Phase 6: CI Secret Installation
  // ══════════════════════════════════════════════════════════════════

  let secretsInstalled = false;

  const ghInstalled = await isGhInstalled();
  const ghAuthed = ghInstalled ? await isGhAuthenticated() : false;

  if (ghInstalled && ghAuthed) {
    const secretOk = await ghSetSecret('NRDOCS_PUBLISH_TOKEN', repoPublishToken);
    const variableOk = await ghSetVariable('NRDOCS_PROJECT_ID', projectId);

    if (secretOk && variableOk) {
      secretsInstalled = true;
      console.log('\nCI secrets configured automatically via gh CLI.');
    } else {
      // Partial failure — print fallback
      console.error('\nWarning: Automatic secret installation failed.');
      console.error(SECRET_WARNING);
      console.error(buildManualGhCommands(repoPublishToken, projectId));
    }
  } else {
    // gh not available — print manual commands
    console.log('');
    console.error(SECRET_WARNING);
    console.log(buildManualGhCommands(repoPublishToken, projectId));
    console.log(
      '\nAlternatively, add them manually via the GitHub UI:',
    );
    console.log(
      '  1. Go to your repository Settings → Secrets and variables → Actions',
    );
    console.log(
      '  2. Create a new secret named NRDOCS_PUBLISH_TOKEN with the repo publish token',
    );
    console.log(
      '  3. Create a new variable named NRDOCS_PROJECT_ID with the project ID',
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // Success Summary
  // ══════════════════════════════════════════════════════════════════

  console.log('\n✓ Project onboarded successfully!\n');
  console.log(`  Project slug:   ${slug}`);
  console.log(`  Organization:   ${orgName}`);
  console.log(`  Repo identity:  ${repoIdentity}`);
  console.log(`  Docs directory: ${docsDir}`);

  if (secretsInstalled) {
    console.log('\n  CI secret is configured. Your repository is ready for publishing.');
  } else {
    console.log(
      '\n  Complete the manual secret installation above before publishing.',
    );
  }

  console.log('\nNext steps:');
  console.log('  1. Review the generated files');
  console.log('  2. Commit the changes: git add -A && git commit -m "Initialize nrdocs"');
  console.log('  3. Push to main to trigger the first publish: git push origin main');
}
