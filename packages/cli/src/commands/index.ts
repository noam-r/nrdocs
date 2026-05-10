import { authLogin } from './auth/login.js';
import { authStatus } from './auth/status.js';
import { authLogout } from './auth/logout.js';
import { handleInit } from './init.js';
import { handlePublish } from './publish.js';
import { handleDoctor } from './doctor.js';
import { handleDeploy } from './deploy.js';
import { handleRepos } from './repos.js';
import { handleApprove } from './approve.js';
import { handleDisable } from './disable.js';
import { handleAccessSet } from './access.js';
import { handlePasswordSet } from './password.js';
import { handleRulesList, handleRulesAdd, handleRulesRemove } from './rules.js';
import { handleStatus } from './status.js';
import { handleConfigShow } from './config-show.js';
import { handleProfilesList, handleProfilesUse } from './profiles.js';

/**
 * Routes CLI arguments to the appropriate command handler.
 */
export async function runCommand(args: string[]): Promise<void> {
  const cmd = args[0];
  const subCmd = args[1];
  const rest = args.slice(1);

  switch (cmd) {
    // Repo-owner commands
    case 'init':
      await handleInit(rest);
      break;

    case 'publish':
      await handlePublish(rest);
      break;

    case 'doctor':
      await handleDoctor(rest);
      break;

    case 'deploy':
      await handleDeploy(rest);
      break;

    // Auth commands
    case 'auth':
      switch (subCmd) {
        case 'login':
          await authLogin(parseAuthFlags(args.slice(2)));
          break;
        case 'status':
          authStatus(parseAuthStatusFlags(args.slice(2)));
          break;
        case 'logout':
          authLogout(parseAuthLogoutFlags(args.slice(2)));
          break;
        default:
          console.error('Usage: nrdocs auth <login|status|logout>');
          process.exitCode = 1;
      }
      break;

    // Operator commands
    case 'repos':
      await handleRepos(rest);
      break;

    case 'approve':
      await handleApprove(rest);
      break;

    case 'disable':
      await handleDisable(rest);
      break;

    case 'access':
      if (subCmd === 'set') {
        await handleAccessSet(args.slice(2));
      } else {
        console.error('Usage: nrdocs access set <owner/repo> <public|password>');
        process.exitCode = 1;
      }
      break;

    case 'password':
      if (subCmd === 'set') {
        await handlePasswordSet(args.slice(2));
      } else {
        console.error('Usage: nrdocs password set <owner/repo> [--from-stdin]');
        process.exitCode = 1;
      }
      break;

    case 'rules':
      switch (subCmd) {
        case 'list':
          await handleRulesList(args.slice(2));
          break;
        case 'add':
          await handleRulesAdd(args.slice(2));
          break;
        case 'remove':
          await handleRulesRemove(args.slice(2));
          break;
        default:
          console.error('Usage: nrdocs rules <list|add|remove>');
          process.exitCode = 1;
      }
      break;

    case 'status':
      await handleStatus(rest);
      break;

    // Config commands
    case 'config':
      if (subCmd === 'show') {
        handleConfigShow(args.slice(2));
      } else {
        console.error('Usage: nrdocs config show');
        process.exitCode = 1;
      }
      break;

    case 'profiles':
      switch (subCmd) {
        case 'list':
          handleProfilesList(args.slice(2));
          break;
        case 'use':
          handleProfilesUse(args.slice(2));
          break;
        default:
          console.error('Usage: nrdocs profiles <list|use>');
          process.exitCode = 1;
      }
      break;

    default:
      console.error(`Unknown command: ${cmd ?? ''}`);
      console.error('Run nrdocs --help for usage.');
      process.exitCode = 1;
  }
}

/**
 * Parses auth login flags from raw args.
 */
function parseAuthFlags(args: string[]): { apiUrl?: string; token?: string; profile?: string } {
  const opts: { apiUrl?: string; token?: string; profile?: string } = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--api-url' && i + 1 < args.length) {
      opts.apiUrl = args[++i];
    } else if (arg === '--token' && i + 1 < args.length) {
      opts.token = args[++i];
    } else if (arg === '--profile' && i + 1 < args.length) {
      opts.profile = args[++i];
    }
  }
  return opts;
}

/**
 * Parses auth status flags.
 */
function parseAuthStatusFlags(args: string[]): { profile?: string; json?: boolean } {
  const opts: { profile?: string; json?: boolean } = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--profile' && i + 1 < args.length) {
      opts.profile = args[++i];
    } else if (arg === '--json') {
      opts.json = true;
    }
  }
  return opts;
}

/**
 * Parses auth logout flags.
 */
function parseAuthLogoutFlags(args: string[]): { profile?: string; removeAll?: boolean } {
  const opts: { profile?: string; removeAll?: boolean } = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--profile' && i + 1 < args.length) {
      opts.profile = args[++i];
    } else if (arg === '--remove-all') {
      opts.removeAll = true;
    }
  }
  return opts;
}
