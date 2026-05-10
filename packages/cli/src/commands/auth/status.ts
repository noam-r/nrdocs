import {
  getProfile,
  getDefaultProfileName,
  redactToken,
  listProfiles,
} from '../../config/index.js';

interface StatusOptions {
  profile?: string;
  configDir?: string;
  json?: boolean;
}

/**
 * Handles the `nrdocs auth status` command.
 * Shows current profile info with redacted token.
 */
export function authStatus(opts: StatusOptions = {}): void {
  const profileName = opts.profile || getDefaultProfileName(opts.configDir);
  const profile = getProfile(profileName, opts.configDir);
  const allProfiles = listProfiles(opts.configDir);

  if (!profile) {
    console.error(`No profile "${profileName}" found.`);
    console.error('Run: nrdocs auth login');
    process.exitCode = 1;
    return;
  }

  if (opts.json) {
    const output = {
      profile: profileName,
      api_url: profile.api_url,
      operator_token: redactToken(profile.operator_token),
      deployment_name: profile.deployment_name ?? null,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
      is_default: profileName === getDefaultProfileName(opts.configDir),
      all_profiles: allProfiles,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Profile: ${profileName}`);
  console.log(`API URL: ${profile.api_url}`);
  console.log(`Token:   ${redactToken(profile.operator_token)}`);
  if (profile.deployment_name) {
    console.log(`Deploy:  ${profile.deployment_name}`);
  }
  console.log(`Created: ${profile.created_at}`);
  console.log(`Updated: ${profile.updated_at}`);

  if (allProfiles.length > 1) {
    console.log(`\nAll profiles: ${allProfiles.join(', ')}`);
  }
}
