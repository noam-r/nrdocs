import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderSite } from '../renderer/index.js';
import { createArchive } from '../renderer/packager.js';
import { ApiClient } from '../api-client.js';

interface PublishOptions {
  docsDir?: string;
}

/**
 * Parses publish flags from args.
 */
export function parsePublishArgs(args: string[]): PublishOptions {
  const opts: PublishOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--docs-dir' && i + 1 < args.length) {
      opts.docsDir = args[++i];
    }
  }
  return opts;
}

/**
 * Validates the nrdocs.yml config file exists and has basic structure.
 * Returns parsed config values on success.
 */
function validateConfig(configPath: string): {
  valid: boolean;
  error?: string;
  title?: string;
  apiUrl?: string;
} {
  if (!fs.existsSync(configPath)) {
    return { valid: false, error: `Config file not found: ${configPath}` };
  }

  const content = fs.readFileSync(configPath, 'utf-8');
  if (!content.includes('site:')) {
    return { valid: false, error: 'Config file missing "site:" section' };
  }
  if (!content.includes('title:')) {
    return { valid: false, error: 'Config file missing "title:" field' };
  }

  // Extract title (simple YAML parsing for the fields we need)
  const titleMatch = content.match(/title:\s*["']?([^"'\n]+)["']?/);
  const title = titleMatch ? titleMatch[1]!.trim() : 'Documentation';

  const apiUrlMatch = content.match(/api_url:\s*["']?([^"'\n]+)["']?/);
  const apiUrl = apiUrlMatch ? apiUrlMatch[1]!.trim() : undefined;

  return { valid: true, title, apiUrl };
}

/**
 * Detects if running in GitHub Actions with OIDC support.
 */
function detectCI(): { inCI: boolean; hasOIDC: boolean } {
  const inCI = process.env['GITHUB_ACTIONS'] === 'true';
  const hasOIDC = !!(
    process.env['ACTIONS_ID_TOKEN_REQUEST_URL'] &&
    process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN']
  );
  return { inCI, hasOIDC };
}

/**
 * Extracts owner/repo from GITHUB_REPOSITORY env var.
 */
function getRepoInfo(): { owner: string; repo: string } | null {
  const ghRepo = process.env['GITHUB_REPOSITORY'];
  if (!ghRepo) return null;
  const [owner, repo] = ghRepo.split('/');
  if (!owner || !repo) return null;
  return { owner, repo };
}

/**
 * Requests an OIDC token from GitHub Actions.
 */
async function getOIDCToken(): Promise<string | null> {
  const requestUrl = process.env['ACTIONS_ID_TOKEN_REQUEST_URL'];
  const requestToken = process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
  if (!requestUrl || !requestToken) return null;

  try {
    const res = await fetch(`${requestUrl}&audience=nrdocs`, {
      headers: { Authorization: `bearer ${requestToken}` },
    });
    const json = (await res.json()) as { value?: string };
    return json.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Handles the `nrdocs publish` command.
 *
 * Full pipeline: validate config → render → package → upload.
 */
export async function handlePublish(args: string[]): Promise<void> {
  const opts = parsePublishArgs(args);
  const docsDir = opts.docsDir || 'docs';
  const configPath = path.resolve(docsDir, 'nrdocs.yml');

  // Validate config
  const validation = validateConfig(configPath);
  if (!validation.valid) {
    console.error(`Error: ${validation.error}`);
    process.exit(10);
  }

  // Check CI environment
  const ci = detectCI();

  if (!ci.inCI) {
    console.error('Error: nrdocs publish must run inside GitHub Actions.');
    console.error('');
    console.error('The publish command uses GitHub OIDC tokens for authentication.');
    console.error('Push your code to trigger the .github/workflows/nrdocs.yml workflow.');
    process.exit(12);
  }

  if (!ci.hasOIDC) {
    console.error('Error: OIDC token not available.');
    console.error('');
    console.error('Ensure your workflow has:');
    console.error('  permissions:');
    console.error('    id-token: write');
    process.exit(12);
  }

  // Get repo info from environment
  const repoInfo = getRepoInfo();
  if (!repoInfo) {
    console.error('Error: GITHUB_REPOSITORY environment variable not set.');
    process.exit(12);
  }

  const { owner, repo } = repoInfo;
  const siteTitle = validation.title || 'Documentation';
  const apiUrl = validation.apiUrl || process.env['NRDOCS_API_URL'] || '';

  if (!apiUrl) {
    console.error('Error: No API URL configured. Set api_url in nrdocs.yml or NRDOCS_API_URL env var.');
    process.exit(10);
  }

  console.log(`Publishing docs for ${owner}/${repo}...`);
  console.log(`Docs directory: ${docsDir}`);
  console.log(`Site title: ${siteTitle}`);

  // Render site
  console.log('Rendering Markdown...');
  const site = await renderSite({
    docsDir,
    siteTitle,
    baseUrl: apiUrl,
    owner,
    repo,
  });

  console.log(`Rendered ${site.files.length} files.`);

  // Create archive
  console.log('Creating archive...');
  const archive = await createArchive(site.files, site.manifest);
  console.log(`Archive size: ${(archive.length / 1024).toFixed(1)} KB`);

  // Get OIDC token and upload
  console.log('Requesting OIDC token...');
  const token = await getOIDCToken();
  if (!token) {
    console.error('Error: Failed to obtain OIDC token.');
    process.exit(12);
  }

  console.log('Uploading to nrdocs...');
  const client = new ApiClient(apiUrl, token);

  // Build FormData with archive
  const formData = new FormData();
  formData.append('artifact', new Blob([archive], { type: 'application/gzip' }), 'docs.tar.gz');
  formData.append('metadata', JSON.stringify({
    schema_version: 1,
    site: { title: siteTitle, requested_access: 'password' },
    artifact: { format: 'tar.gz', size_bytes: archive.length },
    nrdocs: { cli_version: '0.1.1' },
  }));

  const result = await client.publish(formData);

  if (result.ok) {
    console.log('Published successfully!');
    console.log(`View at: ${apiUrl}/${owner}/${repo}/`);
  } else {
    console.error(`Error: Upload failed — ${result.error?.message || 'unknown error'}`);
    process.exit(14);
  }
}
