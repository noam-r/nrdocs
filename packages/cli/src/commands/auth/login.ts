import * as readline from 'node:readline';
import {
  getProfile,
  setProfile,
  createProfile,
  updateProfile,
  setDefaultProfile,
} from '../../config/index.js';

interface LoginOptions {
  apiUrl?: string;
  token?: string;
  profile?: string;
  configDir?: string;
}

/**
 * Prompts for a value from stdin if not provided.
 */
async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Handles the `nrdocs auth login` command.
 * Prompts for API URL and operator token, validates (placeholder), and saves profile.
 */
export async function authLogin(opts: LoginOptions = {}): Promise<void> {
  const profileName = opts.profile || 'default';

  const apiUrl = opts.apiUrl || await prompt('API URL: ');
  if (!apiUrl) {
    console.error('Error: API URL is required.');
    process.exitCode = 1;
    return;
  }

  const token = opts.token || await prompt('Operator token: ');
  if (!token) {
    console.error('Error: Operator token is required.');
    process.exitCode = 1;
    return;
  }

  // Placeholder validation — in later phases this will call the API
  // to verify the token is valid.
  if (!token.startsWith('nrdocs_op_')) {
    console.warn('Warning: Token does not match expected format (nrdocs_op_...).');
    console.warn('Saving anyway — validation will be added in a future release.');
  }

  const existing = getProfile(profileName, opts.configDir);
  if (existing) {
    const updated = updateProfile(existing, {
      api_url: apiUrl,
      operator_token: token,
    });
    setProfile(profileName, updated, opts.configDir);
  } else {
    const profile = createProfile(apiUrl, token);
    setProfile(profileName, profile, opts.configDir);
  }

  setDefaultProfile(profileName, opts.configDir);

  console.log(`Credentials saved to profile "${profileName}".`);
  console.log(`Default profile set to "${profileName}".`);
}
