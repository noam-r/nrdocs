import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRepoStatus, type RepoStatusResponse } from '../api-client';
import { parseProjectConfig, type CliProjectConfig } from '../config-parser';
import { loadDotEnvFromAncestors } from './admin';
import { isGhInstalled, isGhAuthenticated, ghHasSecret, ghHasVariable } from '../gh-integration';
import { getDefaultApiUrl } from '../global-state';

interface StatusMetadata {
  repo_id?: string;
  project_id?: string;
  api_url?: string;
  delivery_url?: string | null;
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

function printControlPlaneRemoteFailure(repoId: string, remoteError: string): void {
  console.log(`  Remote:         could not load repo record`);
  console.log(`  Error:          ${remoteError}`);

  const notFoundOnServer =
    remoteError.includes('404') &&
    (remoteError.includes('not found') || remoteError.includes('Not found'));

  console.log('');
  if (notFoundOnServer) {
    console.log('  What this means:');
    console.log(
      '    nrdocs queried GET …/status/<repo-id> on the control plane above. That server has no repo',
    );
    console.log(`    with id ${repoId} in its database. Your checkout still has that id from .nrdocs/status.json`);
    console.log('    (or from NRDOCS_REPO_ID), but the server has no matching row — wrong Worker URL, an old id,');
    console.log('    a deleted registration, or D1 was recreated.');
    console.log('');
    console.log('  What to do:');
    console.log('    1. Open .nrdocs/status.json and confirm "api_url" is the control plane you actually deploy to.');
    console.log(
      '    2. If you operate the platform: set NRDOCS_API_URL to that same URL, set NRDOCS_API_KEY, then run:',
    );
    console.log('         nrdocs admin list --all');
    console.log(
      '       If this repo id is not listed, register and approve again, then re-run:',
    );
    console.log('         nrdocs init --repo-id <id-from-register>');
    console.log('       and commit the updated .nrdocs/status.json.');
    console.log(
      '    3. If someone else operates the platform: send them this repo id and api_url; ask for a valid pair,',
    );
    console.log('       then run nrdocs init again with what they give you.');
    return;
  }

  console.log('  What this means:');
  console.log('    The control plane did not return repo status (network, TLS, wrong host, or server error).');
  console.log('');
  console.log('  What to do:');
  console.log('    Confirm NRDOCS_API_URL / .nrdocs/status.json "api_url", that the Worker is deployed, and retry.');
}

function printStatusHelp(): void {
  console.log(`nrdocs status

Usage: nrdocs status [--docs-dir <dir>]

Shows local nrdocs setup and, when repo metadata is available, the Control Plane status.

Reads:
  .nrdocs/status.json                 Non-secret metadata written by nrdocs init
  docs/project.yml                    Local site configuration
  .github/workflows/publish-docs.yml  GitHub Actions publishing workflow

Environment overrides:
  NRDOCS_API_URL      Control Plane Worker URL
  NRDOCS_REPO_ID      Repo UUID to check
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
  const apiUrl = process.env.NRDOCS_API_URL?.trim() || metadata?.api_url || getDefaultApiUrl() || '';
  const repoId =
    process.env.NRDOCS_REPO_ID?.trim() ||
    metadata?.repo_id ||
    metadata?.project_id ||
    '';

  let remote: RepoStatusResponse | null = null;
  let remoteError: string | null = null;
  if (apiUrl && repoId) {
    try {
      remote = await getRepoStatus(apiUrl, repoId);
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
    const hasRepoVar = await ghHasVariable('NRDOCS_REPO_ID');
    console.log(`  OIDC publishing: supported (no per-repo secrets/vars required)`);
    console.log(`  Legacy secret NRDOCS_PUBLISH_TOKEN: ${hasTokenSecret === true ? 'present' : hasTokenSecret === false ? 'missing' : 'unknown'}`);
    console.log(`  Legacy var NRDOCS_REPO_ID:          ${hasRepoVar === true ? 'present' : hasRepoVar === false ? 'missing' : 'unknown'}`);
  } else {
    console.log('  Status: unknown (gh CLI not installed or not authenticated)');
  }

  console.log('');
  console.log('Control Plane:');
  if (!repoId) {
    console.log('  Repo ID:        not linked (add repo_id to .nrdocs/status.json via nrdocs init --repo-id <uuid>, or set NRDOCS_REPO_ID)');
    console.log('  Remote:         skipped — UUID comes from the operator (`nrdocs admin list`) or GitHub Actions job summary after register');
    console.log('  Tip:            `nrdocs password set` needs that UUID (in the file or NRDOCS_REPO_ID)');
    if (localProject) {
      console.log(
        `  Reader URL:     not queried yet — published sites use slug "${localProject.config.slug}" (https://<delivery-host>/${localProject.config.slug}/).`,
      );
    }
    return;
  }

  console.log(`  Repo ID:        ${repoId}`);
  if (!apiUrl) {
    console.log('  API URL:        unavailable');
    console.log('  Remote:         skipped (no control plane URL — set NRDOCS_API_URL or run nrdocs init / nrdocs config set api-url)');
    return;
  }

  console.log(`  API URL:        ${apiUrl}`);

  if (remoteError) {
    printControlPlaneRemoteFailure(repoId, remoteError);
    return;
  }

  if (!remote) {
    console.log('  Remote:         unknown (no error but empty response)');
    return;
  }

  console.log('  Remote:         ok (repo exists on control plane)');
  console.log(`  Lifecycle:      ${remote.status}`);
  console.log(`  Approved:       ${yesNo(remote.approved)}  (required before CI can publish)`);
  console.log(`  Published:      ${yesNo(remote.published)}  (at least one successful publish)`);
  if (remote.url) {
    console.log(`  Docs URL:       ${remote.url}`);
  } else {
    const slugHint = localProject?.config.slug ?? remote.slug ?? '';
    if (slugHint) {
      console.log(
        `  Docs URL:       unavailable from API — pattern https://<delivery-host>/${slugHint}/ (set DELIVERY_URL on the Control Plane for an exact link)`,
      );
    } else {
      console.log('  Docs URL:       unavailable (DELIVERY_URL is not configured on the Control Plane)');
    }
  }
}
