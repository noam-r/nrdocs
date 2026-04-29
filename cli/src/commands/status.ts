import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectStatus, type ProjectStatusResponse } from '../api-client';
import { parseProjectConfig, type CliProjectConfig } from '../config-parser';
import { loadDotEnvFromAncestors } from './admin';
import { isGhInstalled, isGhAuthenticated, ghHasSecret, ghHasVariable } from '../gh-integration';

interface StatusMetadata {
  project_id?: string;
  api_url?: string;
  delivery_url?: string | null;
  org_slug?: string;
  slug?: string;
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

function readLocalProjectConfig(docsDir: string): { path: string; config: CliProjectConfig } | null {
  const projectPath = join(docsDir, 'project.yml');
  if (!existsSync(projectPath)) return null;

  const config = parseProjectConfig(readFileSync(projectPath, 'utf-8'));
  return { path: projectPath, config };
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function printStatusHelp(): void {
  console.log(`nrdocs status

Usage: nrdocs status [--docs-dir <dir>]

Shows local nrdocs setup and, when project metadata is available, the Control Plane status.

Reads:
  .nrdocs/status.json                 Non-secret project metadata written by nrdocs init
  docs/project.yml                    Local project configuration
  .github/workflows/publish-docs.yml  GitHub Actions publishing workflow

Environment overrides:
  NRDOCS_API_URL      Control Plane Worker URL
  NRDOCS_PROJECT_ID   Project ID to check
  NRDOCS_DOCS_DIR     Docs directory when --docs-dir is not passed
`);
}

export async function runStatus(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printStatusHelp();
    return;
  }

  loadDotEnvFromAncestors(process.cwd());

  const metadata = readStatusMetadata();
  const docsDir =
    parseFlag(args, '--docs-dir') ??
    process.env.NRDOCS_DOCS_DIR?.trim() ??
    metadata?.docs_dir ??
    'docs';
  const localProject = readLocalProjectConfig(docsDir);
  const workflowExists = existsSync(WORKFLOW_PATH);
  const apiUrl = process.env.NRDOCS_API_URL?.trim() || metadata?.api_url || '';
  const projectId = process.env.NRDOCS_PROJECT_ID?.trim() || metadata?.project_id || '';

  let remote: ProjectStatusResponse | null = null;
  let remoteError: string | null = null;
  if (apiUrl && projectId) {
    try {
      remote = await getProjectStatus(apiUrl, projectId);
    } catch (err) {
      remoteError = err instanceof Error ? err.message : String(err);
      if (remoteError.includes('API request failed (401)')) {
        remoteError += '; if this endpoint is protected by API key auth, deploy the updated Control Plane Worker';
      }
    }
  }

  console.log('nrdocs status');
  console.log('');
  console.log('Local repository:');
  console.log(`  Initialized:    ${yesNo(Boolean(localProject))}`);
  if (localProject) {
    console.log(`  Project file:   ${localProject.path}`);
    console.log(`  Slug:           ${localProject.config.slug}`);
    console.log(`  Title:          ${localProject.config.title}`);
    console.log(`  Access mode:    ${localProject.config.access_mode}`);
  } else {
    console.log(`  Project file:   missing (${join(docsDir, 'project.yml')})`);
  }
  console.log(`  Publish workflow: ${workflowExists ? WORKFLOW_PATH : 'missing'}`);
  if (metadata?.publish_branch) {
    console.log(`  Publish branch: ${metadata.publish_branch}`);
  }

  console.log('');
  console.log('GitHub Actions:');
  const ghInstalled = await isGhInstalled();
  const ghAuthed = ghInstalled ? await isGhAuthenticated() : false;
  if (ghInstalled && ghAuthed) {
    const hasTokenSecret = await ghHasSecret('NRDOCS_PUBLISH_TOKEN');
    const hasProjectVar = await ghHasVariable('NRDOCS_PROJECT_ID');
    console.log(`  OIDC publishing: supported (no per-repo secrets/vars required)`);
    console.log(`  Legacy secret NRDOCS_PUBLISH_TOKEN: ${hasTokenSecret === true ? 'present' : hasTokenSecret === false ? 'missing' : 'unknown'}`);
    console.log(`  Legacy var NRDOCS_PROJECT_ID:       ${hasProjectVar === true ? 'present' : hasProjectVar === false ? 'missing' : 'unknown'}`);
  } else {
    console.log('  Status: unknown (gh CLI not installed or not authenticated)');
  }

  console.log('');
  console.log('Control Plane:');
  if (!projectId) {
    console.log('  Project ID:     unavailable');
    console.log(`  Remote status:  unknown (run nrdocs init, or set NRDOCS_PROJECT_ID)`);
    return;
  }

  console.log(`  Project ID:     ${projectId}`);
  if (!apiUrl) {
    console.log('  Remote status:  unknown (missing NRDOCS_API_URL or .nrdocs/status.json)');
    return;
  }

  if (remoteError) {
    console.log(`  Remote status:  unavailable (${remoteError})`);
    return;
  }

  if (!remote) {
    console.log('  Remote status:  unknown');
    return;
  }

  console.log(`  Status:         ${remote.status}`);
  console.log(`  Approved:       ${yesNo(remote.approved)}`);
  console.log(`  Published:      ${yesNo(remote.published)}`);
  if (remote.url) {
    console.log(`  Docs URL:       ${remote.url}`);
  } else {
    console.log('  Docs URL:       unavailable (DELIVERY_URL is not configured on the Control Plane)');
  }
}
