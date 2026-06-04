import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveCredentials } from '../config/index.js';
import { ApiClient } from '../api-client.js';
import { getOIDCToken } from '../github-oidc.js';
import { scanDocsForUnlistedAssets } from '../renderer/assets.js';
import {
  normalizeApiBaseUrl,
  parseApiUrlFromConfig,
  parseApiUrlFromWorkflow,
  probeApiStatus,
} from '../errors.js';

export interface DoctorOptions {
  json?: boolean;
  ci?: boolean;
}

export interface DoctorCheck {
  section: string;
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
  fixes?: string[];
}

/**
 * Parses doctor flags from args.
 */
export function parseDoctorArgs(args: string[]): DoctorOptions {
  const opts: DoctorOptions = {};
  for (const arg of args) {
    if (arg === '--json') opts.json = true;
    if (arg === '--ci') opts.ci = true;
  }
  return opts;
}

function countMarkdownFiles(docsDir: string): number {
  if (!fs.existsSync(docsDir)) return 0;
  let count = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) count++;
    }
  };
  walk(docsDir);
  return count;
}

/**
 * Handles the `nrdocs doctor` command.
 */
export async function handleDoctor(args: string[]): Promise<void> {
  const opts = parseDoctorArgs(args);
  const inCI = opts.ci || process.env['GITHUB_ACTIONS'] === 'true';
  const checks: DoctorCheck[] = [];

  const isGitRepo = fs.existsSync(path.resolve('.git'));
  checks.push({
    section: 'Repo setup',
    name: 'Git repository',
    status: isGitRepo ? 'ok' : 'fail',
    message: isGitRepo ? 'Found .git directory' : 'Not a git repository',
  });

  const configPath = path.resolve('docs', 'nrdocs.yml');
  const hasConfig = fs.existsSync(configPath);
  checks.push({
    section: 'Repo setup',
    name: 'Docs config',
    status: hasConfig ? 'ok' : 'fail',
    message: hasConfig ? 'Found docs/nrdocs.yml' : 'Missing docs/nrdocs.yml — run: nrdocs init',
  });

  const docsDir = path.resolve('docs');
  const mdCount = countMarkdownFiles(docsDir);
  checks.push({
    section: 'Repo setup',
    name: 'Docs sources',
    status: mdCount > 0 ? 'ok' : 'warn',
    message:
      mdCount > 0
        ? `${mdCount} markdown file(s) in docs/`
        : 'No .md files in docs/ — publish will produce an empty site',
  });

  const workflowPath = path.resolve('.github', 'workflows', 'nrdocs.yml');
  const hasWorkflow = fs.existsSync(workflowPath);
  checks.push({
    section: 'Repo setup',
    name: 'GitHub workflow',
    status: hasWorkflow ? 'ok' : 'warn',
    message: hasWorkflow
      ? 'Found .github/workflows/nrdocs.yml'
      : 'Missing .github/workflows/nrdocs.yml — run: nrdocs init',
  });

  let configApiUrl: string | undefined;
  let workflowApiUrl: string | undefined;

  if (hasConfig) {
    const content = fs.readFileSync(configPath, 'utf-8');
    configApiUrl = parseApiUrlFromConfig(content);
    checks.push({
      section: 'Publish URL',
      name: 'docs/nrdocs.yml api_url',
      status: configApiUrl ? 'ok' : 'warn',
      message: configApiUrl ?? 'Not set — CI uses NRDOCS_API_URL from workflow env only',
    });
  }

  if (hasWorkflow) {
    const wfContent = fs.readFileSync(workflowPath, 'utf-8');
    workflowApiUrl = parseApiUrlFromWorkflow(wfContent);
    checks.push({
      section: 'Publish URL',
      name: 'Workflow NRDOCS_API_URL',
      status: workflowApiUrl ? 'ok' : 'fail',
      message: workflowApiUrl ?? 'Missing NRDOCS_API_URL in workflow',
      fixes: workflowApiUrl ? undefined : ['Re-run nrdocs init --api-url https://your-docs-url.com'],
    });
  }

  const publishBaseUrl = workflowApiUrl ?? configApiUrl ?? process.env['NRDOCS_API_URL'];
  if (publishBaseUrl && configApiUrl && workflowApiUrl) {
    const a = normalizeApiBaseUrl(configApiUrl).url;
    const b = normalizeApiBaseUrl(workflowApiUrl).url;
    checks.push({
      section: 'Publish URL',
      name: 'URL consistency',
      status: a === b ? 'ok' : 'warn',
      message: a === b ? 'docs/nrdocs.yml and workflow env match' : `Mismatch: yml=${a}, workflow=${b}`,
      fixes:
        a === b
          ? undefined
          : ['Use the same base URL in docs/nrdocs.yml and NRDOCS_API_URL in the workflow'],
    });
  }

  if (publishBaseUrl) {
    const { url } = normalizeApiBaseUrl(publishBaseUrl);
    const probe = await probeApiStatus(url);
    checks.push({
      section: 'API reachability',
      name: 'GET /api/status',
      status: probe.ok ? 'ok' : 'fail',
      message: probe.ok ? probe.message : probe.message,
      fixes: probe.ok
        ? undefined
        : [
            `Verify the host is reachable: curl -fsS ${url}/api/status`,
            'Confirm the operator has deployed the Worker (nrdocs deploy).',
            'GitHub Actions uses this URL for publish — it must be public on the internet.',
          ],
    });
  } else {
    checks.push({
      section: 'Publish URL',
      name: 'Publish API URL',
      status: 'fail',
      message: 'No publish URL configured',
      fixes: [
        'Run nrdocs init --api-url https://your-docs-url.com',
        'Or set NRDOCS_API_URL in .github/workflows/nrdocs.yml',
      ],
    });
  }

  if (inCI) {
    const hasOidcUrl = !!process.env['ACTIONS_ID_TOKEN_REQUEST_URL'];
    const hasOidcToken = !!process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
    checks.push({
      section: 'GitHub Actions',
      name: 'OIDC request URL',
      status: hasOidcUrl ? 'ok' : 'fail',
      message: hasOidcUrl ? 'Present' : 'Missing ACTIONS_ID_TOKEN_REQUEST_URL',
      fixes: hasOidcUrl ? undefined : ['Add permissions.id-token: write to the workflow'],
    });
    checks.push({
      section: 'GitHub Actions',
      name: 'OIDC request token',
      status: hasOidcToken ? 'ok' : 'fail',
      message: hasOidcToken ? 'Present' : 'Missing ACTIONS_ID_TOKEN_REQUEST_TOKEN',
      fixes: hasOidcToken ? undefined : ['Add permissions.id-token: write to the workflow'],
    });
    const ghRepo = process.env['GITHUB_REPOSITORY'];
    checks.push({
      section: 'GitHub Actions',
      name: 'GITHUB_REPOSITORY',
      status: ghRepo ? 'ok' : 'fail',
      message: ghRepo ?? 'Not set',
    });

    if (fs.existsSync(docsDir)) {
      const unlisted = scanDocsForUnlistedAssets(docsDir);
      if (unlisted.length === 0) {
        checks.push({
          section: 'Publish assets',
          name: 'Non-whitelisted files',
          status: 'ok',
          message: 'No files in docs/ require operator consent for unlisted extensions',
        });
      } else {
        let allowed = false;
        let capMessage = 'Could not verify publish capabilities (OIDC or API URL missing)';
        if (publishBaseUrl && ghRepo && hasOidcUrl && hasOidcToken) {
          const { url } = normalizeApiBaseUrl(publishBaseUrl);
          const token = await getOIDCToken();
          if (token) {
            const client = new ApiClient(url, token);
            const capsRes = await client.getPublishCapabilities();
            if (capsRes.ok) {
              const caps = capsRes.data as { allow_unlisted_assets?: boolean } | undefined;
              allowed = caps?.allow_unlisted_assets === true;
              capMessage = allowed
                ? 'Matching auto-approval rule allows unlisted asset files'
                : 'Publish rule does not allow unlisted asset files';
            } else {
              capMessage = capsRes.error?.message ?? 'publish-capabilities request failed';
            }
          } else {
            capMessage = 'Failed to obtain OIDC token for capabilities check';
          }
        }
        const sample = unlisted.slice(0, 5).join(', ');
        const more = unlisted.length > 5 ? ` (+${unlisted.length - 5} more)` : '';
        checks.push({
          section: 'Publish assets',
          name: 'Non-whitelisted files',
          status: allowed ? 'ok' : 'fail',
          message: allowed
            ? `${unlisted.length} unlisted file(s) allowed by rule: ${sample}${more}`
            : `${unlisted.length} unlisted file(s) in docs/: ${sample}${more}. ${capMessage}`,
          fixes: allowed
            ? undefined
            : [
                "Ask the operator: nrdocs rules add 'OWNER/*' --access password --allow-unlisted-files true",
                'Or remove non-whitelisted files from docs/',
              ],
        });
      }
    }
  }

  let operatorApiUrl: string | undefined;
  let operatorToken: string | undefined;
  try {
    const creds = resolveCredentials();
    operatorApiUrl = creds.api_url;
    operatorToken = creds.operator_token;
  } catch {
    // no operator profile — expected for repo owners
  }

  if (operatorApiUrl && operatorToken) {
    const client = new ApiClient(operatorApiUrl, operatorToken);
    const res = await client.getOperatorMe();
    checks.push({
      section: 'Operator auth',
      name: 'Operator token',
      status: res.ok ? 'ok' : 'warn',
      message: res.ok
        ? 'Accepted (GET /api/operator/me)'
        : `Rejected: ${res.error?.message ?? 'unknown'}`,
    });
    if (publishBaseUrl) {
      const opBase = normalizeApiBaseUrl(operatorApiUrl).url;
      const pubBase = normalizeApiBaseUrl(publishBaseUrl).url;
      if (opBase !== pubBase) {
        checks.push({
          section: 'Operator auth',
          name: 'Operator vs publish URL',
          status: 'warn',
          message: `Operator profile uses ${opBase}, publish uses ${pubBase}`,
          fixes: ['These can differ if intentional; publish uses workflow/config URL, not operator profile'],
        });
      }
    }
  } else if (!inCI) {
    checks.push({
      section: 'Operator auth',
      name: 'Operator token',
      status: 'warn',
      message: 'Not configured (optional for repo owners) — run: nrdocs auth login',
    });
  }

  if (opts.json) {
    console.log(JSON.stringify({ checks }, null, 2));
    const publishFailed = checks.some(
      (c) =>
        (c.section === 'API reachability' || c.section === 'Publish URL') && c.status === 'fail',
    );
    if (publishFailed) process.exitCode = 1;
    return;
  }

  console.log('nrdocs doctor\n');

  let currentSection = '';
  let publishPathFailed = false;
  let repoSetupFailed = false;

  for (const check of checks) {
    if (check.section !== currentSection) {
      currentSection = check.section;
      console.log(`${currentSection}`);
    }
    const icon = check.status === 'ok' ? '✓' : check.status === 'warn' ? '!' : '✗';
    console.log(`  ${icon} ${check.name}: ${check.message}`);
    if (check.fixes?.length) {
      for (const fix of check.fixes) {
        console.log(`      → ${fix}`);
      }
    }
    if (check.status === 'fail') {
      if (check.section === 'Repo setup') repoSetupFailed = true;
      if (check.section === 'API reachability' || check.section === 'Publish URL') {
        publishPathFailed = true;
      }
      if (check.section === 'GitHub Actions') publishPathFailed = true;
      if (check.section === 'Publish assets') publishPathFailed = true;
    }
  }

  console.log('');
  if (publishPathFailed) {
    console.log('Summary: Publish path checks FAILED — fix API reachability/URL before pushing.');
    process.exitCode = 1;
  } else if (repoSetupFailed) {
    console.log('Summary: Repo setup checks failed.');
    process.exitCode = 1;
  } else {
    console.log('Summary: All checks passed for this environment.');
    if (!operatorToken && !inCI) {
      console.log('(Operator auth not tested — optional for repo owners.)');
    }
  }
}
