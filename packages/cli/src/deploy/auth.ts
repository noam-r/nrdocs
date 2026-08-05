import { ExitCode } from '@nrdocs/contracts';
import { CliError, ioError } from '../errors.js';
import { assertSecureCredentialFile, modeBits } from '../fs-safe.js';
import { cloudflareEnvPath, type Runtime } from '../runtime.js';

export type CloudflareCredential = {
  source: 'api_token' | 'env_file' | 'wrangler_oauth';
  token: string;
};

export type CloudflareEnvFile = {
  apiToken?: string;
  accountId?: string;
  path: string;
};

export type RunCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type RunCommand = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: Record<string, string | undefined> },
) => Promise<RunCommandResult>;

/**
 * Parse operator-managed `~/.nrdocs/cloudflare.env` (KEY=VALUE lines).
 * Returns null when the file is absent. Rejects insecure modes and symlinks.
 */
export async function readCloudflareEnvFile(runtime: Runtime): Promise<CloudflareEnvFile | null> {
  const filePath = cloudflareEnvPath(runtime);
  try {
    await assertSecureCredentialFile(runtime, filePath);
  } catch (error) {
    if (error instanceof Error && /was not found/.test(error.message)) {
      return null;
    }
    throw error;
  }
  let text: string;
  try {
    text = await runtime.fs.readFile(filePath, 'utf8');
  } catch {
    throw ioError(`Unable to read Cloudflare env file:\n  ${filePath}`);
  }
  const values = parseCloudflareEnvText(text);
  return {
    path: filePath,
    ...(values.apiToken ? { apiToken: values.apiToken } : {}),
    ...(values.accountId ? { accountId: values.accountId } : {}),
  };
}

export function parseCloudflareEnvText(text: string): {
  apiToken?: string;
  accountId?: string;
} {
  let apiToken: string | undefined;
  let accountId: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const cleaned = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eq = cleaned.indexOf('=');
    if (eq <= 0) continue;
    const key = cleaned.slice(0, eq).trim();
    let value = cleaned.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === 'CLOUDFLARE_API_TOKEN' && value) apiToken = value;
    if (key === 'CLOUDFLARE_ACCOUNT_ID' && value) accountId = value;
  }
  return {
    ...(apiToken ? { apiToken } : {}),
    ...(accountId ? { accountId } : {}),
  };
}

/** Process env wins; otherwise values from `~/.nrdocs/cloudflare.env`. */
export async function resolveCloudflareAccountId(runtime: Runtime): Promise<string | undefined> {
  const pinned = runtime.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (pinned) return pinned;
  const file = await readCloudflareEnvFile(runtime);
  return file?.accountId;
}

/**
 * Resolve Cloudflare authority without writing it.
 * Order: process env → `~/.nrdocs/cloudflare.env` → Wrangler OAuth.
 */
export async function resolveCloudflareCredential(
  runtime: Runtime,
  runCommand: RunCommand,
  tempDir: string,
): Promise<CloudflareCredential> {
  const envToken = runtime.env.CLOUDFLARE_API_TOKEN?.trim();
  if (envToken) {
    return { source: 'api_token', token: envToken };
  }

  const file = await readCloudflareEnvFile(runtime);
  if (file?.apiToken) {
    return { source: 'env_file', token: file.apiToken };
  }

  const result = await runCommand('npx', ['wrangler', 'auth', 'token', '--json'], {
    cwd: tempDir,
    env: { ...runtime.env, CLOUDFLARE_API_TOKEN: undefined },
  });
  if (result.code !== 0) {
    throw new CliError({
      code: 'credential_or_authority',
      phase: 'credential',
      exit_code: ExitCode.CredentialOrAuthority,
      safe_message:
        'Unable to resolve Cloudflare authentication.\nCreate ~/.nrdocs/cloudflare.env (mode 0600), set CLOUDFLARE_API_TOKEN, or run `wrangler login`, then retry.',
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout) as unknown;
  } catch {
    throw new CliError({
      code: 'credential_or_authority',
      phase: 'credential',
      exit_code: ExitCode.CredentialOrAuthority,
      safe_message: 'Wrangler auth token output was not valid JSON.',
    });
  }
  const token = extractWranglerToken(parsed);
  if (!token) {
    throw new CliError({
      code: 'credential_or_authority',
      phase: 'credential',
      exit_code: ExitCode.CredentialOrAuthority,
      safe_message: 'Wrangler auth token JSON did not contain a usable access token.',
    });
  }
  return { source: 'wrangler_oauth', token };
}

export function extractWranglerToken(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  for (const key of ['access_token', 'oauth_token', 'api_token', 'token']) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** Exported for tests — same permission bits as publisher credential files. */
export function cloudflareEnvModeOk(mode: number): boolean {
  return modeBits(mode) === 0o600;
}
