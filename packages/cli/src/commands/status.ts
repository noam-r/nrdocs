import { resolveCredentials } from '../config/index.js';
import { ApiClient } from '../api-client.js';

interface StatusOptions {
  repo?: string;
  json?: boolean;
}

/**
 * Parses status flags from args.
 */
export function parseStatusArgs(args: string[]): StatusOptions {
  const opts: StatusOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (!arg?.startsWith('--') && !opts.repo) {
      opts.repo = arg;
    }
  }
  return opts;
}

/**
 * Handles the `nrdocs status` command.
 * Usage: nrdocs status owner/repo
 */
export async function handleStatus(args: string[]): Promise<void> {
  const opts = parseStatusArgs(args);

  if (!opts.repo) {
    console.error('Error: Repository required. Usage: nrdocs status owner/repo');
    process.exit(2);
  }

  const parts = opts.repo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    console.error('Error: Repository must be in "owner/repo" format.');
    process.exit(2);
  }

  const [owner, repo] = parts as [string, string];

  let creds;
  try {
    creds = resolveCredentials();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const client = new ApiClient(creds.api_url, creds.operator_token);
  const res = await client.getRepo(owner, repo);

  if (!res.ok) {
    console.error(`Error: ${res.error?.message ?? 'Unknown error'}`);
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(res.data, null, 2));
    return;
  }

  const data = res.data as Record<string, unknown>;
  console.log(`Repository: ${owner}/${repo}`);
  console.log(`State:      ${String(data['approval_state'] ?? '-')}`);
  console.log(`Access:     ${String(data['access_mode'] ?? '-')}`);
  console.log(`Created:    ${String(data['created_at'] ?? '-')}`);
  console.log(`Updated:    ${String(data['updated_at'] ?? '-')}`);
  if (data['approved_at']) {
    console.log(`Approved:   ${String(data['approved_at'])}`);
  }
  if (data['disabled_at']) {
    console.log(`Disabled:   ${String(data['disabled_at'])}`);
  }
  if (data['last_publish_status']) {
    console.log(`Last build: ${String(data['last_publish_status'])}`);
  }
}
