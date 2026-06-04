import * as readline from 'node:readline';
import { resolveCredentials } from '../config/index.js';
import { ApiClient } from '../api-client.js';

interface PasswordSetOptions {
  repo?: string;
  fromStdin?: boolean;
  json?: boolean;
}

interface PasswordAllowOptions {
  repo?: string;
  json?: boolean;
}

/**
 * Parses password set flags from args.
 */
export function parsePasswordSetArgs(args: string[]): PasswordSetOptions {
  const opts: PasswordSetOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--from-stdin') {
      opts.fromStdin = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (!arg?.startsWith('--') && !opts.repo) {
      opts.repo = arg;
    }
  }
  return opts;
}

/**
 * Reads password from stdin (for piped input).
 */
async function readFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}

/**
 * Prompts for password interactively (no echo).
 */
async function promptPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    const origWrite = process.stdout.write.bind(process.stdout);
    let maskInput = false;

    process.stdout.write = ((
      chunk: string | Uint8Array,
      encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
      cb?: (err?: Error | null) => void,
    ) => {
      if (maskInput && typeof chunk === 'string' && chunk !== '\n' && chunk !== '\r\n') {
        if (typeof encodingOrCb === 'function') encodingOrCb();
        else if (typeof cb === 'function') cb();
        return true;
      }
      return origWrite(chunk, encodingOrCb as BufferEncoding, cb);
    }) as typeof process.stdout.write;

    rl.question(question, (answer) => {
      maskInput = false;
      process.stdout.write = origWrite;
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });

    // readline writes the prompt synchronously; mask only subsequent keystrokes
    setImmediate(() => {
      maskInput = true;
    });
  });
}

/**
 * Handles the `nrdocs password set` command.
 * Usage: nrdocs password set owner/repo [--from-stdin]
 */
export async function handlePasswordSet(args: string[]): Promise<void> {
  const opts = parsePasswordSetArgs(args);

  if (!opts.repo) {
    console.error('Error: Repository required. Usage: nrdocs password set owner/repo [--from-stdin]');
    process.exit(2);
  }

  const parts = opts.repo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    console.error('Error: Repository must be in "owner/repo" format.');
    process.exit(2);
  }

  const [owner, repo] = parts as [string, string];

  // Get password
  let password: string;
  if (opts.fromStdin) {
    password = await readFromStdin();
  } else {
    password = await promptPassword('New password: ');
    if (!password) {
      console.error('Error: Password cannot be empty.');
      process.exit(2);
    }
    const confirm = await promptPassword('Confirm password: ');
    if (password !== confirm) {
      console.error('Error: Passwords do not match.');
      process.exit(2);
    }
  }

  if (!password) {
    console.error('Error: Password cannot be empty.');
    process.exit(2);
  }

  if (password.length < 8) {
    console.error('Error: Password must be at least 8 characters.');
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
  const res = await client.setPassword(owner, repo, password);

  if (!res.ok) {
    console.error(`Error: ${res.error?.message ?? 'Unknown error'}`);
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(res.data, null, 2));
  } else {
    console.log(`Password set for ${owner}/${repo}.`);
  }
}


/**
 * Parses password allow flags from args.
 */
export function parsePasswordAllowArgs(args: string[]): PasswordAllowOptions {
  const opts: PasswordAllowOptions = {};
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
 * Parses password disallow flags from args.
 */
export function parsePasswordDisallowArgs(args: string[]): PasswordAllowOptions {
  return parsePasswordAllowArgs(args);
}

/**
 * Handles the `nrdocs password allow` command.
 * Usage: nrdocs password allow owner/repo
 */
export async function handlePasswordAllow(args: string[]): Promise<void> {
  const opts = parsePasswordAllowArgs(args);

  if (!opts.repo) {
    console.error('Error: Repository required. Usage: nrdocs password allow owner/repo');
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
  const res = await client.setSelfPasswordAllow(owner, repo, true);

  if (!res.ok) {
    console.error(`Error: ${res.error?.message ?? 'Unknown error'}`);
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(res.data, null, 2));
  } else {
    console.log(`Self-service password enabled for ${owner}/${repo}.`);
  }
}

/**
 * Handles the `nrdocs password disallow` command.
 * Usage: nrdocs password disallow owner/repo
 */
export async function handlePasswordDisallow(args: string[]): Promise<void> {
  const opts = parsePasswordDisallowArgs(args);

  if (!opts.repo) {
    console.error('Error: Repository required. Usage: nrdocs password disallow owner/repo');
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
  const res = await client.setSelfPasswordAllow(owner, repo, false);

  if (!res.ok) {
    console.error(`Error: ${res.error?.message ?? 'Unknown error'}`);
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(res.data, null, 2));
  } else {
    console.log(`Self-service password disabled for ${owner}/${repo}.`);
  }
}
