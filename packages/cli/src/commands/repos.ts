import { resolveCredentials } from '../config/index.js';
import { ApiClient } from '../api-client.js';

interface ReposOptions {
  state?: string;
  owner?: string;
  json?: boolean;
}

/**
 * Parses repos flags from args.
 */
export function parseReposArgs(args: string[]): ReposOptions {
  const opts: ReposOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--pending') {
      opts.state = 'pending';
    } else if (arg === '--approved') {
      opts.state = 'approved';
    } else if (arg === '--disabled') {
      opts.state = 'disabled';
    } else if (arg === '--owner' && i + 1 < args.length) {
      opts.owner = args[++i];
    } else if (arg === '--json') {
      opts.json = true;
    }
  }
  return opts;
}

/**
 * Formats repos as a table for human-readable output.
 */
function formatTable(repos: Array<Record<string, unknown>>): string {
  if (repos.length === 0) return 'No repos found.';

  const headers = ['REPO', 'STATE', 'ACCESS', 'UPDATED'];
  const rows = repos.map((r) => [
    String(r['full_name'] ?? `${r['owner']}/${r['name']}`),
    String(r['approval_state'] ?? '-'),
    String(r['access_mode'] ?? '-'),
    String(r['updated_at'] ?? '-').slice(0, 10),
  ]);

  // Calculate column widths
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length))
  );

  const header = headers.map((h, i) => h.padEnd(widths[i]!)).join('  ');
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');
  const body = rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i]!)).join('  ')).join('\n');

  return `${header}\n${separator}\n${body}`;
}

/**
 * Handles the `nrdocs repos` command.
 */
export async function handleRepos(args: string[]): Promise<void> {
  const opts = parseReposArgs(args);

  let creds;
  try {
    creds = resolveCredentials();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const client = new ApiClient(creds.api_url, creds.operator_token);
  const res = await client.listRepos({ state: opts.state, owner: opts.owner });

  if (!res.ok) {
    console.error(`Error: ${res.error?.message ?? 'Unknown error'}`);
    process.exit(1);
  }

  const repos = (res.data as { repos: Array<Record<string, unknown>> })?.repos ?? res.data;

  if (opts.json) {
    console.log(JSON.stringify(repos, null, 2));
  } else {
    console.log(formatTable(repos as Array<Record<string, unknown>>));
  }
}
