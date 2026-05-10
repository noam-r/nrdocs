import { resolveCredentials } from '../config/index.js';
import { ApiClient } from '../api-client.js';

interface ApproveOptions {
  repo?: string;
  access?: string;
  json?: boolean;
}

/**
 * Parses approve flags from args.
 */
export function parseApproveArgs(args: string[]): ApproveOptions {
  const opts: ApproveOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--access' && i + 1 < args.length) {
      opts.access = args[++i];
    } else if (arg === '--json') {
      opts.json = true;
    } else if (!arg?.startsWith('--') && !opts.repo) {
      opts.repo = arg;
    }
  }
  return opts;
}

/**
 * Handles the `nrdocs approve` command.
 * Usage: nrdocs approve owner/repo --access public|password
 */
export async function handleApprove(args: string[]): Promise<void> {
  const opts = parseApproveArgs(args);

  if (!opts.repo) {
    console.error('Error: Repository required. Usage: nrdocs approve owner/repo --access public|password');
    process.exit(2);
  }

  if (!opts.access || !['public', 'password'].includes(opts.access)) {
    console.error('Error: --access is required and must be "public" or "password".');
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
  const res = await client.approveRepo(owner, repo, opts.access);

  if (!res.ok) {
    console.error(`Error: ${res.error?.message ?? 'Unknown error'}`);
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(res.data, null, 2));
  } else {
    console.log(`Approved ${owner}/${repo} with access mode: ${opts.access}`);
  }
}
