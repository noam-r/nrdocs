/**
 * nrdocs deploy — deploys or updates nrdocs Cloudflare infrastructure.
 *
 * Uses Wrangler under the hood. Creates/reuses D1, R2, and Worker resources
 * using the nrdocs-{instance} naming convention.
 */

import * as readline from 'node:readline';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { validateInstanceName, getResourceNames } from '@nrdocs/shared';
import { setProfile, createProfile, setDefaultProfile } from '../config/index.js';

interface DeployOptions {
  instance?: string;
  accountId?: string;
  zoneId?: string;
  baseUrl?: string;
  staticDir?: string;
  operatorToken?: string;
  operatorTokenEnv?: string;
  profile?: string;
  saveProfile?: boolean;
  noSaveProfile?: boolean;
  nonInteractive?: boolean;
  dryRun?: boolean;
}

export function parseDeployArgs(args: string[]): DeployOptions {
  const opts: DeployOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--instance' && i + 1 < args.length) opts.instance = args[++i];
    else if (arg === '--account-id' && i + 1 < args.length) opts.accountId = args[++i];
    else if (arg === '--zone-id' && i + 1 < args.length) opts.zoneId = args[++i];
    else if (arg === '--base-url' && i + 1 < args.length) opts.baseUrl = args[++i];
    else if (arg === '--static-dir' && i + 1 < args.length) opts.staticDir = args[++i];
    else if (arg === '--operator-token' && i + 1 < args.length) opts.operatorToken = args[++i];
    else if (arg === '--operator-token-env' && i + 1 < args.length) opts.operatorTokenEnv = args[++i];
    else if (arg === '--profile' && i + 1 < args.length) opts.profile = args[++i];
    else if (arg === '--save-profile') opts.saveProfile = true;
    else if (arg === '--no-save-profile') opts.noSaveProfile = true;
    else if (arg === '--non-interactive') opts.nonInteractive = true;
    else if (arg === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function runSilent(cmd: string): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return { ok: true, stdout, stderr: '' };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

function generateOperatorToken(): string {
  return `nrdocs_op_${crypto.randomBytes(24).toString('hex')}`;
}

function checkWrangler(): boolean {
  const result = runSilent('npx wrangler --version');
  return result.ok;
}

function checkCloudflareAuth(): boolean {
  if (process.env['CLOUDFLARE_API_TOKEN']) return true;
  const result = runSilent('npx wrangler whoami');
  return result.ok && !result.stdout.includes('Not authenticated');
}

/**
 * Validates and normalizes a URL. Adds https:// if no protocol is present.
 */
function normalizeUrl(url: string): string {
  let normalized = url.trim();
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = `https://${normalized}`;
  }
  normalized = normalized.replace(/\/+$/, '');
  try {
    new URL(normalized);
  } catch {
    console.error(`Error: "${url}" is not a valid URL.`);
    console.error('Expected format: https://docs.example.com');
    process.exit(2);
  }
  return normalized;
}

/**
 * Finds the packages/worker directory by looking relative to the CLI package.
 */
function findWorkerDir(): string | null {
  // Try common locations
  const candidates = [
    path.resolve('packages/worker'),
    path.resolve('../worker'),
  ];

  // Also try relative to the CLI dist directory
  const cliDir = process.argv[1] ? path.dirname(process.argv[1]) : process.cwd();
  candidates.push(path.resolve(cliDir, '../../../worker'));
  candidates.push(path.resolve(cliDir, '../../../../packages/worker'));

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'src', 'index.ts'))) {
      return candidate;
    }
  }
  return null;
}

export async function handleDeploy(args: string[]): Promise<void> {
  const opts = parseDeployArgs(args);

  // Check wrangler is available
  if (!checkWrangler()) {
    console.error('Error: Wrangler is not available.');
    console.error('Install it: npm install -g wrangler');
    process.exit(1);
  }

  // Check Cloudflare authentication
  if (!checkCloudflareAuth()) {
    if (opts.nonInteractive) {
      console.error('Error: Not authenticated with Cloudflare.');
      console.error('Run "npx wrangler login" first, or set CLOUDFLARE_API_TOKEN.');
      process.exit(3);
    }
    console.log('Not authenticated with Cloudflare. Starting login...');
    console.log('');
    const loginResult = runSilent('npx wrangler login');
    if (!loginResult.ok) {
      console.error('Error: Cloudflare login failed.');
      console.error('Try running "npx wrangler login" manually.');
      process.exit(3);
    }
    console.log('Authenticated with Cloudflare');
    console.log('');
  }

  // Gather inputs
  let instance = opts.instance;
  let baseUrl = opts.baseUrl;
  let operatorToken = opts.operatorToken;

  if (opts.operatorTokenEnv) {
    operatorToken = process.env[opts.operatorTokenEnv];
    if (!operatorToken) {
      console.error(`Error: Environment variable ${opts.operatorTokenEnv} is not set.`);
      process.exit(2);
    }
  }

  if (opts.nonInteractive) {
    if (!instance) { console.error('Error: --instance is required in non-interactive mode.'); process.exit(2); }
    if (!baseUrl) { console.error('Error: --base-url is required in non-interactive mode.'); process.exit(2); }
  } else {
    instance = instance || await prompt('Instance name', 'default');
    baseUrl = baseUrl || await prompt('Docs base URL', 'https://docs.example.com');
  }

  // Normalize and validate base URL
  baseUrl = normalizeUrl(baseUrl!);

  // Validate instance name
  const validation = validateInstanceName(instance!);
  if (!validation.valid) {
    console.error(`Error: ${validation.error}`);
    process.exit(2);
  }

  const names = getResourceNames(instance!);

  console.log('');
  console.log(`Instance: ${instance}`);
  console.log(`  Worker:   ${names.worker}`);
  console.log(`  D1:       ${names.d1}`);
  console.log(`  R2:       ${names.r2}`);
  console.log(`  Base URL: ${baseUrl}`);
  console.log('');

  if (opts.dryRun) {
    console.log('Dry run — no changes made.');
    return;
  }

  // Generate operator token if not provided
  let tokenGenerated = false;
  if (!operatorToken) {
    if (opts.nonInteractive) {
      console.error('Error: --operator-token or --operator-token-env is required in non-interactive mode.');
      process.exit(2);
    }
    const generate = await prompt('Generate operator token?', 'Y');
    if (generate.toLowerCase() === 'y' || generate === '') {
      operatorToken = generateOperatorToken();
      tokenGenerated = true;
    } else {
      operatorToken = await prompt('Operator token');
      if (!operatorToken) {
        console.error('Error: Operator token is required.');
        process.exit(2);
      }
    }
  }

  // Find the worker package directory
  const workerDir = findWorkerDir();
  if (!workerDir) {
    console.error('Error: Cannot find packages/worker directory.');
    console.error('Run nrdocs deploy from the nrdocs project root.');
    process.exit(4);
  }

  // Step 1: Create or verify R2 bucket
  console.log(`Creating R2 bucket ${names.r2}...`);
  const r2Check = runSilent('npx wrangler r2 bucket list');
  if (r2Check.ok && r2Check.stdout.includes(names.r2)) {
    console.log(`✅ R2 bucket ${names.r2} exists, reusing`);
  } else {
    const r2Create = runSilent(`npx wrangler r2 bucket create ${names.r2}`);
    if (r2Create.ok) {
      console.log(`✅ R2 bucket ${names.r2} created`);
    } else {
      console.error(`Error creating R2 bucket: ${r2Create.stderr}`);
      process.exit(4);
    }
  }

  // Step 2: Create or verify D1 database
  console.log(`Creating D1 database ${names.d1}...`);
  const d1List = runSilent('npx wrangler d1 list');
  let d1Id = '';
  if (d1List.ok && d1List.stdout.includes(names.d1)) {
    console.log(`✅ D1 database ${names.d1} exists, reusing`);
    const lines = d1List.stdout.split('\n').filter(l => l.includes(names.d1));
    const idMatch = lines[0]?.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
    d1Id = idMatch ? idMatch[1]! : 'unknown';
  } else {
    const d1Create = runSilent(`npx wrangler d1 create ${names.d1}`);
    if (d1Create.ok) {
      console.log(`✅ D1 database ${names.d1} created`);
      const idMatch = d1Create.stdout.match(/database_id\s*=\s*"([^"]+)"/);
      d1Id = idMatch ? idMatch[1]! : 'unknown';
    } else {
      console.error(`Error creating D1 database: ${d1Create.stderr}`);
      process.exit(4);
    }
  }

  // Step 3: Generate wrangler.toml in the worker directory (needed before migrations)
  const wranglerToml = `name = "${names.worker}"
main = "src/index.ts"
compatibility_date = "2026-05-07"

[[d1_databases]]
binding = "DB"
database_name = "${names.d1}"
database_id = "${d1Id}"

[[r2_buckets]]
binding = "ARTIFACTS"
bucket_name = "${names.r2}"

[vars]
BASE_URL = "${baseUrl}"
`;

  const wranglerPath = path.join(workerDir, 'wrangler.toml');
  fs.writeFileSync(wranglerPath, wranglerToml);
  console.log('✅ wrangler.toml generated');

  // Step 4: Apply migrations
  console.log('Applying D1 migrations...');
  const migrationsDir = path.join(workerDir, 'migrations');
  if (fs.existsSync(migrationsDir)) {
    const migResult = runSilent(`npx wrangler d1 migrations apply ${names.d1} --remote --config "${wranglerPath}"`);
    if (migResult.ok) {
      console.log('✅ Migrations applied');
    } else if (migResult.stderr.includes('already') || migResult.stdout.includes('othing to migrate')) {
      console.log('✅ Migrations up to date');
    } else {
      console.warn(`⚠️  Migration warning: ${migResult.stderr || migResult.stdout}`);
    }
  } else {
    console.log('⚠️  No migrations directory found, skipping');
  }

  // Step 5: Set secrets
  console.log('Setting Worker secrets...');
  try {
    execSync(`echo "${operatorToken}" | npx wrangler secret put OPERATOR_TOKEN --config "${wranglerPath}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    const sessionSecret = crypto.randomBytes(32).toString('hex');
    execSync(`echo "${sessionSecret}" | npx wrangler secret put SESSION_SECRET --config "${wranglerPath}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    console.log('✅ Secrets configured');
  } catch {
    console.warn('⚠️  Could not set secrets automatically. Set them manually:');
    console.warn(`   npx wrangler secret put OPERATOR_TOKEN --config "${wranglerPath}"`);
    console.warn(`   npx wrangler secret put SESSION_SECRET --config "${wranglerPath}"`);
  }

  // Step 6: Deploy Worker
  console.log('Deploying Worker...');
  const deployResult = runSilent(`npx wrangler deploy --config "${wranglerPath}"`);
  if (deployResult.ok) {
    console.log(`✅ Worker ${names.worker} deployed`);
  } else {
    console.error(`Error deploying Worker: ${deployResult.stderr}`);
    process.exit(4);
  }

  // Step 7: Health check
  console.log('Running health check...');
  try {
    const healthUrl = `${baseUrl}/api/status`;
    const res = await fetch(healthUrl);
    if (res.ok) {
      console.log('✅ Health check passed');
    } else {
      console.warn(`⚠️  Health check returned ${res.status} — may need a moment to propagate`);
    }
  } catch {
    console.warn('⚠️  Health check failed — may need a moment to propagate');
  }

  // Output
  console.log('');
  if (tokenGenerated) {
    console.log('Operator token (save to a password manager as backup):');
    console.log(`  ${operatorToken}`);
    console.log('');
    console.log('This token is already saved to your local profile.');
    console.log('You do NOT need to export it or paste it anywhere.');
    console.log('');
  }

  // Save profile
  const shouldSave = opts.noSaveProfile ? false : (opts.saveProfile || !opts.nonInteractive);
  if (shouldSave) {
    const profileName = opts.profile || 'default';
    const profile = createProfile(baseUrl!, operatorToken!, instance);
    setProfile(profileName, profile);
    setDefaultProfile(profileName);
    console.log(`Operator profile saved: ${profileName}`);
  }

  console.log('');
  console.log('Deployment complete.');
  console.log(`  API:  ${baseUrl}/api`);
  console.log(`  Docs: ${baseUrl}/`);
  console.log('');
  console.log('Next:');
  console.log(`  nrdocs rules add 'OWNER/*' --access password`);
  console.log('  nrdocs repos');
}
