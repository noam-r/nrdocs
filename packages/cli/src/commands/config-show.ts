import { loadConfig, getConfigPath, redactToken } from '../config/index.js';

interface ConfigShowOptions {
  json?: boolean;
}

/**
 * Parses config show flags.
 */
export function parseConfigShowArgs(args: string[]): ConfigShowOptions {
  const opts: ConfigShowOptions = {};
  for (const arg of args) {
    if (arg === '--json') opts.json = true;
  }
  return opts;
}

/**
 * Handles the `nrdocs config show` command.
 * Shows the current configuration with redacted tokens.
 */
export function handleConfigShow(args: string[]): void {
  const opts = parseConfigShowArgs(args);

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error(`Error loading config: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
    return;
  }

  const configPath = getConfigPath();

  if (opts.json) {
    // Redact tokens in JSON output
    const redacted = {
      ...config,
      profiles: Object.fromEntries(
        Object.entries(config.profiles).map(([name, profile]) => [
          name,
          { ...profile, operator_token: redactToken(profile.operator_token) },
        ])
      ),
    };
    console.log(JSON.stringify({ path: configPath, config: redacted }, null, 2));
    return;
  }

  console.log(`Config file: ${configPath}`);
  console.log(`Default profile: ${config.default_profile}`);
  console.log('');

  const profileNames = Object.keys(config.profiles);
  if (profileNames.length === 0) {
    console.log('No profiles configured. Run: nrdocs auth login');
    return;
  }

  console.log('Profiles:');
  for (const name of profileNames) {
    const profile = config.profiles[name]!;
    const isDefault = name === config.default_profile ? ' (default)' : '';
    console.log(`  ${name}${isDefault}`);
    console.log(`    API URL: ${profile.api_url}`);
    console.log(`    Token:   ${redactToken(profile.operator_token)}`);
    if (profile.deployment_name) {
      console.log(`    Deploy:  ${profile.deployment_name}`);
    }
  }
}
