import { resolveCredentials } from '../config/index.js';
import { ApiClient } from '../api-client.js';

interface DisableOptions {
  repo?: string;
  reason?: string;
  json?: boolean;
}

/**
 * Parses disable flags from args.
 */
export function parseDisableArgs(args: string[]): DisableOptions {
  const opts: DisableOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--reason' && i + 1 < args.length) {
      opts.reason = args[++i];
    } else if (arg === '--json') {
      opts.json = true;
    } else if (!arg?.startsWith('--') && !opts.repo) {
      opts.repo = arg;
    }
  }
  return opts;
}

/**
 * Handles the `nrdocs disable` command.
 * Usage: nrdocs disable owner/repo [--reason "..."]
 */
export async function handleDisable(args: string[]): Promise<void> {
  const opts = parseDisableArgs(args);

  if (!opts.repo) {
    console.error('Error: Repository required. Usage: nrdocs disable owner/repo [--reason "..."]');
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
  const res = await client.disableRepo(owner, repo, opts.reason);

  if (!res.ok) {
    console.error(`Error: ${res.error?.message ?? 'Unknown error'}`);
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(res.data, null, 2));
  } else {
    console.log(`Disabled ${owner}/${repo}${opts.reason ? ` (reason: ${opts.reason})` : ''}`);
  }
}
