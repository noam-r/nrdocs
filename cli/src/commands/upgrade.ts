import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseProjectConfig } from '../config-parser';
import { generatePublishWorkflow, type ScaffoldConfig } from '../scaffolder';
import { loadDotEnvFromAncestors } from './admin';
import { getDefaultApiUrl } from '../global-state';

interface StatusMetadata {
  api_url?: string;
  docs_dir?: string;
  publish_branch?: string;
  repo_identity?: string;
}

const STATUS_METADATA_PATH = join('.nrdocs', 'status.json');
const WORKFLOW_PATH = join('.github', 'workflows', 'publish-docs.yml');

function parseFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function readStatusMetadata(): StatusMetadata | null {
  if (!existsSync(STATUS_METADATA_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(STATUS_METADATA_PATH, 'utf-8')) as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as StatusMetadata
      : null;
  } catch {
    return null;
  }
}

function printUpgradeHelp(): void {
  console.log(`nrdocs upgrade

Usage: nrdocs upgrade [--docs-dir <dir>] [--publish-branch <branch>]

Refreshes generated nrdocs local scaffolding for an already-onboarded repo.
Does not use a bootstrap token and does not call the Control Plane.

Currently updates:
  .github/workflows/publish-docs.yml

Reads:
  .nrdocs/status.json  Non-secret metadata written by nrdocs init
  docs/project.yml     Project slug/title/description/access mode
`);
}

export async function runUpgrade(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printUpgradeHelp();
    return;
  }

  loadDotEnvFromAncestors(process.cwd());

  const metadata = readStatusMetadata();
  const docsDir = parseFlag(args, '--docs-dir') ??
    process.env.NRDOCS_DOCS_DIR?.trim() ??
    metadata?.docs_dir ??
    'docs';
  const apiUrl = process.env.NRDOCS_API_URL?.trim() || metadata?.api_url || getDefaultApiUrl() || '';
  const publishBranch = parseFlag(args, '--publish-branch') ??
    metadata?.publish_branch ??
    'main';
  const repoIdentity = metadata?.repo_identity ?? 'github.com/owner/repo';

  if (!apiUrl) {
    console.error(
      `Error: Missing Control Plane URL. Run nrdocs init first, or set NRDOCS_API_URL.`,
    );
    process.exitCode = 1;
    return;
  }

  const projectPath = join(docsDir, 'project.yml');
  if (!existsSync(projectPath)) {
    console.error(`Error: Missing ${projectPath}. Run nrdocs init or nrdocs import first.`);
    process.exitCode = 1;
    return;
  }

  const project = parseProjectConfig(readFileSync(projectPath, 'utf-8'));
  const scaffold: ScaffoldConfig = {
    slug: project.slug,
    title: project.title,
    description: project.description,
    docsDir,
    apiUrl,
    repoIdentity,
    publishBranch,
  };

  mkdirSync(join('.github', 'workflows'), { recursive: true });
  writeFileSync(WORKFLOW_PATH, generatePublishWorkflow(scaffold), 'utf-8');

  console.log('nrdocs upgrade complete');
  console.log(`  Updated: ${WORKFLOW_PATH}`);
  console.log(`  API URL: ${apiUrl}`);
  console.log(`  Docs dir: ${docsDir}`);
  console.log(`  Publish branch: ${publishBranch}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  git add ${WORKFLOW_PATH}`);
  console.log('  git commit -m "Upgrade nrdocs workflow"');
  console.log('  git push');
}

