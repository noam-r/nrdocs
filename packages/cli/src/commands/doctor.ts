import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveCredentials } from '../config/index.js';
import { ApiClient } from '../api-client.js';

interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
}

/**
 * Handles the `nrdocs doctor` command.
 * Runs diagnostic checks on the current project setup.
 */
export async function handleDoctor(_args: string[]): Promise<void> {
  const checks: DoctorCheck[] = [];

  // Check 1: Is this a git repo?
  const isGitRepo = fs.existsSync(path.resolve('.git'));
  checks.push({
    name: 'Git repository',
    status: isGitRepo ? 'ok' : 'fail',
    message: isGitRepo ? 'Found .git directory' : 'Not a git repository',
  });

  // Check 2: Does docs/nrdocs.yml exist?
  const configPath = path.resolve('docs', 'nrdocs.yml');
  const hasConfig = fs.existsSync(configPath);
  checks.push({
    name: 'Docs config',
    status: hasConfig ? 'ok' : 'fail',
    message: hasConfig ? 'Found docs/nrdocs.yml' : 'Missing docs/nrdocs.yml — run: nrdocs init',
  });

  // Check 3: Does .github/workflows/nrdocs.yml exist?
  const workflowPath = path.resolve('.github', 'workflows', 'nrdocs.yml');
  const hasWorkflow = fs.existsSync(workflowPath);
  checks.push({
    name: 'GitHub workflow',
    status: hasWorkflow ? 'ok' : 'warn',
    message: hasWorkflow
      ? 'Found .github/workflows/nrdocs.yml'
      : 'Missing .github/workflows/nrdocs.yml — run: nrdocs init',
  });

  // Check 4: Is API URL configured?
  let apiUrl: string | undefined;
  let token: string | undefined;
  try {
    const creds = resolveCredentials();
    apiUrl = creds.api_url;
    token = creds.operator_token;
    checks.push({
      name: 'API URL',
      status: 'ok',
      message: `Configured: ${apiUrl}`,
    });
  } catch {
    checks.push({
      name: 'API URL',
      status: 'warn',
      message: 'Not configured — run: nrdocs auth login',
    });
  }

  // Check 5: API connectivity (only if credentials available)
  if (apiUrl && token) {
    try {
      const client = new ApiClient(apiUrl, token);
      const res = await client.getOperatorMe();
      if (res.ok) {
        checks.push({
          name: 'API connectivity',
          status: 'ok',
          message: 'Successfully connected to API',
        });
      } else {
        checks.push({
          name: 'API connectivity',
          status: 'warn',
          message: `API returned error: ${res.error?.message ?? 'unknown'}`,
        });
      }
    } catch {
      checks.push({
        name: 'API connectivity',
        status: 'fail',
        message: 'Could not connect to API',
      });
    }
  }

  // Print results
  console.log('nrdocs doctor\n');
  let hasFailure = false;
  for (const check of checks) {
    const icon = check.status === 'ok' ? '✓' : check.status === 'warn' ? '!' : '✗';
    const prefix = check.status === 'ok' ? '  ' : check.status === 'warn' ? '  ' : '  ';
    console.log(`${prefix}${icon} ${check.name}: ${check.message}`);
    if (check.status === 'fail') hasFailure = true;
  }

  console.log('');
  if (hasFailure) {
    console.log('Some checks failed. Fix the issues above and run doctor again.');
    process.exitCode = 1;
  } else {
    console.log('All checks passed!');
  }
}
