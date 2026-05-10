import { resolveCredentials } from '../config/index.js';
import { ApiClient } from '../api-client.js';

interface AccessSetOptions {
  repo?: string;
  accessMode?: string;
  json?: boolean;
}

/**
 * Parses access set flags from args.
 */
export function parseAccessSetArgs(args: string[]): AccessSetOptions {
  const opts: AccessSetOptions = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (!arg?.startsWith('--')) {
      positional.push(arg!);
    }
  }
  // Expected positional: owner/repo public|password
  if (positional.length >= 1) opts.repo = positional[0];
  if (positional.length >= 2) opts.accessMode = positional[1];
  return opts;
}

/**
 * Handles the `nrdocs access set` command.
 * Usage: nrdocs access set owner/repo public|password
 */
export async function handleAccessSet(args: string[]): Promise<void> {
  const opts = parseAccessSetArgs(args);

  if (!opts.repo) {
    console.error('Error: Repository required. Usage: nrdocs access set owner/repo public|password');
    process.exit(2);
  }

  if (!opts.accessMode || !['public', 'password'].includes(opts.accessMode)) {
    console.error('Error: Access mode required and must be "public" or "password".');
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
  const res = await client.setAccess(owner, repo, opts.accessMode);

  if (!res.ok) {
    console.error(`Error: ${res.error?.message ?? 'Unknown error'}`);
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(res.data, null, 2));
  } else {
    console.log(`Access mode for ${owner}/${repo} set to: ${opts.accessMode}`);
  }
}
