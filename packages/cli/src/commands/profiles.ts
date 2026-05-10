import {
  listProfiles,
  getDefaultProfileName,
  setDefaultProfile,
  getProfile,
} from '../config/index.js';

interface ProfilesListOptions {
  json?: boolean;
}

/**
 * Parses profiles list flags.
 */
export function parseProfilesListArgs(args: string[]): ProfilesListOptions {
  const opts: ProfilesListOptions = {};
  for (const arg of args) {
    if (arg === '--json') opts.json = true;
  }
  return opts;
}

/**
 * Handles the `nrdocs profiles list` command.
 */
export function handleProfilesList(args: string[]): void {
  const opts = parseProfilesListArgs(args);
  const profiles = listProfiles();
  const defaultName = getDefaultProfileName();

  if (opts.json) {
    const output = profiles.map((name) => ({
      name,
      is_default: name === defaultName,
      api_url: getProfile(name)?.api_url ?? null,
    }));
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (profiles.length === 0) {
    console.log('No profiles configured. Run: nrdocs auth login');
    return;
  }

  console.log('Profiles:');
  for (const name of profiles) {
    const marker = name === defaultName ? ' *' : '';
    const profile = getProfile(name);
    const url = profile?.api_url ?? 'not set';
    console.log(`  ${name}${marker}  (${url})`);
  }
  console.log('');
  console.log('* = default profile');
}

/**
 * Handles the `nrdocs profiles use` command.
 * Usage: nrdocs profiles use <name>
 */
export function handleProfilesUse(args: string[]): void {
  const name = args.find((a) => !a.startsWith('--'));

  if (!name) {
    console.error('Error: Profile name required. Usage: nrdocs profiles use <name>');
    process.exitCode = 1;
    return;
  }

  const profile = getProfile(name);
  if (!profile) {
    console.error(`Error: Profile "${name}" not found.`);
    console.error(`Available profiles: ${listProfiles().join(', ') || 'none'}`);
    process.exitCode = 1;
    return;
  }

  setDefaultProfile(name);
  console.log(`Default profile set to "${name}".`);
}
