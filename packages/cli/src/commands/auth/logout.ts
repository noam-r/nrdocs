import {
  getProfile,
  setProfile,
  updateProfile,
  removeProfile,
  getDefaultProfileName,
} from '../../config/index.js';

interface LogoutOptions {
  profile?: string;
  configDir?: string;
  /** If true, removes the entire profile instead of just clearing the token */
  removeAll?: boolean;
}

/**
 * Handles the `nrdocs auth logout` command.
 * Removes the operator token from the profile (or removes the entire profile).
 */
export function authLogout(opts: LogoutOptions = {}): void {
  const profileName = opts.profile || getDefaultProfileName(opts.configDir);
  const profile = getProfile(profileName, opts.configDir);

  if (!profile) {
    console.error(`No profile "${profileName}" found.`);
    process.exitCode = 1;
    return;
  }

  if (opts.removeAll) {
    removeProfile(profileName, opts.configDir);
    console.log(`Profile "${profileName}" removed.`);
    return;
  }

  // Clear the token but keep the profile
  const updated = updateProfile(profile, { operator_token: '' });
  setProfile(profileName, updated, opts.configDir);
  console.log(`Token removed from profile "${profileName}".`);
  console.log('You will need to run "nrdocs auth login" to authenticate again.');
}
