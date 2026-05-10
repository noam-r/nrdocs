/**
 * Schema types for the nrdocs CLI config file.
 */

export interface Profile {
  api_url: string;
  operator_token: string;
  deployment_name?: string;
  created_at: string;
  updated_at: string;
}

export interface NrdocsConfig {
  version: 1;
  default_profile: string;
  profiles: Record<string, Profile>;
}

/**
 * Creates a new empty config with default structure.
 */
export function createDefaultConfig(): NrdocsConfig {
  return {
    version: 1,
    default_profile: 'default',
    profiles: {},
  };
}

/**
 * Validates that a parsed object conforms to the NrdocsConfig shape.
 * Returns the config if valid, throws otherwise.
 */
export function validateConfig(data: unknown): NrdocsConfig {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Config file is not a valid JSON object');
  }

  const obj = data as Record<string, unknown>;

  if (obj['version'] !== 1) {
    throw new Error(`Unsupported config version: ${String(obj['version'])}`);
  }

  if (typeof obj['default_profile'] !== 'string') {
    throw new Error('Config missing "default_profile" field');
  }

  if (typeof obj['profiles'] !== 'object' || obj['profiles'] === null) {
    throw new Error('Config missing "profiles" field');
  }

  return data as NrdocsConfig;
}
