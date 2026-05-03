import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { CliUsageError } from '../cli-usage-error';
import { parseProjectConfig } from '../config-parser';
import { confirm } from '../prompts';
import { inferRepoIdentity } from './init';
import { getRepoStatus } from '../api-client';
import { decodeRepoContentAssets } from '../../../src/publish/asset-ingest.js';
import { PUBLISH_ASSET_EXTENSIONS, extensionFromPath } from '../../../src/media/mime.js';

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
        'If you are a docs repo owner trying to publish, you should not be running admin commands. Ask your platform operator to register/approve your project, then run:\n' +
        '  nrdocs init\n',
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

function repoIdFromArgs(args: string[]): string | undefined {
  const flagsWithValues = new Set(['--repo-id', '--project-id', '-p', '--repo-identity']);
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--repo-id' || args[i] === '--project-id' || args[i] === '-p') && args[i + 1]) {
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

/** Reader site URL for `admin list`: API `url`, else `delivery_url`+slug, else env + slug. */
function listDocsUrlCell(p: Record<string, unknown>): string {
  if (typeof p.url === 'string' && p.url.trim()) {
    return p.url.trim();
  }
  const fromApi =
    typeof p.delivery_url === 'string' && p.delivery_url.trim()
      ? p.delivery_url.trim().replace(/\/$/, '')
      : '';
  const base = fromApi || process.env.NRDOCS_DELIVERY_URL?.trim().replace(/\/$/, '') || '';
  const slug = typeof p.slug === 'string' ? p.slug.trim() : '';
  if (base && slug) {
    return `${base}/${slug}/`;
  }
  return '(no DELIVERY_URL — redeploy control plane with DELIVERY_URL set)';
}

/** Fixed-width cell without ellipsis so full https URLs stay readable in `admin list`. */
function padFull(value: string, minWidth: number): string {
  const w = Math.max(minWidth, value.length);
  return value.padEnd(w, ' ');
}

function requireRepoId(args: string[] = []): string {
  const id = repoIdFromArgs(args)?.trim() || process.env.NRDOCS_REPO_ID?.trim() || '';
  if (!id) {
    fail(
      'Missing repo id. Pass it as an argument (for example: nrdocs admin approve <repo-id>) or set NRDOCS_REPO_ID.',
    );
  }
  return id;
}

function docsPathFromEnv(): string {
  const rel = process.env.NRDOCS_DOCS_DIR?.trim() || 'docs';
  return resolve(process.cwd(), rel);
}

function resolveGitDir(): string | null {
  const dotGit = resolve(process.cwd(), '.git');
  if (!existsSync(dotGit)) return null;
  try {
    const st = statSync(dotGit);
    if (st.isDirectory()) return dotGit;
  } catch {
    // fall through
  }

  // Worktrees / submodules can represent .git as a file: "gitdir: <path>"
  try {
    const text = readFileSync(dotGit, 'utf8').trim();
    const prefix = 'gitdir:';
    if (!text.toLowerCase().startsWith(prefix)) return null;
    const gitdirRaw = text.slice(prefix.length).trim();
    const gitdir = resolve(process.cwd(), gitdirRaw);
    return existsSync(gitdir) ? gitdir : null;
  } catch {
    return null;
  }
}

function detectOriginRemoteUrlFromGitConfig(): string | undefined {
  const gitDir = resolveGitDir();
  if (!gitDir) return undefined;
  const cfgPath = join(gitDir, 'config');
  if (!existsSync(cfgPath)) return undefined;
  const text = readFileSync(cfgPath, 'utf8');

  let inOrigin = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const section = line.match(/^\[(.+)]$/);
    if (section) {
      const name = section[1].trim();
      inOrigin = /^remote\s+"origin"$/i.test(name);
      continue;
    }
    if (!inOrigin) continue;
    const m = line.match(/^url\s*=\s*(.+)$/i);
    if (m) return m[1].trim();
  }
  return undefined;
}

function detectOriginRemoteUrl(): string | undefined {
  // Prefer direct config parsing (works even when git is not installed).
  const fromConfig = detectOriginRemoteUrlFromGitConfig();
  if (fromConfig) return fromConfig;

  // Fallback to git (handles unusual config layouts / includes).
  try {
    const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 5000,
    });
    if (result.status !== 0) return undefined;
    const url = (result.stdout ?? '').trim();
    return url || undefined;
  } catch {
    return undefined;
  }
}

function inferGitHubRepoUrlFromRemote(remoteUrl: string): string | undefined {
  const identity = inferRepoIdentity(remoteUrl);
  if (!identity) return undefined;
  return `https://${identity}`;
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

function walkBinaryAssetFiles(contentDir: string): string[] {
  const out: string[] = [];
  function walk(d: string): void {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && !name.endsWith('.md')) {
        const rel = relative(contentDir, p).replace(/\\/g, '/');
        const ext = extensionFromPath(rel);
        if (PUBLISH_ASSET_EXTENSIONS.has(ext)) out.push(p);
      }
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
    stdout.write('Enter password for site: ');
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

async function cmdRegister(args: string[] = []): Promise<string | undefined> {
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

  const flagRepoIdentity = flagValue(args, '--repo-identity')?.trim();
  const flagRepoUrl = flagValue(args, '--repo-url')?.trim();

  const inferredRemote = detectOriginRemoteUrl();
  const inferredRepoIdentity = inferredRemote ? inferRepoIdentity(inferredRemote) : undefined;
  const inferredRepoUrl = inferredRemote ? inferGitHubRepoUrlFromRemote(inferredRemote) : undefined;

  const resolvedRepoIdentity = flagRepoIdentity || repoIdentity || inferredRepoIdentity;
  if (!resolvedRepoIdentity) {
    fail(
      'Cannot register project: repo_identity could not be resolved.\n\n' +
        'Repo identity is required for OIDC-based publishing (Control Plane maps GitHub Actions repository → project).\n\n' +
        'Fix options:\n' +
        `- pass: nrdocs admin register --repo-identity github.com/<owner>/<repo>\n` +
        `- set repo_identity in ${projectYml}\n` +
        '- ensure this is a git repo and origin remote points at GitHub\n',
    );
  }

  const repoUrl =
    flagRepoUrl
    || process.env.NRDOCS_REPO_URL?.trim()
    || inferredRepoUrl
    || `https://github.com/local/${cfg.slug}`;

  const body: Record<string, unknown> = {
    slug: cfg.slug,
    repo_url: repoUrl,
    title: cfg.title,
    description: cfg.description,
    access_mode: cfg.access_mode,
  };
  body.repo_identity = resolvedRepoIdentity;

  console.log(`Registering docs site: ${cfg.slug}`);
  const { ok, status, data } = await apiJson(apiUrl, apiKey, 'POST', '/repos', body);
  printApiResult(status, data, ok);
  if (!ok) fail('Register failed');

  const id =
    data != null && typeof data === 'object' && !Array.isArray(data) &&
    typeof (data as Record<string, unknown>).id === 'string'
      ? (data as Record<string, unknown>).id
      : '';
  if (id) {
    console.log('');
    console.log(`Repo ID: ${id}`);
    console.log('Use it directly:');
    console.log(`  nrdocs admin approve ${id}`);
    console.log('');
    console.log('Or keep it in your private .env for repeated commands:');
    console.log(`  NRDOCS_REPO_ID=${id}`);
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
    `/repos${query ? `?${query}` : ''}`,
  );
  if (!ok) {
    if (httpStatus === 404) {
      fail(
        'List repos is supported by this CLI, but the deployed Control Plane returned 404 for GET /repos.\n' +
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
    fail('List repos failed');
  }

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const repos =
    data != null && typeof data === 'object' && !Array.isArray(data) &&
    Array.isArray((data as Record<string, unknown>).repos)
      ? (data as { repos: Array<Record<string, unknown>> }).repos
      : [];

  if (repos.length === 0) {
    console.log(hasFlag(args, '--all') || status ? 'No repos matched.' : 'No approved repos matched. Use --all to include non-approved repos.');
    return;
  }

  const docCells = repos.map((p) => listDocsUrlCell(p));
  const readerMin = 'READER_URL'.length;
  const readerW = Math.min(96, Math.max(readerMin, ...docCells.map((s) => s.length)));

  const headers = ['ID', 'SLUG', 'TITLE', 'STATUS', 'ACCESS', 'IDENTITY', 'READER_URL', 'REPO_URL'];
  const widths = [36, 16, 20, 16, 8, 30, readerW, 22];
  console.log(
    [
      pad(headers[0], widths[0]),
      pad(headers[1], widths[1]),
      pad(headers[2], widths[2]),
      pad(headers[3], widths[3]),
      pad(headers[4], widths[4]),
      pad(headers[5], widths[5]),
      padFull(headers[6], widths[6]),
      pad(headers[7], widths[7]),
    ].join('  '),
  );
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  let anyMissingIdentity = false;
  let anyMissingReaderUrl = false;
  for (let i = 0; i < repos.length; i++) {
    const p = repos[i];
    const identity = typeof p.repo_identity === 'string' && p.repo_identity.trim() ? p.repo_identity : '';
    if (!identity) anyMissingIdentity = true;
    const docsUrl = docCells[i];
    if (docsUrl.startsWith('(no DELIVERY')) anyMissingReaderUrl = true;
    const row = [
      String(p.id ?? ''),
      String(p.slug ?? ''),
      String(p.title ?? ''),
      String(p.status ?? ''),
      String(p.access_mode ?? ''),
      identity || '(none)',
      docsUrl,
      String(p.repo_url ?? ''),
    ];
    console.log(
      [
        pad(row[0], widths[0]),
        pad(row[1], widths[1]),
        pad(row[2], widths[2]),
        pad(row[3], widths[3]),
        pad(row[4], widths[4]),
        pad(row[5], widths[5]),
        padFull(row[6], widths[6]),
        pad(row[7], widths[7]),
      ].join('  '),
    );
  }
  console.log('');
  if (anyMissingReaderUrl) {
    console.log(
      'READER_URL needs DELIVERY_URL on the control-plane Worker (wrangler.toml [env.control-plane.vars]); redeploy the worker.\n' +
        'Or set NRDOCS_DELIVERY_URL in your operator .env so this CLI can derive URLs when the API omits them.\n',
    );
  }
  if (anyMissingIdentity) {
    console.log(
      'Note: blank IDENTITY means repo_identity is not set — OIDC publish will fail until an operator runs\n' +
        '  nrdocs admin mint-publish-token <id> --repo-identity github.com/<owner>/<repo>\n' +
        '  (or re-register the repo with repo_identity on a control plane that supports binding on mint).',
    );
    console.log('');
  }
  console.log(`Showing ${repos.length} repo(s). Default is status=approved; use --all or --status <status> to change.`);
}

async function cmdApprove(args: string[] = []): Promise<void> {
  const { apiUrl, apiKey } = requireApiEnv();
  const projectId = requireRepoId(args);
  const mintPublish = hasFlag(args, '--mint-publish-token');

  let resolvedRepoIdentity: string | undefined;
  if (mintPublish) {
    const fromFlag = parseRepoIdentityFlag(args)?.trim();
    const fromEnv = process.env.NRDOCS_REPO_IDENTITY?.trim();
    resolvedRepoIdentity = fromFlag || fromEnv;

    if (!resolvedRepoIdentity) {
      const { ok, data } = await apiJson(apiUrl, apiKey, 'GET', `/repos/${projectId}`);
      if (ok && data != null && typeof data === 'object' && !Array.isArray(data)) {
        const ri = (data as Record<string, unknown>).repo_identity;
        if (typeof ri === 'string' && ri.trim()) resolvedRepoIdentity = ri.trim();
      }
    }

    if (!resolvedRepoIdentity) {
      const inferredRemote = detectOriginRemoteUrl();
      const inferred = inferredRemote ? inferRepoIdentity(inferredRemote) : undefined;
      if (inferred) resolvedRepoIdentity = inferred;
    }

    if (!resolvedRepoIdentity) {
      fail(
        '[preflight] Missing repo identity for token mint.\n\n' +
          'Pass --mint-publish-token only when you need a repo publish JWT (manual `admin publish`, backfill).\n' +
          'Token mint requires a repo identity (github.com/<owner>/<repo>).\n\n' +
          'Fix options:\n' +
          `- pass: nrdocs admin approve ${projectId} --mint-publish-token --repo-identity github.com/<owner>/<repo>\n` +
          '- set NRDOCS_REPO_IDENTITY in your operator environment\n' +
          '- set repo_identity on the project during register\n' +
          `- or approve without minting (default): nrdocs admin approve ${projectId}\n`,
      );
    }
  }

  console.log(`[approve] Approving repo: ${projectId}`);
  const { ok, status, data } = await apiJson(apiUrl, apiKey, 'POST', `/repos/${projectId}/approve`);
  printApiResult(status, data, ok);
  if (!ok) fail('Approve failed');

  if (!mintPublish) {
    console.log('');
    console.log('Approved on the Control Plane.');
    console.log('');
    console.log('--- Tell the repository owner (approval does not publish by itself) ---');
    console.log(
      'Docs will not change until GitHub Actions runs again with OIDC. They should do one of:',
    );
    console.log('  • GitHub: Actions → publish workflow → Run workflow (pick their publish branch), or');
    console.log(
      '  • Locally on that branch: git commit --allow-empty -m "chore: trigger publish" && git push origin <publish-branch>',
    );
    console.log('    (<publish-branch> is the branch listed under on.push.branches in .github/workflows/publish-docs.yml.)');
    console.log('');
    console.log(`Optional — link local status: nrdocs init --repo-id ${projectId}`);
    return;
  }

  console.log('');
  console.log('[mint-token] Minting repo publish token...');
  try {
    await mintPublishToken(apiUrl, apiKey, projectId, args, resolvedRepoIdentity);
  } catch (err: unknown) {
    console.error('');
    console.error('[mint-token] Token mint failed after approval.');
    console.error(`[mint-token] Repo is approved: ${projectId}`);
    console.error('[mint-token] Retry with:');
    console.error(`  nrdocs admin mint-publish-token ${projectId} --repo-identity ${resolvedRepoIdentity}`);
    throw err;
  }

  console.log('');
  console.log('--- Publish token (manual `nrdocs admin publish` / legacy CI only) ---');
  console.log('OIDC repos do not need NRDOCS_PUBLISH_TOKEN in GitHub.');
  console.log(`Optional — link local status: nrdocs init --repo-id ${projectId}`);
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
  const registeredProjectId = await cmdRegister(args);

  const projectId = registeredProjectId ?? process.env.NRDOCS_REPO_ID?.trim() ?? '';
  if (!projectId) {
    console.log('');
    console.log('Run approval with the repo ID printed above:');
    console.log('  nrdocs admin approve <repo-id>');
    return;
  }

  console.log('');
  console.log('=== Approving project ===');
  await cmdApprove([projectId, ...args]);
}

async function cmdPublish(args: string[] = []): Promise<void> {
  const apiUrl = process.env.NRDOCS_API_URL?.trim() ?? '';
  const publishToken = process.env.NRDOCS_PUBLISH_TOKEN?.trim() ?? '';
  const projectId = requireRepoId(args);

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

  const assetFiles = walkBinaryAssetFiles(contentDir);
  const assets: Record<string, string> = {};
  for (const abs of assetFiles) {
    const rel = relative(contentDir, abs).replace(/\\/g, '/');
    assets[rel] = readFileSync(abs).toString('base64');
  }
  const assetCheck = decodeRepoContentAssets(assets);
  if (!assetCheck.ok) {
    fail(assetCheck.error);
  }

  console.log(`Building payload from ${docsPath} ...`);
  console.log(`Found ${mdFiles.length} page(s)`);
  if (assetFiles.length > 0) {
    const approxDecoded = Math.floor(
      Object.values(assets).reduce((s, b64) => s + (b64.length * 3) / 4, 0),
    );
    console.log(`Found ${assetFiles.length} binary asset(s) (~${approxDecoded} bytes decoded, approximate)`);
  }

  const payload = {
    repo_content: {
      project_yml: projectYml,
      nav_yml: navYml,
      allowed_list_yml: allowedListYml,
      pages,
      assets,
    },
  };

  const url = `${apiUrl.replace(/\/$/, '')}/repos/${projectId}/publish`;
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
  repoIdentityOverride?: string,
): Promise<void> {
  const fromFlag = parseRepoIdentityFlag(args);
  const fromEnv = process.env.NRDOCS_REPO_IDENTITY?.trim();
  const ri = (repoIdentityOverride ?? fromFlag ?? fromEnv)?.trim();
  const body: Record<string, string> = ri ? { repo_identity: ri } : {};

  console.log(`Minting repo publish token for repo ${projectId} ...`);
  const { ok, status, data } = await apiJson(
    apiUrl,
    apiKey,
    'POST',
    `/repos/${projectId}/publish-token`,
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
  const projectId = requireRepoId(args);
  await mintPublishToken(apiUrl, apiKey, projectId, args);
}

async function cmdDisable(args: string[] = []): Promise<void> {
  const { apiUrl, apiKey } = requireApiEnv();
  const projectId = requireRepoId(args);
  console.log(`Disabling project: ${projectId}`);
  const { ok, status, data } = await apiJson(apiUrl, apiKey, 'POST', `/repos/${projectId}/disable`);
  printApiResult(status, data, ok);
  if (!ok) fail('Disable failed');
}

async function cmdDelete(args: string[] = []): Promise<void> {
  const { apiUrl, apiKey } = requireApiEnv();
  const projectId = requireRepoId(args);

  const ok = await confirm(
    `Are you sure you want to delete project ${projectId}? This removes all data.`,
    false,
  );
  if (!ok) {
    console.log('Cancelled.');
    return;
  }

  console.log(`Deleting project: ${projectId}`);
  const result = await apiJson(apiUrl, apiKey, 'DELETE', `/repos/${projectId}`);
  printApiResult(result.status, result.data, result.ok);
  if (!result.ok) fail('Delete failed');
}

async function cmdStatus(args: string[] = []): Promise<void> {
  const { apiUrl, apiKey } = requireApiEnv();
  const projectId = requireRepoId(args);
  console.log(`Fetching project: ${projectId}`);
  const { ok, status, data } = await apiJson(apiUrl, apiKey, 'GET', `/repos/${projectId}`);
  printApiResult(status, data, ok);
  if (!ok) fail('Status failed');
}

async function cmdSetPassword(args: string[] = []): Promise<void> {
  const { apiUrl, apiKey } = requireApiEnv();
  const projectId = requireRepoId(args);

  const password = await readPasswordHidden();
  if (!password) fail('Password cannot be empty');

  console.log('Setting password...');
  const { ok, status, data } = await apiJson(apiUrl, apiKey, 'POST', `/repos/${projectId}/password`, {
    password,
  });
  printApiResult(status, data, ok);
  if (!ok) fail('Set password failed');

  try {
    const st = await getRepoStatus(apiUrl.replace(/\/$/, ''), projectId);
    const reader = listDocsUrlCell({
      url: st.url,
      delivery_url: st.delivery_url,
      slug: st.slug,
    } as Record<string, unknown>);
    console.log('');
    if (reader.startsWith('(no DELIVERY')) {
      console.log(
        `Password is stored for slug "${st.slug}". Open your delivery host at /${st.slug}/ and log in with this password.`,
      );
      console.log(
        'Tip: set NRDOCS_DELIVERY_URL (or redeploy control plane with DELIVERY_URL) so this command can print the full reader URL.',
      );
    } else {
      console.log('Log in at the reader site (use the password you just set):');
      console.log(`  ${reader}`);
    }
    console.log(
      `If login still fails, confirm NRDOCS_API_URL matches the control plane that shares D1 with the delivery worker (see wrangler.toml database_id for both envs).`,
    );
  } catch {
    // Optional follow-up fetch failed; password was still updated.
  }
}

export function printAdminHelp(): void {
  console.log(`nrdocs admin — Control Plane operator commands (API key + optional publish token)

Usage:
  nrdocs admin <command>

Commands:
  project-init  Advanced: register from local docs, then approve (add --mint-publish-token on approve if you need a JWT)
  register      Register a new docs site (awaiting_approval)
  list          List registered repos (approved by default; filters: --all, --status, --name, --slug, --repo-identity)
  approve <id>  Approve a registered repo (OIDC CI needs no token; use --mint-publish-token for manual publish JWT)
  publish [id]  Build docs from NRDOCS_DOCS_DIR and publish (uses NRDOCS_PUBLISH_TOKEN, not the admin API key)
  mint-publish-token <id>  Mint a repo publish JWT (NRDOCS_API_KEY). Optional --repo-identity or NRDOCS_REPO_IDENTITY
  set-password <id>  Set or update the password for a password-protected site (TTY or NRDOCS_NEW_PASSWORD)
  disable <id>  Disable a site (404 for readers; data preserved)
  delete <id>   Delete a registered repo and associated data
  status <id>   Show repo details
  quick-guide   Show the shortest common operator workflows
  help, --help  Show this message

Repo ids:
  Pass the repo id (UUID) as a positional argument, e.g. nrdocs admin approve <repo-id>.
  For repeated commands, set NRDOCS_REPO_ID in a private .env.

Approve options:
  --mint-publish-token                 Also mint a repo publish JWT (for nrdocs admin publish / legacy CI)
  --repo-identity github.com/org/repo   Repo identity when minting (or set NRDOCS_REPO_IDENTITY)

Register options:
  --repo-identity github.com/org/repo   Override / force repo identity for OIDC mapping
  --repo-url https://github.com/org/repo  Override repo_url sent to the server

Security:
  - API-key commands need NRDOCS_API_KEY (operators only; never in author/doc CI).
  - In CI, admin commands are refused unless NRDOCS_ALLOW_ADMIN_IN_CI=1.

Configuration (from environment and the first .env found walking up from the current directory):
  NRDOCS_API_URL           Control Plane Worker URL
  NRDOCS_API_KEY           Admin API key (register, approve, mint-publish-token, disable, delete, status, password)
  NRDOCS_REPO_ID           Repo UUID (after register)
  NRDOCS_DOCS_DIR          Docs directory relative to cwd (default: docs)
  NRDOCS_PUBLISH_TOKEN     Repo publish JWT for "admin publish"
  NRDOCS_REPO_IDENTITY     Optional X-Repo-Identity header if the token is bound to a repo
  NRDOCS_SITE_URL          Optional; after publish, prints the live docs URL
  NRDOCS_REPO_URL          Optional override for register payload repo_url (default inferred from git origin; fallback https://github.com/local/<slug>)
  NRDOCS_DELIVERY_URL      Optional; public Delivery Worker origin — helps admin list show READER_URL if the API omits it
  NRDOCS_NEW_PASSWORD      For admin set-password without a TTY (same as interactive prompt)

Reader password (access_mode=password):
  Operator (API key):     nrdocs admin set-password <repo-id>
                          Uses NRDOCS_API_KEY; prompts on TTY or reads NRDOCS_NEW_PASSWORD.
  Docs repo owner (no admin key):  nrdocs password set
                          Repo-proof challenge in git + GitHub OIDC; run from the cloned docs repo.`);
}

export function printAdminQuickGuide(): void {
  console.log(`nrdocs admin quick guide

Who this is for:
  Platform operators only.

Operator setup:
  export NRDOCS_API_URL='https://<control-plane-worker>'
  export NRDOCS_API_KEY='<operator-api-key>'
  # Or keep these in a private, uncommitted .env in an operator workspace.

Most common operator commands:
  nrdocs admin list
    List approved repos.

  nrdocs admin list --all
    List all repos, including awaiting_approval and disabled.

  nrdocs admin list --status awaiting_approval
    Find repos waiting for approval.

  nrdocs admin status <repo-id>
    Show a registered repo.

  nrdocs admin approve <repo-id>
    Approve a registered repo (OIDC CI does not need a publish token).

  nrdocs admin approve <repo-id> --mint-publish-token --repo-identity github.com/org/repo
    Same, but also mint NRDOCS_PUBLISH_TOKEN for manual admin publish.

  nrdocs admin disable <repo-id>
    Take a site offline for readers; data is preserved.

  nrdocs admin set-password <repo-id>
    Set/update the password for a password-protected site (operator; TTY or NRDOCS_NEW_PASSWORD).
    Docs repo owners use: nrdocs password set (no admin key — repo-proof flow in the docs repo).

Manual/operator-managed flow:
  # Run from a docs repo root, or set NRDOCS_DOCS_DIR=/path/to/docs
  nrdocs admin register
  nrdocs admin approve <repo-id>
  # For break-glass manual publish only:
  # nrdocs admin approve <repo-id> --mint-publish-token --repo-identity github.com/org/repo
  # nrdocs admin publish <repo-id>

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
    case 'project-init':
      await cmdProjectInit(args.slice(1));
      return;
    case 'register':
      await cmdRegister(args.slice(1));
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
    case 'init':
      fail(
        "Use the operator flow to register and approve, then:\n\n" +
          "  nrdocs admin register\n" +
          "  nrdocs admin approve <repo-id>\n\n" +
          "Repo owners run nrdocs init (control plane URL only), commit, push — or optionally:\n" +
          "  nrdocs init --repo-id <uuid>\n",
      );
    default:
      fail(`Unknown admin command '${sub}'. Run nrdocs admin --help for usage.`);
  }
}
