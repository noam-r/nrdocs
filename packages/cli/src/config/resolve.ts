import { getProfile, resolveProfileName } from './profiles.js';

export interface ResolvedCredentials {
  api_url: string;
  operator_token: string;
}

export interface ResolveOptions {
  apiUrl?: string;
  token?: string;
  profile?: string;
  configDir?: string;
}

/**
 * Resolves credentials using the priority chain:
 *   CLI flags → environment variables → local config → error
 *
 * @throws Error with helpful message if credentials cannot be resolved
 */
export function resolveCredentials(opts: ResolveOptions = {}): ResolvedCredentials {
  // 1. CLI flags (highest priority)
  const flagUrl = opts.apiUrl;
  const flagToken = opts.token;

  // 2. Environment variables
  const envUrl = process.env['NRDOCS_API_URL'];
  const envToken = process.env['NRDOCS_OPERATOR_TOKEN'];

  // 3. Local config (lowest priority)
  const profileName = resolveProfileName(opts.profile, opts.configDir);
  const profile = getProfile(profileName, opts.configDir);

  const apiUrl = flagUrl || envUrl || profile?.api_url;
  const operatorToken = flagToken || envToken || profile?.operator_token;

  if (!apiUrl) {
    throw new Error(
      'No API URL configured. Provide --api-url, set NRDOCS_API_URL, or run: nrdocs auth login'
    );
  }

  if (!operatorToken) {
    throw new Error(
      'No operator token configured. Provide --token, set NRDOCS_OPERATOR_TOKEN, or run: nrdocs auth login'
    );
  }

  return { api_url: apiUrl, operator_token: operatorToken };
}
