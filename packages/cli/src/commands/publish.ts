import { renderSite } from '../renderer/index.js';
import { createArchive } from '../renderer/packager.js';
import { ApiClient } from '../api-client.js';
import {
  formatPublishFailure,
  normalizeApiBaseUrl,
  printFailure,
} from '../errors.js';
import {
  loadDocsConfig,
  getExplicitNav,
  validateNavPaths,
  isExportEnabled,
  validateDocsConfig,
} from '../config/docs-config.js';
import { getOIDCToken } from '../github-oidc.js';

interface PublishOptions {
  docsDir?: string;
  verbose?: boolean;
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
    } else if (arg === '--verbose' || arg === '-v') {
      opts.verbose = true;
    }
  }
  return opts;
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
 * Handles the `nrdocs publish` command.
 *
 * Full pipeline: validate config → render → package → upload.
 */
export async function handlePublish(args: string[]): Promise<void> {
  const opts = parsePublishArgs(args);
  const docsDir = opts.docsDir || 'docs';

  let docsConfig;
  try {
    docsConfig = loadDocsConfig(docsDir);
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(10);
  }

  const validation = validateDocsConfig(docsConfig.config);
  if (!validation.valid) {
    console.error(`Error: ${validation.error}`);
    process.exit(10);
  }

  const explicitNav = getExplicitNav(docsConfig.config);
  if (explicitNav) {
    const navCheck = validateNavPaths(explicitNav, docsConfig.contentDir);
    if (!navCheck.valid) {
      console.error('Error: Invalid content.nav in nrdocs.yml:');
      for (const err of navCheck.errors) {
        console.error(`  - ${err}`);
      }
      process.exit(10);
    }
  }

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

  const repoInfo = getRepoInfo();
  if (!repoInfo) {
    console.error('Error: GITHUB_REPOSITORY environment variable not set.');
    process.exit(12);
  }

  const { owner, repo } = repoInfo;
  const ownerLower = owner.toLowerCase();
  const repoLower = repo.toLowerCase();
  const fullName = `${ownerLower}/${repoLower}`;
  const siteTitle = validation.title || 'Documentation';
  const rawApiUrl = validation.apiUrl || process.env['NRDOCS_API_URL'] || '';

  if (!rawApiUrl) {
    console.error('Error: No API URL configured. Set api_url in nrdocs.yml or NRDOCS_API_URL env var.');
    process.exit(10);
  }

  const { url: apiUrl } = normalizeApiBaseUrl(rawApiUrl);

  console.log(`Publishing docs for ${fullName}...`);
  console.log(`Docs directory: ${docsDir}`);
  console.log(`Site title: ${siteTitle}`);
  if (opts.verbose) {
    console.log(`API base: ${apiUrl}`);
  }

  console.log('Requesting OIDC token...');
  const token = await getOIDCToken();
  if (!token) {
    console.error('Error: Failed to obtain OIDC token.');
    process.exit(12);
  }

  const client = new ApiClient(apiUrl, token);
  const capsRes = await client.getPublishCapabilities();
  if (!capsRes.ok) {
    console.error(`Error: Could not load publish capabilities: ${capsRes.error?.message ?? 'unknown'}`);
    process.exit(10);
  }
  const caps = capsRes.data as { allow_unlisted_assets?: boolean; full_name?: string; rule_matched?: boolean; rule_id?: string | null } | undefined;
  const allowUnlistedAssets = caps?.allow_unlisted_assets === true;
  if (opts.verbose) {
    console.log(`  Resolved repo: ${caps?.full_name ?? '(unknown)'}`);
    console.log(`  Rule matched: ${caps?.rule_matched ?? '(unknown)'} (id: ${caps?.rule_id ?? 'none'})`);
    console.log(`  Allow unlisted assets: ${allowUnlistedAssets}`);
  }

  console.log('Rendering Markdown...');
  const indexPath = docsConfig.config.content?.index ?? 'index.md';
  const navOption = explicitNav ?? 'auto';

  const site = await renderSite({
    docsDir: docsConfig.contentDir,
    siteTitle,
    baseUrl: apiUrl,
    owner: ownerLower,
    repo: repoLower,
    nav: navOption,
    indexPath,
    allowUnlistedAssets,
    exportEnabled: isExportEnabled(docsConfig.config),
  });

  console.log(`Rendered ${site.files.length} files.`);

  console.log('Creating archive...');
  const archive = await createArchive(site.files, site.manifest);
  console.log(`Archive size: ${(archive.length / 1024).toFixed(1)} KB`);

  console.log('Uploading to nrdocs...');

  const formData = new FormData();
  formData.append('artifact', new Blob([archive], { type: 'application/gzip' }), 'docs.tar.gz');
  formData.append('metadata', JSON.stringify({
    schema_version: 1,
    site: { title: siteTitle, requested_access: 'password' },
    artifact: { format: 'tar.gz', size_bytes: archive.length },
    nrdocs: { cli_version: '0.1.1' },
  }));

  const docsPasswordRaw = process.env['NRDOCS_DOCS_PASSWORD'];
  if (typeof docsPasswordRaw === 'string' && docsPasswordRaw.length > 0) {
    formData.append('password', docsPasswordRaw);
  }

  const result = await client.publish(formData, opts.verbose);

  if (result.ok) {
    const data = result.data as Record<string, unknown> | undefined;
    const approval = data?.['approval'] as { state?: string } | undefined;
    const serving = data?.['serving'] as { visible?: boolean; reason?: string; url?: string } | undefined;
    const access = data?.['access'] as { mode?: string } | undefined;

    console.log('Published successfully!');
    if (approval?.state) {
      console.log(`Approval: ${approval.state}`);
    }
    if (access?.mode) {
      console.log(`Access:   ${access.mode}`);
    }
    if (serving) {
      if (serving.visible) {
        console.log(`Serving:  live (${serving.reason ?? 'serving'})`);
      } else {
        console.log(`Serving:  not visible (${serving.reason ?? 'unknown'})`);
        if (serving.reason === 'awaiting_operator_approval') {
          console.log('');
          console.log('An operator must approve this repo before docs are visible.');
          console.log(`  nrdocs approve ${fullName} --access public`);
        } else if (serving.reason === 'needs_password') {
          console.log('');
          console.log('Operator must set a password before password-protected docs are served.');
          console.log(`  nrdocs password set ${fullName}`);
        }
      }
    }
    const viewUrl = serving?.url ?? `${apiUrl}/${fullName}/`;
    console.log(`View at: ${viewUrl}`);
    return;
  }

  const apiError = result.error ?? { code: 'unknown', message: 'unknown error' };
  const formatted = formatPublishFailure(apiError, {
    command: 'publish',
    apiBaseUrl: apiUrl,
    fullName,
    archiveSizeBytes: archive.length,
  });
  printFailure(formatted);
  process.exit(formatted.exitCode);
}
