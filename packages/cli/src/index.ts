/**
 * Published `nrdocs` CLI package.
 */
import { CONTRACTS_PACKAGE, ExitCode } from '@nrdocs/contracts';
import { PERSISTENCE_PACKAGE } from '@nrdocs/persistence';
import { RENDERER_PACKAGE } from '@nrdocs/renderer';
import { peelGlobals, REMOVED_TOP_LEVEL } from './argv.js';
import { CLI_PACKAGE, CLI_VERSION, ROOT_HELP } from './help.js';
import {
  rootHelp,
  runCredentialsCommand,
  runInstanceCommand,
  runStubCommand,
  type CommandContext,
} from './dispatch.js';
import { runGenerateNavCommand } from './generate-nav.js';
import { runPreviewCommand } from './preview.js';
import { runDeployCommand, type DeployOptions } from './deploy.js';
import { presentError, presentHumanSuccess } from './present.js';
import { assertSupportedPlatform, createProcessRuntime, type Runtime } from './runtime.js';
import { createRejectingTerminal, type Terminal } from './terminal.js';
import { usageError } from './errors.js';

export { CLI_PACKAGE, CLI_VERSION };
export { createProcessRuntime };
export type { Runtime, Terminal };

export function cliDependencies(): {
  contracts: string;
  persistence: string;
  renderer: string;
} {
  return {
    contracts: CONTRACTS_PACKAGE,
    persistence: PERSISTENCE_PACKAGE,
    renderer: RENDERER_PACKAGE,
  };
}

export type RunOptions = {
  runtime?: Runtime;
  terminal?: Terminal;
  deploy?: DeployOptions;
};

async function dispatch(
  ctx: CommandContext,
  rest: string[],
  deployOptions?: DeployOptions,
): Promise<void> {
  if (rest.length === 0) {
    if (ctx.help) {
      rootHelp(ctx.runtime);
      return;
    }
    throw usageError('Missing command.', `Run: nrdocs --help`);
  }

  const [head, ...tail] = rest;
  if (REMOVED_TOP_LEVEL.has(head!)) {
    throw usageError(`Unknown command: ${head}`);
  }

  switch (head) {
    case 'credentials':
      await runCredentialsCommand(ctx, tail);
      return;
    case 'instance':
      await runInstanceCommand(ctx, tail);
      return;
    case 'connect':
      await runStubCommand('connect', ctx);
      return;
    case 'publish':
      await runStubCommand('publish', ctx);
      return;
    case 'preview':
      await runPreviewCommand(ctx, tail);
      return;
    case 'generate': {
      if (tail[0] === 'nav' || ctx.help) {
        await runGenerateNavCommand(ctx, tail[0] === 'nav' ? tail.slice(1) : tail);
        return;
      }
      throw usageError('Unknown generate command.', 'Run: nrdocs generate nav --help');
    }
    case 'deploy':
      await runDeployCommand(ctx, tail, deployOptions ?? {});
      return;
    case 'site': {
      const sub = tail[0];
      if (!sub && ctx.help) {
        presentHumanSuccess(ctx.runtime, ROOT_HELP);
        return;
      }
      if (sub === 'password' && tail[1] === 'change') {
        await runStubCommand('site password change', ctx);
        return;
      }
      if (
        sub === 'create' ||
        sub === 'list' ||
        sub === 'show' ||
        sub === 'access' ||
        sub === 'enable' ||
        sub === 'disable' ||
        sub === 'rename' ||
        sub === 'delete'
      ) {
        await runStubCommand(`site ${sub}`, ctx);
        return;
      }
      throw usageError(`Unknown site command: ${sub ?? '(missing)'}`, 'Run: nrdocs --help');
    }
    case 'token': {
      const sub = tail[0];
      if (sub === 'issue' || sub === 'list' || sub === 'revoke') {
        await runStubCommand(`token ${sub}`, ctx);
        return;
      }
      throw usageError(`Unknown token command: ${sub ?? '(missing)'}`, 'Run: nrdocs --help');
    }
    default:
      throw usageError(`Unknown command: ${head}`, 'Run: nrdocs --help');
  }
}

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  options: RunOptions = {},
): Promise<number> {
  const runtime = options.runtime ?? createProcessRuntime();
  const terminal = options.terminal ?? createRejectingTerminal();
  let json = false;

  try {
    assertSupportedPlatform(runtime);
    const { globals, rest } = peelGlobals(argv);
    json = globals.json;

    if (globals.version) {
      presentHumanSuccess(runtime, `${CLI_PACKAGE} ${CLI_VERSION}`);
      if (globals.help && rest.length === 0) {
        rootHelp(runtime);
      }
      if (rest.length === 0) return ExitCode.Success;
    }

    const head = rest[0];
    if (
      globals.instance !== undefined &&
      (head === 'connect' ||
        head === 'publish' ||
        head === 'preview' ||
        head === 'generate' ||
        head === 'credentials')
    ) {
      throw usageError('--instance is only valid on administrative commands.');
    }

    const ctx: CommandContext = {
      runtime,
      terminal,
      json: globals.json,
      help: globals.help,
      ...(globals.instance !== undefined ? { instance: globals.instance } : {}),
    };

    if (globals.help && rest.length === 0) {
      rootHelp(runtime);
      return ExitCode.Success;
    }

    await dispatch(ctx, rest, options.deploy);
    return ExitCode.Success;
  } catch (error) {
    return presentError(runtime, error, { json });
  }
}

/** CLI entry used by bin and tests. */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  options: RunOptions = {},
): Promise<number> {
  return runCli(argv, options);
}

export { peelGlobals, parseFlags } from './argv.js';
export { loadNrdocsConfig, resolvePublicationDirectory } from './config.js';
export {
  readEnvCredentialPair,
  resolvePublisherCredential,
  writePublisherCredential,
  listPublisherCredentials,
  removePublisherCredential,
} from './credentials-store.js';
export {
  writeInstanceDescriptor,
  writeActiveInstanceId,
  listInstanceDescriptors,
  readInstanceDescriptor,
  resolveTargetInstanceId,
} from './instance-store.js';
export {
  requireInteractiveTerminal,
  confirmOrDecline,
  confirmPhraseOrDecline,
  isPublisherCiMode,
  createRejectingTerminal,
} from './terminal.js';
export { CliError } from './errors.js';
export { REMOVED_1X_COMMANDS } from './help.js';
export { atomicWriteFile, assertRealDirectory, modeBits } from './fs-safe.js';
export { ExitCode } from '@nrdocs/contracts';
export {
  runPreviewCommand,
  PREVIEW_PLACEHOLDER_SITE_ID,
  listenPreviewServer,
  summarizeManifest,
} from './preview.js';
export type { PreviewServer, PreviewCommandOptions } from './preview.js';
export {
  PREVIEW_PORT_START,
  PREVIEW_PORT_END,
  normalizeRequestPath,
  attachmentContentDisposition,
} from './preview-server.js';
export {
  applyMigrations,
  createD1HttpExecutor,
  createSqliteExecutor,
  openMemorySqlite,
} from './persistence-adapter.js';
export type { D1HttpQueryClient, SqlExecutor } from './persistence-adapter.js';
export { runDeployCommand, createFakeCloudflare } from './deploy.js';
export type { DeployOptions } from './deploy.js';
export { extractWranglerToken } from './deploy/auth.js';
export { parseAccountsResult, classifyCfError } from './deploy/parsers.js';
export { generateResourceSuffix, plannedResourceNames } from './deploy/names.js';
