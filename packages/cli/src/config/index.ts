export { getConfigDir, getConfigPath } from './paths.js';
export { createDefaultConfig, validateConfig } from './schema.js';
export type { NrdocsConfig, Profile } from './schema.js';
export { loadConfig, saveConfig, checkPermissions } from './store.js';
export {
  getProfile,
  setProfile,
  removeProfile,
  listProfiles,
  getDefaultProfileName,
  setDefaultProfile,
  resolveProfileName,
  createProfile,
  updateProfile,
  redactToken,
} from './profiles.js';
export { resolveCredentials } from './resolve.js';
export type { ResolvedCredentials, ResolveOptions } from './resolve.js';
