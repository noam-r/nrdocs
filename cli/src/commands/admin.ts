import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import { CliUsageError } from '../cli-usage-error';
import { parseProjectConfig } from '../config-parser';
import { confirm } from '../prompts';

function fail(message: string): never {
  throw new CliUsageError(message);
}

/** Walk upward from `start` and merge the first `.env` found (does not override existing `process.env`). */
export function loadDotEnvFromAncestors(startDir: string): void {
  let dir = resolve(startDir);
  for (let depth = 0; depth < 24; depth++) {
    const envPath = join(dir, '.env');
    if (existsSync(envPath)) {
      const text = readFileSync(envPath, 'utf8');
      for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq === -1) continue;
        const key = t.slice(0, eq).trim();
        let val = t.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function assertNotCiUnlessAllowed(): void {
  if (process.env.NRDOCS_ALLOW_ADMIN_IN_CI === '1') return;
  if (process.env.GITHUB_ACTIONS || process.env.CI) {
    fail(
      'Refusing admin CLI in CI (GITHUB_ACTIONS or CI is set). Do not put NRDOCS_API_KEY in documentation-repo workflows. ' +
        'For trusted platform-repo automation only: NRDOCS_ALLOW_ADMIN_IN_CI=1',
    );
  }
}

function requireApiEnv(): { apiUrl: string; apiKey: string } {
  const apiUrl = process.env.NRDOCS_API_URL?.trim() ?? '';
  const apiKey = process.env.NRDOCS_API_KEY?.trim() ?? '';
  if (!apiUrl) {
    fail(
      'NRDOCS_API_URL is not set.\n\n' +
        'You are running an admin command. Admin commands are for platform operators and should be run from an operator workspace ' +
        '(for example the nrdocs platform repo) with a private, uncommitted .env, or with environment variables set in your shell.\n\n' +
        'If you are a docs repo owner trying to publish, ask your operator for a bootstrap token, then run:\n' +
        '  nrdocs init --token <bootstrap-token>',
    );
  }
  if (!apiKey) {
    fail(
      'NRDOCS_API_KEY is not set.\n\n' +
        'Admin commands require the Control Plane operator API key. Keep it in a private operator .env or your shell environment; ' +
        'never put it in a documentation repo or GitHub Actions workflow.',
    );
  }
  return { apiUrl, apiKey };
}

function projectIdFromArgs(args: string[]): string | undefined {
  const flagsWithValues = new Set(['--project-id', '-p', '--repo-identity']);
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--project-id' || args[i] === '-p') && args[i + 1]) {
      return args[i + 1];
    }
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (flagsWithValues.has(arg)) {
      i += 1;
      continue;
    }
    if (!arg.startsWith('-')) return arg;
  }
  return undefined;
}

function requireProjectId(args: string[] = []): string {
  const id = projectIdFromArgs(args)?.trim() || process.env.NRDOCS_PROJECT_ID?.trim() || '';
  if (!id) {
    fail(
      'Missing project id. Pass it as an argument (for example: nrdocs admin approve <project-id>) or set NRDOCS_PROJECT_ID.',
    );
  }
  return id;
}

function docsPathFromEnv(): string {
  const rel = process.env.NRDOCS_DOCS_DIR?.trim() || 'docs';
  return resolve(process.cwd(), rel);
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
}

function printApiResult(status: number, data: unknown, ok: boolean): void {
  if (ok) {
    console.log(`Success (${status})`);
    console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  } else {
    console.error(`Failed (${status}): ${apiErrorMessage(data)}`);
  }
}

function apiErrorMessage(data: unknown): string {
  if (typeof data === 'string') return data || 'Unknown error';
  if (data != null && typeof data === 'object' && !Array.isArray(data)) {
    const err = (data as Record<string, unknown>).error;
    if (typeof err === 'string' && err.trim()) return err;
    const message = (data as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return 'Unknown error';
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function pad(value: string, width: number): string {
  return truncate(value, width).padEnd(width, ' ');
}

async function apiJson(
  apiUrl: string,
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${apiUrl.replace(/\/$/, '')}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = text;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      /* keep raw string */
    }
  }
  return { ok: res.ok, status: res.status, data };
}

function walkMdFiles(contentDir: string): string[] {
  const out: string[] = [];
  function walk(d: string): void {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && name.endsWith('.md')) out.push(p);
    }
  }
  walk(contentDir);
  return out.sort();
}

async function readPasswordHidden(): Promise<string> {
  const fromEnv = process.env.NRDOCS_NEW_PASSWORD?.trim();
  if (fromEnv) return fromEnv;

  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY) {
    fail('Password input requires a TTY, or set NRDOCS_NEW_PASSWORD for non-interactive use.');
  }

  return new Promise((resolve, reject) => {
    stdout.write('Enter password for project: ');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';

    const cleanup = (): void => {
      try {
        stdin.setRawMode(false);
      } catch {
        /* ignore */
      }
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

async function cmdRegister(): Promise<string | undefined> {
  const { apiUrl, apiKey } = requireApiEnv();
  const docsPath = docsPathFromEnv();
  const projectYml = join(docsPath, 'project.yml');
  if (!existsSync(projectYml)) fail(`project.yml not found at ${projectYml}`);

  const ymlText = readFileSync(projectYml, 'utf8');
  const cfg = parseProjectConfig(ymlText);
  const raw = parse(ymlText);
  const repoIdentity =
    raw != null && typeof raw === 'object' && !Array.isArray(raw) &&
    typeof (raw as Record<string, unknown>).repo_identity === 'string'
      ? (raw as Record<string, unknown>).repo_identity as string
      : undefined;

  const repoUrl =
    process.env.NRDOCS_REPO_URL?.trim() || `https://github.com/local/${cfg.slug}`;

  const body: Record<string, unknown> = {
    slug: cfg.slug,
    repo_url: repoUrl,
    title: cfg.title,
    description: cfg.description,
    access_mode: cfg.access_mode,
  };
  if (repoIdentity) body.repo_identity = repoIdentity;

  console.log(`Registering project: ${cfg.slug}`);
  const { ok, status, data } = await apiJson(apiUrl, apiKey, 'POST', '/projects', body);
  printApiResult(status, data, ok);
  if (!ok) fail('Register failed');

  const id =
    data != null && typeof data === 'object' && !Array.isArray(data) &&
    typeof (data as Record<string, unknown>).id === 'string'
      ? (data as Record<string, unknown>).id
      : '';
  if (id) {
    console.log('');
    console.log(`Project ID: ${id}`);
    console.log('Use it directly:');
    console.log(`  nrdocs admin approve ${id}`);
    console.log('');
    console.log('Or keep it in your private .env for repeated commands:');
    console.log(`  NRDOCS_PROJECT_ID=${id}`);
  }
  return id || undefined;
}

async function cmdList(args: string[] = []): Promise<void> {
  const { apiUrl, apiKey } = requireApiEnv();
  const params = new URLSearchParams();

  const status = flagValue(args, '--status');
  const name = flagValue(args, '--name');
  const slug = flagValue(args, '--slug');
  const title = flagValue(args, '--title');
  const repoIdentity = flagValue(args, '--repo-identity');
  const accessMode = flagValue(args, '--access-mode');
  const json = hasFlag(args, '--json');

  if (hasFlag(args, '--all')) params.set('all', '1');
  if (status) params.set('status', status);
  if (name) params.set('name', name);
  if (slug) params.set('slug', slug);
  if (title) params.set('title', title);
  if (repoIdentity) params.set('repo_identity', repoIdentity);
  if (accessMode) params.set('access_mode', accessMode);

  const query = params.toString();
  const { ok, status: httpStatus, data } = await apiJson(
    apiUrl,
    apiKey,
    'GET',
    `/projects${query ? `?${query}` : ''}`,
  );
  if (!ok) {
    if (httpStatus === 404) {
      fail(
        'List projects is supported by this CLI, but the deployed Control Plane returned 404 for GET /projects.\n' +
          'That usually means the Worker deployed at NRDOCS_API_URL is older than your local CLI.\n\n' +
          'From the nrdocs platform repo, run the deploy script so Workers, migrations, and local .env stay in sync:\n' +
          '  ./scripts/deploy.sh\n\n' +
          'Advanced/manual option if you only need to update the control-plane Worker:\n' +
          '  wrangler deploy --env control-plane\n\n' +
          'Then retry:\n' +
          '  nrdocs admin list',
      );
    }
    printApiResult(httpStatus, data, false);
    fail('List projects failed');
  }

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const projects =
    data != null && typeof data === 'object' && !Array.isArray(data) &&
    Array.isArray((data as Record<string, unknown>).projects)
      ? (data as { projects: Array<Record<string, unknown>> }).projects
      : [];

  if (projects.length === 0) {
    console.log(hasFlag(args, '--all') || status ? 'No projects matched.' : 'No approved projects matched. Use --all to include non-approved projects.');
    return;
  }

  const headers = ['ID', 'SLUG', 'TITLE', 'STATUS', 'ACCESS', 'REPO'];
  const widths = [36, 18, 24, 17, 8, 28];
  console.log(headers.map((h, i) => pad(h, widths[i])).join('  '));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const p of projects) {
    const row = [
      String(p.id ?? ''),
      String(p.slug ?? ''),
      String(p.title ?? ''),
      String(p.status ?? ''),
      String(p.access_mode ?? ''),
      String(p.repo_identity ?? p.repo_url ?? ''),
    ];
    console.log(row.map((v, i) => pad(v, widths[i])).join('  '));
  }
  console.log('');
  console.log(`Showing ${projects.length} project(s). Default is status=approved; use --all or --status <status> to change.`);
}

async function cmdApprove(args: string[] = []): Promise<void> {
  const { apiUrl, apiKey } = requireApiEnv();
  const projectId = requireProjectId(args);
  console.log(`Approving project: ${projectId}`);
  const { ok, status, data } = await apiJson(apiUrl, apiKey, 'POST', `/projects/${projectId}/approve`);
  printApiResult(status, data, ok);
  if (!ok) fail('Approve failed');

  if (hasFlag(args, '--no-mint-publish-token')) {
    return;
  }

  console.log('');
  console.log('Minting repo publish token...');
  await mintPublishToken(apiUrl, apiKey, projectId, args);
}

async function cmdInit(args: string[] = []): Promise<void> {
  const { apiUrl, apiKey } = requireApiEnv();
  const orgSlug = flagValue(args, '--org') ?? 'default';
  const maxRepos = positiveIntegerFlag(args, '--max-repos', 1);
  const expiresInDays = positiveIntegerFlag(args, '--expires-in-days', 7);
  const createdBy = flagValue(args, '--created-by') ?? 'admin_cli';
  const json = hasFlag(args, '--json');

  const body = {
    org_slug: orgSlug,
    max_repos: maxRepos,
    expires_in_days: expiresInDays,
    created_by: createdBy,
  };

  const { ok, status, data } = await apiJson(apiUrl, apiKey, 'POST', '/bootstrap-tokens', body);
  if (!ok) {
    printApiResult(status, data, false);
    fail('Bootstrap token creation failed');
  }

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const token =
    data != null && typeof data === 'object' && !Array.isArray(data) &&
    typeof (data as Record<string, unknown>).bootstrap_token === 'string'
      ? (data as Record<string, unknown>).bootstrap_token
      : '';
  const expiresAt =
    data != null && typeof data === 'object' && !Array.isArray(data)
      ? String((data as Record<string, unknown>).expires_at ?? '')
      : '';

  console.log('Bootstrap token created.');
  console.log(`Organization: ${orgSlug}`);
  console.log(`Max repos: ${maxRepos}`);
  if (expiresAt) console.log(`Expires at: ${expiresAt}`);
  console.log('');
  console.log('Give this token to the repo owner over a secure channel:');
  console.log(token);
  console.log('');
  console.log('Repo owner runs this from the documentation repo:');
  console.log(`  nrdocs init --token '${token}'`);
}

function positiveIntegerFlag(args: string[], name: string, fallback: number): number {
  const raw = flagValue(args, name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    fail(`Invalid ${name}: expected a positive integer.`);
  }
  return parsed;
}

async function cmdProjectInit(args: string[] = []): Promise<void> {
  console.log('=== Registering project ===');
  const registeredProjectId = await cmdRegister();

  const projectId = registeredProjectId ?? process.env.NRDOCS_PROJECT_ID?.trim() ?? '';
  if (!projectId) {
    console.log('');
    console.log('Run approval with the project ID printed above:');
    console.log('  nrdocs admin approve <project-id>');
    return;
  }

  console.log('');
  console.log('=== Approving project ===');
  await cmdApprove([projectId, ...args]);
}

async function cmdPublish(args: string[] = []): Promise<void> {
  const apiUrl = process.env.NRDOCS_API_URL?.trim() ?? '';
  const publishToken = process.env.NRDOCS_PUBLISH_TOKEN?.trim() ?? '';
  const projectId = requireProjectId(args);

  if (!apiUrl) fail('NRDOCS_API_URL is not set. Configure it in .env or the environment.');
  if (!publishToken) {
    fail(
      'NRDOCS_PUBLISH_TOKEN is not set. The publish API accepts only a repo publish JWT (not NRDOCS_API_KEY).\n' +
        '  • Docs repos: use the GitHub secret NRDOCS_PUBLISH_TOKEN (from nrdocs init / your admin).\n' +
        '  • Operator-only projects: run  nrdocs admin mint-publish-token  ' +
        '(then put the JWT in .env as NRDOCS_PUBLISH_TOKEN).',
    );
  }

  const docsPath = docsPathFromEnv();
  if (!existsSync(docsPath)) fail(`Docs directory not found: ${docsPath}`);
  const projectYmlPath = join(docsPath, 'project.yml');
  const navYmlPath = join(docsPath, 'nav.yml');
  const contentDir = join(docsPath, 'content');
  if (!existsSync(projectYmlPath)) fail(`project.yml not found in ${docsPath}`);
  if (!existsSync(navYmlPath)) fail(`nav.yml not found in ${docsPath}`);
  if (!existsSync(contentDir)) fail(`content/ directory not found in ${docsPath}`);

  const projectYml = readFileSync(projectYmlPath, 'utf8');
  const navYml = readFileSync(navYmlPath, 'utf8');
  const allowedPath = join(docsPath, 'allowed-list.yml');
  const allowedListYml = existsSync(allowedPath) ? readFileSync(allowedPath, 'utf8') : null;

  const cfg = parseProjectConfig(projectYml);
  const pages: Record<string, string> = {};
  const mdFiles = walkMdFiles(contentDir);
  for (const abs of mdFiles) {
    const rel = relative(contentDir, abs).replace(/\\/g, '/');
    const key = rel.replace(/\.md$/i, '');
    pages[key] = readFileSync(abs, 'utf8');
  }
  console.log(`Building payload from ${docsPath} ...`);
  console.log(`Found ${mdFiles.length} page(s)`);

  const payload = {
    repo_content: {
      project_yml: projectYml,
      nav_yml: navYml,
      allowed_list_yml: allowedListYml,
      pages,
    },
  };

  const url = `${apiUrl.replace(/\/$/, '')}/projects/${projectId}/publish`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${publishToken}`,
    'Content-Type': 'application/json',
  };
  const repoIdentity = process.env.NRDOCS_REPO_IDENTITY?.trim();
  if (repoIdentity) {
    headers['X-Repo-Identity'] = repoIdentity;
  }

  console.log(`Publishing to ${url} ...`);
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data: unknown = text;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      /* keep raw */
    }
  }
  printApiResult(res.status, data, res.ok);
  if (!res.ok) fail('Publish failed');

  const siteUrl = process.env.NRDOCS_SITE_URL?.trim();
  if (siteUrl) {
    console.log('');
    console.log(`Published to: ${siteUrl.replace(/\/$/, '')}/${cfg.slug}/`);
  }
}

function parseRepoIdentityFlag(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--repo-identity' && args[i + 1]) {
      return args[i + 1];
    }
  }
  return undefined;
}

async function mintPublishToken(
  apiUrl: string,
  apiKey: string,
  projectId: string,
  args: string[],
): Promise<void> {
  const fromFlag = parseRepoIdentityFlag(args);
  const fromEnv = process.env.NRDOCS_REPO_IDENTITY?.trim();
  const ri = (fromFlag ?? fromEnv)?.trim();
  const body: Record<string, string> = ri ? { repo_identity: ri } : {};

  console.log(`Minting repo publish token for project ${projectId} ...`);
  const { ok, status, data } = await apiJson(
    apiUrl,
    apiKey,
    'POST',
    `/projects/${projectId}/publish-token`,
    body,
  );
  printApiResult(status, data, ok);
  if (!ok) fail('Mint publish token failed');

  const token =
    data != null && typeof data === 'object' && !Array.isArray(data) &&
    typeof (data as Record<string, unknown>).repo_publish_token === 'string'
      ? (data as Record<string, unknown>).repo_publish_token
      : '';
  if (token) {
    console.log('');
    console.log('Add to your .env (never commit this value):');
    console.log(`  NRDOCS_PUBLISH_TOKEN=${token}`);
    if (!process.env.NRDOCS_REPO_IDENTITY?.trim() && ri) {
      console.log('Optional (must match publish requests if the token is repo-bound):');
      console.log(`  NRDOCS_REPO_IDENTITY=${ri}`);
    }
  }
}

async function cmdMintPublishToken(args: string[]): Promise<void> {
  const { apiUrl, apiKey } = requireApiEnv();
  const projectId = requireProjectId(args);
  await mintPublishToken(apiUrl, apiKey, projectId, args);
}

async function cmdDisable(args: string[] = []): Promise<void> {
  const { apiUrl, apiKey } = requireApiEnv();
  const projectId = requireProjectId(args);
  console.log(`Disabling project: ${projectId}`);
  const { ok, status, data } = await apiJson(apiUrl, apiKey, 'POST', `/projects/${projectId}/disable`);
  printApiResult(status, data, ok);
  if (!ok) fail('Disable failed');
}

async function cmdDelete(args: string[] = []): Promise<void> {
  const { apiUrl, apiKey } = requireApiEnv();
  const projectId = requireProjectId(args);

  const ok = await confirm(
    `Are you sure you want to delete project ${projectId}? This removes all data.`,
    false,
  );
  if (!ok) {
    console.log('Cancelled.');
    return;
  }

  console.log(`Deleting project: ${projectId}`);
  const result = await apiJson(apiUrl, apiKey, 'DELETE', `/projects/${projectId}`);
  printApiResult(result.status, result.data, result.ok);
  if (!result.ok) fail('Delete failed');
}

async function cmdStatus(args: string[] = []): Promise<void> {
  const { apiUrl, apiKey } = requireApiEnv();
  const projectId = requireProjectId(args);
  console.log(`Fetching project: ${projectId}`);
  const { ok, status, data } = await apiJson(apiUrl, apiKey, 'GET', `/projects/${projectId}`);
  printApiResult(status, data, ok);
  if (!ok) fail('Status failed');
}

async function cmdSetPassword(args: string[] = []): Promise<void> {
  const { apiUrl, apiKey } = requireApiEnv();
  const projectId = requireProjectId(args);

  const password = await readPasswordHidden();
  if (!password) fail('Password cannot be empty');

  console.log('Setting password...');
  const { ok, status, data } = await apiJson(apiUrl, apiKey, 'POST', `/projects/${projectId}/password`, {
    password,
  });
  printApiResult(status, data, ok);
  if (!ok) fail('Set password failed');
}

export function printAdminHelp(): void {
  console.log(`nrdocs admin — Control Plane operator commands (API key + optional publish token)

Usage:
  nrdocs admin <command>

Commands:
  init          Create a bootstrap token for repo-owner onboarding
  project-init  Advanced: register a project, approve it, and mint a publish token from local docs
  register      Register a new project (awaiting_approval)
  list          List projects (approved by default; filters: --all, --status, --name, --slug, --repo-identity)
  approve <id>  Approve a registered project and mint a repo publish token by default
  publish [id]  Build docs from NRDOCS_DOCS_DIR and publish (uses NRDOCS_PUBLISH_TOKEN, not the admin API key)
  mint-publish-token <id>  Mint a repo publish JWT (NRDOCS_API_KEY). Optional --repo-identity or NRDOCS_REPO_IDENTITY
  set-password <id>  Set or update the password for a password-protected project (TTY or NRDOCS_NEW_PASSWORD)
  disable <id>  Disable a project (404 for readers; data preserved)
  delete <id>   Delete a project and associated data
  status <id>   Show project details
  quick-guide   Show the shortest common operator workflows
  help, --help  Show this message

Project ids:
  Pass the project id as a positional argument, e.g. nrdocs admin approve <project-id>.
  For repeated commands, you may still set NRDOCS_PROJECT_ID in a private .env.

Approve options:
  --repo-identity github.com/org/repo   Use this repo identity when minting the publish token
  --no-mint-publish-token              Approve only; do not mint a publish token

Init options:
  --org <slug>                  Organization slug (default: default)
  --max-repos <n>               How many repos this bootstrap token may onboard (default: 1)
  --expires-in-days <n>         Token lifetime in days (default: 7)
  --created-by <label>          Audit label for who/what created the token (default: admin_cli)
  --json                        Print raw JSON response

Security:
  - API-key commands need NRDOCS_API_KEY (operators only; never in author/doc CI).
  - In CI, admin commands are refused unless NRDOCS_ALLOW_ADMIN_IN_CI=1.

Configuration (from environment and the first .env found walking up from the current directory):
  NRDOCS_API_URL           Control Plane Worker URL
  NRDOCS_API_KEY           Admin API key (register, approve, mint-publish-token, disable, delete, status, password)
  NRDOCS_PROJECT_ID        Project UUID (after register)
  NRDOCS_DOCS_DIR          Docs directory relative to cwd (default: docs)
  NRDOCS_PUBLISH_TOKEN     Repo publish JWT for "admin publish"
  NRDOCS_REPO_IDENTITY     Optional X-Repo-Identity header if the token is bound to a repo
  NRDOCS_SITE_URL          Optional; after publish, prints the live docs URL
  NRDOCS_REPO_URL          Optional override for register payload repo_url (default https://github.com/local/<slug>)`);
}

export function printAdminQuickGuide(): void {
  console.log(`nrdocs admin quick guide

Who this is for:
  Platform operators only. Repo owners normally run:
    nrdocs init --token '<bootstrap-token>'
  Then they publish with git push.

Operator setup:
  export NRDOCS_API_URL='https://<control-plane-worker>'
  export NRDOCS_API_KEY='<operator-api-key>'
  # Or keep these in a private, uncommitted .env in an operator workspace.

Most common operator commands:
  nrdocs admin init --org default
    Create a bootstrap token for repo-owner onboarding.

  nrdocs admin list
    List approved projects.

  nrdocs admin list --all
    List all projects, including awaiting_approval and disabled.

  nrdocs admin list --status awaiting_approval
    Find projects waiting for approval.

  nrdocs admin status <project-id>
    Show a project.

  nrdocs admin approve <project-id> --repo-identity github.com/org/repo
    Approve a registered project and print NRDOCS_PUBLISH_TOKEN.

  nrdocs admin disable <project-id>
    Take a project offline for readers; data is preserved.

  nrdocs admin set-password <project-id>
    Set/update the password for a password-protected project.

Recommended onboarding flow:
  1. Operator runs: nrdocs admin init --org default
  2. Repo owner runs: nrdocs init --token '<bootstrap-token>'
  3. Repo owner pushes to the configured publish branch.

Manual/operator-managed project flow:
  # Run from a docs repo root, or set NRDOCS_DOCS_DIR=/path/to/docs
  nrdocs admin register
  nrdocs admin approve <project-id> --repo-identity github.com/org/repo
  # Put printed NRDOCS_PUBLISH_TOKEN in private .env, then:
  nrdocs admin publish <project-id>

Safety:
  - Never commit .env.
  - Never put NRDOCS_API_KEY in docs-repo GitHub Actions.
  - nrdocs admin publish uses NRDOCS_PUBLISH_TOKEN, not NRDOCS_API_KEY.

More detail:
  nrdocs admin --help`);
}

/**
 * Operator CLI: privileged Control Plane actions.
 * Loads `.env` from cwd or a parent directory before reading configuration.
 */
export async function runAdmin(args: string[]): Promise<void> {
  const sub = args[0];
  if (
    args.length === 0 ||
    sub === 'help' ||
    sub === '-h' ||
    sub === '--help'
  ) {
    printAdminHelp();
    return;
  }
  if (sub === 'quick-guide' || sub === 'quick' || sub === 'bro') {
    printAdminQuickGuide();
    return;
  }

  loadDotEnvFromAncestors(process.cwd());
  assertNotCiUnlessAllowed();

  switch (sub) {
    case 'init':
      await cmdInit(args.slice(1));
      return;
    case 'project-init':
      await cmdProjectInit(args.slice(1));
      return;
    case 'register':
      await cmdRegister();
      return;
    case 'list':
    case 'ls':
      await cmdList(args.slice(1));
      return;
    case 'approve':
      await cmdApprove(args.slice(1));
      return;
    case 'publish':
      await cmdPublish(args.slice(1));
      return;
    case 'mint-publish-token':
      await cmdMintPublishToken(args.slice(1));
      return;
    case 'set-password':
      await cmdSetPassword(args.slice(1));
      return;
    case 'disable':
      await cmdDisable(args.slice(1));
      return;
    case 'delete':
      await cmdDelete(args.slice(1));
      return;
    case 'status':
      await cmdStatus(args.slice(1));
      return;
    default:
      fail(`Unknown admin command '${sub}'. Run nrdocs admin --help for usage.`);
  }
}
