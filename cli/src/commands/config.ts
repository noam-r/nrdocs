import { CliUsageError } from '../cli-usage-error';
import { clearDefaultApiUrl, getDefaultApiUrl, setDefaultApiUrl } from '../global-state';

function fail(message: string): never {
  throw new CliUsageError(message);
}

export function printConfigHelp(): void {
  console.log(`nrdocs config

Usage:
  nrdocs config set api-url <url>
  nrdocs config get api-url
  nrdocs config clear api-url

Stores non-secret CLI defaults under ~/.nrdocs (override dir for tests: NRDOCS_GLOBAL_STATE_DIR).

Notes:
  - This does not store credentials.
  - CLI flags and repo-local .nrdocs/status.json override global defaults.`);
}

export async function runConfig(args: string[]): Promise<void> {
  const sub = args[0];
  const key = args[1];

  if (
    args.length === 0 ||
    sub === 'help' ||
    sub === '--help' ||
    sub === '-h'
  ) {
    printConfigHelp();
    return;
  }

  if (sub !== 'set' && sub !== 'get' && sub !== 'clear') {
    fail(`Unknown config subcommand '${sub}'. Run: nrdocs config --help`);
  }

  if (key !== 'api-url') {
    fail(`Unknown config key '${key ?? ''}'. Supported keys: api-url`);
  }

  if (sub === 'get') {
    const url = getDefaultApiUrl();
    if (!url) {
      console.log('<unset>');
      return;
    }
    console.log(url);
    return;
  }

  if (sub === 'clear') {
    clearDefaultApiUrl();
    console.log('Cleared default api-url.');
    return;
  }

  // set
  const value = args[2];
  if (!value) {
    fail('Missing value. Usage: nrdocs config set api-url <url>');
  }
  if (!/^https?:\/\//i.test(value.trim())) {
    fail('Invalid api-url: expected http(s) URL.');
  }
  setDefaultApiUrl(value);
  console.log('Set default api-url.');
}

