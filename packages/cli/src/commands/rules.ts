import { resolveCredentials } from '../config/index.js';
import { ApiClient } from '../api-client.js';

interface RulesListOptions {
  json?: boolean;
}

interface RulesAddOptions {
  pattern?: string;
  access?: string;
  applyExisting?: boolean;
  json?: boolean;
}

interface RulesRemoveOptions {
  ruleId?: string;
  json?: boolean;
}

/**
 * Parses rules list flags.
 */
export function parseRulesListArgs(args: string[]): RulesListOptions {
  const opts: RulesListOptions = {};
  for (const arg of args) {
    if (arg === '--json') opts.json = true;
  }
  return opts;
}

/**
 * Parses rules add flags.
 */
export function parseRulesAddArgs(args: string[]): RulesAddOptions {
  const opts: RulesAddOptions = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--access' && i + 1 < args.length) {
      opts.access = args[++i];
    } else if (arg === '--apply-existing') {
      opts.applyExisting = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (!arg?.startsWith('--')) {
      positional.push(arg!);
    }
  }
  if (positional.length >= 1) opts.pattern = positional[0];
  return opts;
}

/**
 * Parses rules remove flags.
 */
export function parseRulesRemoveArgs(args: string[]): RulesRemoveOptions {
  const opts: RulesRemoveOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (!arg?.startsWith('--') && !opts.ruleId) {
      opts.ruleId = arg;
    }
  }
  return opts;
}

/**
 * Formats rules as a table.
 */
function formatRulesTable(rules: Array<Record<string, unknown>>): string {
  if (rules.length === 0) return 'No rules configured.';

  const headers = ['ID', 'PATTERN', 'ACCESS', 'ENABLED', 'PRIORITY'];
  const rows = rules.map((r) => [
    String(r['id'] ?? '-').slice(0, 8),
    String(r['pattern'] ?? '-'),
    String(r['access_mode'] ?? '-'),
    String(r['enabled'] ?? '-'),
    String(r['priority'] ?? '-'),
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length))
  );

  const header = headers.map((h, i) => h.padEnd(widths[i]!)).join('  ');
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');
  const body = rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i]!)).join('  ')).join('\n');

  return `${header}\n${separator}\n${body}`;
}

/**
 * Validates a glob pattern for auto-approval rules.
 */
function isValidPattern(pattern: string): boolean {
  // Must contain at least one character, can use * and / for org/repo patterns
  return pattern.length > 0 && pattern.length <= 200;
}

/**
 * Handles the `nrdocs rules list` command.
 */
export async function handleRulesList(args: string[]): Promise<void> {
  const opts = parseRulesListArgs(args);

  let creds;
  try {
    creds = resolveCredentials();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const client = new ApiClient(creds.api_url, creds.operator_token);
  const res = await client.listRules();

  if (!res.ok) {
    console.error(`Error: ${res.error?.message ?? 'Unknown error'}`);
    process.exit(1);
  }

  const rules = (res.data as { rules: Array<Record<string, unknown>> })?.rules ?? res.data;

  if (opts.json) {
    console.log(JSON.stringify(rules, null, 2));
  } else {
    console.log(formatRulesTable(rules as Array<Record<string, unknown>>));
  }
}

/**
 * Handles the `nrdocs rules add` command.
 * Usage: nrdocs rules add <pattern> --access public|password [--apply-existing]
 */
export async function handleRulesAdd(args: string[]): Promise<void> {
  const opts = parseRulesAddArgs(args);

  if (!opts.pattern) {
    console.error('Error: Pattern required. Usage: nrdocs rules add <pattern> --access public|password');
    process.exit(2);
  }

  if (!isValidPattern(opts.pattern)) {
    console.error('Error: Invalid pattern. Must be 1-200 characters.');
    process.exit(2);
  }

  if (!opts.access || !['public', 'password'].includes(opts.access)) {
    console.error('Error: --access is required and must be "public" or "password".');
    process.exit(2);
  }

  let creds;
  try {
    creds = resolveCredentials();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const client = new ApiClient(creds.api_url, creds.operator_token);
  const res = await client.addRule(opts.pattern, opts.access, opts.applyExisting);

  if (!res.ok) {
    console.error(`Error: ${res.error?.message ?? 'Unknown error'}`);
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(res.data, null, 2));
  } else {
    console.log(`Rule added: ${opts.pattern} → ${opts.access}`);
    if (opts.applyExisting) {
      console.log('Applied to existing matching repos.');
    }
  }
}

/**
 * Handles the `nrdocs rules remove` command.
 * Usage: nrdocs rules remove <rule-id>
 */
export async function handleRulesRemove(args: string[]): Promise<void> {
  const opts = parseRulesRemoveArgs(args);

  if (!opts.ruleId) {
    console.error('Error: Rule ID required. Usage: nrdocs rules remove <rule-id>');
    process.exit(2);
  }

  let creds;
  try {
    creds = resolveCredentials();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const client = new ApiClient(creds.api_url, creds.operator_token);
  const res = await client.removeRule(opts.ruleId);

  if (!res.ok) {
    console.error(`Error: ${res.error?.message ?? 'Unknown error'}`);
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(res.data, null, 2));
  } else {
    console.log(`Rule ${opts.ruleId} removed.`);
  }
}
