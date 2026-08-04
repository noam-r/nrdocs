import { ExitCode } from '@nrdocs/contracts';
import { CliError } from '../errors.js';
import type { Runtime } from '../runtime.js';

export type CloudflareCredential = {
  source: 'api_token' | 'wrangler_oauth';
  token: string;
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
 * Resolve Cloudflare authority without storing it.
 * Non-empty CLOUDFLARE_API_TOKEN wins exclusively; otherwise Wrangler OAuth.
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
        'Unable to resolve Cloudflare authentication.\nSet CLOUDFLARE_API_TOKEN or run `wrangler login`, then retry.',
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
