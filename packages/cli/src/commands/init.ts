import * as fs from 'node:fs';
import * as path from 'node:path';
import { getProfile, getDefaultProfileName } from '../config/index.js';
import {
  buildDocsConfig,
  generateNavInConfig,
  parseDocsConfigFile,
  resolveDocsApiUrl,
  salvageDocsFields,
  validateDocsConfigFile,
  writeDocsConfigFile,
  type DocsConfig,
} from '../config/docs-config.js';

interface InitOptions {
  docsDir?: string;
  title?: string;
  apiUrl?: string;
  requestedAccess?: string;
  force?: boolean;
}

export interface InitPlan {
  writeConfig: boolean;
  repaired: boolean;
  repairNotes: string[];
  title: string;
  apiUrl: string;
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

      - name: Diagnose setup
        run: nrdocs doctor --ci
        env:
          NRDOCS_API_URL: ${apiUrl}

      - name: Publish docs
        run: nrdocs publish --docs-dir ${docsDir}
        env:
          NRDOCS_API_URL: ${apiUrl}
          NRDOCS_DOCS_PASSWORD: \${{ secrets.NRDOCS_DOCS_PASSWORD }}
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
 */
export function normalizeInitUrl(url: string): string {
  let normalized = url.trim();

  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = `https://${normalized}`;
  }

  normalized = normalized.replace(/\/+$/, '');

  try {
    new URL(normalized);
  } catch {
    throw new Error(`"${url}" is not a valid URL`);
  }

  return normalized;
}

function getProfileApiUrl(): string | undefined {
  const profileName = getDefaultProfileName();
  const profile = getProfile(profileName);
  return profile?.api_url?.trim() || undefined;
}

export function describeApiUrlSource(
  opts: InitOptions,
  configFile: string,
  workflowFile: string,
): string {
  if (opts.apiUrl) return '--api-url';
  if (process.env['NRDOCS_API_URL']) return 'NRDOCS_API_URL';
  if (validateDocsConfigFile(configFile).apiUrl) return 'docs/nrdocs.yml';
  if (fs.existsSync(workflowFile)) return 'workflow';
  return 'operator profile';
}

/**
 * Plans what init should write based on existing config and flags.
 */
export function planInit(
  configFile: string,
  opts: InitOptions,
  context: {
    defaultTitle: string;
    apiUrl: string;
    apiUrlSource: string;
  },
): InitPlan {
  const configExists = fs.existsSync(configFile);
  const repairNotes: string[] = [];
  const parsed = configExists ? parseDocsConfigFile(configFile) : null;
  const salvaged = parsed
    ? salvageDocsFields(parsed as DocsConfig & Record<string, unknown>)
    : { exportEnabled: true as const };
  const title = opts.title || salvaged.title || context.defaultTitle;

  if (!configExists) {
    repairNotes.push('created docs/nrdocs.yml');
    return {
      writeConfig: true,
      repaired: false,
      repairNotes,
      title,
      apiUrl: context.apiUrl,
    };
  }

  if (opts.force) {
    repairNotes.push('replaced config (--force)');
    return {
      writeConfig: true,
      repaired: true,
      repairNotes,
      title,
      apiUrl: context.apiUrl,
    };
  }

  const validation = validateDocsConfigFile(configFile);
  if (validation.valid) {
    return {
      writeConfig: false,
      repaired: false,
      repairNotes: [],
      title: validation.title!,
      apiUrl: validation.apiUrl!,
    };
  }

  repairNotes.push('repaired invalid docs/nrdocs.yml');
  if (validation.error) {
    repairNotes.push(`was: ${validation.error}`);
  }
  if (salvaged.title) {
    repairNotes.push('preserved site.title');
  } else if (opts.title) {
    repairNotes.push('set site.title from --title');
  } else {
    repairNotes.push(`set site.title to "${title}"`);
  }
  repairNotes.push('added site: and content: sections');
  repairNotes.push(`set site.api_url from ${context.apiUrlSource}`);

  return {
    writeConfig: true,
    repaired: true,
    repairNotes,
    title,
    apiUrl: context.apiUrl,
  };
}

function failMissingApiUrl(): never {
  console.error('Error: Cannot initialize docs/nrdocs.yml — missing site.api_url.');
  console.error('');
  console.error('Checked: --api-url, NRDOCS_API_URL, docs/nrdocs.yml, workflow, operator profile');
  console.error('');
  console.error('If you are the operator, run:');
  console.error('  nrdocs auth login');
  console.error('');
  console.error('Otherwise ask your operator for the deployment URL, then run:');
  console.error('  nrdocs init --api-url https://docs.example.com');
  process.exit(2);
}

/**
 * Handles the `nrdocs init` command.
 */
export async function handleInit(args: string[]): Promise<void> {
  const opts = parseInitArgs(args);

  if (opts.requestedAccess && !['public', 'password'].includes(opts.requestedAccess)) {
    console.error('Error: --requested-access must be "public" or "password".');
    process.exit(2);
  }

  const docsDir = opts.docsDir || 'docs';
  const docsPath = path.resolve(docsDir);
  const configFile = path.join(docsPath, 'nrdocs.yml');
  const workflowDir = path.resolve('.github', 'workflows');
  const workflowFile = path.join(workflowDir, 'nrdocs.yml');

  let apiUrl = resolveDocsApiUrl({
    flag: opts.apiUrl,
    env: process.env['NRDOCS_API_URL'],
    configPath: configFile,
    workflowPath: workflowFile,
    profileUrl: getProfileApiUrl(),
  });

  if (!apiUrl) {
    failMissingApiUrl();
  }

  try {
    apiUrl = normalizeInitUrl(apiUrl);
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    console.error('Expected format: https://docs.example.com');
    process.exit(2);
  }

  if (apiUrl.startsWith('http://')) {
    console.error('');
    console.error('Warning: API URL uses http://');
    console.error('Password-protected docs require HTTPS — readers cannot log in over HTTP.');
    console.error('Set site.api_url and NRDOCS_API_URL to https:// after TLS is configured.');
    console.error('');
  }

  const apiUrlSource = describeApiUrlSource(opts, configFile, workflowFile);
  const plan = planInit(configFile, opts, {
    defaultTitle: `${path.basename(process.cwd())} Docs`,
    apiUrl,
    apiUrlSource,
  });

  fs.mkdirSync(docsPath, { recursive: true });
  fs.mkdirSync(workflowDir, { recursive: true });

  let salvagedExport = true;
  let salvagedDescription: string | undefined;
  let salvagedRequestedAccess = opts.requestedAccess;

  if (fs.existsSync(configFile)) {
    const parsed = parseDocsConfigFile(configFile);
    if (parsed) {
      const salvaged = salvageDocsFields(parsed as DocsConfig & Record<string, unknown>);
      salvagedExport = salvaged.exportEnabled;
      salvagedDescription = salvaged.description;
      salvagedRequestedAccess = opts.requestedAccess || salvaged.requestedAccess;
    }
  }

  if (plan.writeConfig) {
    writeDocsConfigFile(
      configFile,
      buildDocsConfig({
        title: plan.title,
        apiUrl: plan.apiUrl,
        requestedAccess: salvagedRequestedAccess,
        exportEnabled: salvagedExport,
        description: salvagedDescription,
      }),
    );
  }

  const workflowExisted = fs.existsSync(workflowFile);
  fs.writeFileSync(workflowFile, generateWorkflowYml(docsDir, plan.apiUrl));

  let navPageCount = 0;
  if (plan.writeConfig) {
    try {
      navPageCount = generateNavInConfig(docsDir, { generatedBy: 'nrdocs init' });
      if (navPageCount > 0 && plan.repaired) {
        plan.repairNotes.push(`generated content.nav (${navPageCount} page(s))`);
      }
    } catch {
      // Nav generation is best-effort during init when markdown is missing.
    }
  }

  console.log('nrdocs initialized successfully!');
  console.log('');

  if (plan.writeConfig) {
    if (plan.repaired) {
      console.log(`Repaired ${path.relative(process.cwd(), configFile)}:`);
      for (const note of plan.repairNotes) {
        console.log(`  - ${note}`);
      }
    } else {
      console.log('Created/updated:');
      console.log(`  ${path.relative(process.cwd(), configFile)}`);
    }
  } else {
    console.log(`${path.relative(process.cwd(), configFile)} is valid`);
  }

  if (!workflowExisted) {
    console.log(`  ${path.relative(process.cwd(), workflowFile)}`);
  } else {
    console.log(`  ${path.relative(process.cwd(), workflowFile)} (synced NRDOCS_API_URL)`);
  }

  if (navPageCount > 0 && !plan.repaired) {
    console.log(`  content.nav: ${navPageCount} page(s) from markdown under ${docsDir}/`);
  }

  console.log('');
  console.log('Next steps:');
  if (navPageCount === 0) {
    console.log(`  1. Add markdown files under ${docsDir}/, then run: nrdocs nav generate`);
  } else {
    console.log(`  1. Edit content.nav in ${path.relative(process.cwd(), configFile)} to reorder pages`);
  }
  console.log('  2. Commit and push to trigger the workflow');
  console.log('  3. Ask your operator to approve the repo');
}
