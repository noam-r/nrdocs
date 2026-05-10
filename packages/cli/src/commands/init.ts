import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { getProfile, getDefaultProfileName } from '../config/index.js';

interface InitOptions {
  docsDir?: string;
  title?: string;
  apiUrl?: string;
  requestedAccess?: string;
  force?: boolean;
}

/**
 * Prompts for a value from stdin if not provided.
 */
async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function generateNrdocsYml(title: string, requestedAccess?: string): string {
  let yml = `# nrdocs site configuration
site:
  title: "${title}"

content:
  index: index.md
`;
  if (requestedAccess) {
    yml += `\nrequest:\n  access: ${requestedAccess}\n`;
  }
  return yml;
}

function generateIndexMd(title: string): string {
  return `# ${title}

Welcome to your documentation site powered by nrdocs.

## Getting Started

Edit this file to add your documentation content.
`;
}

function generateWorkflowYml(docsDir: string, apiUrl: string): string {
  return `name: Publish Docs (nrdocs)

on:
  push:
    branches: [main]
    paths:
      - '${docsDir}/**'
      - '.github/workflows/nrdocs.yml'
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install nrdocs CLI
        run: npm install -g nrdocs

      - name: Publish docs
        run: nrdocs publish --docs-dir ${docsDir}
        env:
          NRDOCS_API_URL: ${apiUrl}
`;
}

/**
 * Parses init flags from args.
 */
export function parseInitArgs(args: string[]): InitOptions {
  const opts: InitOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--docs-dir' && i + 1 < args.length) {
      opts.docsDir = args[++i];
    } else if (arg === '--title' && i + 1 < args.length) {
      opts.title = args[++i];
    } else if (arg === '--api-url' && i + 1 < args.length) {
      opts.apiUrl = args[++i];
    } else if (arg === '--requested-access' && i + 1 < args.length) {
      opts.requestedAccess = args[++i];
    } else if (arg === '--force') {
      opts.force = true;
    }
  }
  return opts;
}

/**
 * Validates and normalizes a URL. Adds https:// if no protocol is present.
 * Exits with error if the URL is invalid after normalization.
 */
function normalizeUrl(url: string): string {
  let normalized = url.trim();

  // Add https:// if no protocol
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = `https://${normalized}`;
  }

  // Remove trailing slash
  normalized = normalized.replace(/\/+$/, '');

  // Validate it's a parseable URL
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
 * Reads an existing nrdocs.yml and extracts known values.
 */
function readExistingConfig(configPath: string): { title?: string; apiUrl?: string } {
  if (!fs.existsSync(configPath)) return {};
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const titleMatch = content.match(/(?:title|name):\s*["']?([^"'\n]+)["']?/);
    const apiMatch = content.match(/api_url:\s*["']?([^"'\n]+)["']?/);
    return {
      title: titleMatch ? titleMatch[1]!.trim() : undefined,
      apiUrl: apiMatch ? apiMatch[1]!.trim() : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Handles the `nrdocs init` command.
 */
export async function handleInit(args: string[]): Promise<void> {
  const opts = parseInitArgs(args);

  // Validate requested-access if provided
  if (opts.requestedAccess && !['public', 'password'].includes(opts.requestedAccess)) {
    console.error('Error: --requested-access must be "public" or "password".');
    process.exit(2);
  }

  const docsDir = opts.docsDir || 'docs';
  const docsPath = path.resolve(docsDir);
  const configFile = path.join(docsPath, 'nrdocs.yml');

  // Read existing config if present
  const existing = readExistingConfig(configFile);
  const configExists = fs.existsSync(configFile);

  // Resolve title: flag → existing config → prompt
  const dirName = path.basename(process.cwd());
  let title = opts.title || existing.title;
  if (!title) {
    title = await prompt('Site title', `${dirName} Docs`);
  }

  // Resolve API URL: flag → env → existing config → local profile → prompt
  let apiUrl = opts.apiUrl || process.env['NRDOCS_API_URL'] || existing.apiUrl;
  if (!apiUrl) {
    const profileName = getDefaultProfileName();
    const profile = getProfile(profileName);
    if (profile?.api_url) {
      apiUrl = profile.api_url;
    }
  }
  if (!apiUrl) {
    console.log('');
    console.log('The API URL is the address of your nrdocs deployment.');
    console.log('If you don\'t know it, ask your nrdocs operator to run:');
    console.log('');
    console.log('  nrdocs auth status');
    console.log('');
    apiUrl = await prompt('API URL (e.g. https://docs.example.com)');
  }

  if (!apiUrl) {
    console.error('Error: API URL is required.');
    console.error('');
    console.error('Get it from your nrdocs operator:');
    console.error('  nrdocs auth status');
    console.error('');
    console.error('Or pass it directly:');
    console.error('  nrdocs init --api-url https://your-docs-url.com');
    process.exit(2);
  }

  // Validate URL has protocol
  apiUrl = normalizeUrl(apiUrl);

  const indexFile = path.join(docsPath, 'index.md');
  const workflowDir = path.resolve('.github', 'workflows');
  const workflowFile = path.join(workflowDir, 'nrdocs.yml');

  // Check for existing workflow (the only nrdocs-managed file that blocks without --force)
  if (!opts.force && fs.existsSync(workflowFile)) {
    console.error('Error: Workflow already exists:');
    console.error(`  ${workflowFile}`);
    console.error('Use --force to overwrite.');
    process.exit(3);
  }

  // Create directories
  fs.mkdirSync(docsPath, { recursive: true });
  fs.mkdirSync(workflowDir, { recursive: true });

  // Write nrdocs config only if it doesn't exist or --force is set
  const createdConfig = !configExists || opts.force;
  if (createdConfig) {
    fs.writeFileSync(configFile, generateNrdocsYml(title, opts.requestedAccess));
  }

  // Only create index.md if it doesn't already exist
  const createdIndex = !fs.existsSync(indexFile);
  if (createdIndex) {
    fs.writeFileSync(indexFile, generateIndexMd(title));
  }

  // Always write/update the workflow
  fs.writeFileSync(workflowFile, generateWorkflowYml(docsDir, apiUrl));

  console.log('nrdocs initialized successfully!');
  console.log('');
  console.log('Created/updated:');
  if (createdConfig) {
    console.log(`  ${path.relative(process.cwd(), configFile)}`);
  }
  if (createdIndex) {
    console.log(`  ${path.relative(process.cwd(), indexFile)}`);
  }
  console.log(`  ${path.relative(process.cwd(), workflowFile)}`);
  if (!createdConfig) {
    console.log('');
    console.log(`Using existing: ${path.relative(process.cwd(), configFile)}`);
  }
  console.log('');
  console.log('Next steps:');
  console.log('  1. Commit and push to trigger the workflow');
  console.log('  2. Ask your operator to approve the repo');
}
