import { loadConfig, saveConfig } from './store.js';
import type { Profile } from './schema.js';

/**
 * Gets a profile by name. Returns undefined if not found.
 */
export function getProfile(name: string, overrideDir?: string): Profile | undefined {
  const config = loadConfig(overrideDir);
  return config.profiles[name];
}

/**
 * Sets (creates or updates) a profile.
 */
export function setProfile(name: string, profile: Profile, overrideDir?: string): void {
  const config = loadConfig(overrideDir);
  config.profiles[name] = profile;
  saveConfig(config, overrideDir);
}

/**
 * Removes a profile by name. Returns true if removed, false if not found.
 */
export function removeProfile(name: string, overrideDir?: string): boolean {
  const config = loadConfig(overrideDir);
  if (!(name in config.profiles)) {
    return false;
  }
  delete config.profiles[name];
  saveConfig(config, overrideDir);
  return true;
}

/**
 * Lists all profile names.
 */
export function listProfiles(overrideDir?: string): string[] {
  const config = loadConfig(overrideDir);
  return Object.keys(config.profiles);
}

/**
 * Gets the default profile name from config.
 */
export function getDefaultProfileName(overrideDir?: string): string {
  const config = loadConfig(overrideDir);
  return config.default_profile;
}

/**
 * Sets the default profile name.
 */
export function setDefaultProfile(name: string, overrideDir?: string): void {
  const config = loadConfig(overrideDir);
  config.default_profile = name;
  saveConfig(config, overrideDir);
}

/**
 * Resolves which profile name to use given an optional override.
 */
export function resolveProfileName(override?: string, overrideDir?: string): string {
  if (override) return override;
  return getDefaultProfileName(overrideDir);
}

/**
 * Helper to create a new profile with timestamps.
 */
export function createProfile(apiUrl: string, operatorToken: string, deploymentName?: string): Profile {
  const now = new Date().toISOString();
  return {
    api_url: apiUrl,
    operator_token: operatorToken,
    deployment_name: deploymentName,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Helper to update an existing profile, preserving created_at.
 */
export function updateProfile(existing: Profile, updates: Partial<Pick<Profile, 'api_url' | 'operator_token' | 'deployment_name'>>): Profile {
  return {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Redacts a token for display purposes.
 * Shows first 10 chars + "..." if longer than 14 chars, otherwise "****".
 */
export function redactToken(token: string): string {
  if (token.length > 14) {
    return token.slice(0, 10) + '...';
  }
  return '****';
}
