/**
 * Published `nrdocs` CLI package.
 */
import { CONTRACTS_PACKAGE, ExitCode } from '@nrdocs/contracts';
import { PERSISTENCE_PACKAGE } from '@nrdocs/persistence';
import { RENDERER_PACKAGE } from '@nrdocs/renderer';
import { peelGlobals, REMOVED_TOP_LEVEL, removedTopLevelError } from './argv.js';
import { CLI_PACKAGE, CLI_VERSION } from './help.js';
import {
  rootHelp,
  runCredentialsCommand,
  runInstanceCommand,
  type CommandContext,
  type InstanceDeleteOptions,
} from './dispatch.js';
import { runGenerateNavCommand } from './generate-nav.js';
import { runPreviewCommand } from './preview.js';
import { runDeployCommand, type DeployOptions } from './deploy.js';
import { runAdminSiteCommand, runAdminTokenCommand, type AdminOptions } from './admin.js';
import { runConnectCommand, type ConnectOptions } from './connect.js';
import { runPublishCommand, type PublishOptions } from './publish.js';
import { presentError, presentHumanSuccess } from './present.js';
import {
  assertSupportedNode,
  assertSupportedPlatform,
  createProcessRuntime,
  MIN_NODE_MAJOR,
  type Runtime,
} from './runtime.js';
import { createProcessTerminal, type Terminal } from './terminal.js';
import { usageError } from './errors.js';

export { CLI_PACKAGE, CLI_VERSION };
export { createProcessRuntime, assertSupportedNode, MIN_NODE_MAJOR };
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
  admin?: AdminOptions;
  instanceDelete?: InstanceDeleteOptions;
  publisher?: ConnectOptions & PublishOptions;
  /** Test seam; production uses `process.versions.node`. */
  nodeVersion?: string;
};

async function dispatch(
  ctx: CommandContext,
  rest: string[],
  options: {
    deploy?: DeployOptions;
    admin?: AdminOptions;
    instanceDelete?: InstanceDeleteOptions;
    publisher?: ConnectOptions & PublishOptions;
  } = {},
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
    throw removedTopLevelError(head!);
  }

  switch (head) {
    case 'credentials':
      await runCredentialsCommand(ctx, tail);
      return;
    case 'instance':
      await runInstanceCommand(ctx, tail, options.instanceDelete ?? {});
      return;
    case 'connect':
      await runConnectCommand(ctx, tail, {
        ...(options.publisher ?? {}),
        ...(options.admin ?? {}),
      });
      return;
    case 'publish':
      await runPublishCommand(ctx, tail, {
        ...(options.publisher ?? {}),
        ...(options.admin ?? {}),
      });
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
      await runDeployCommand(ctx, tail, options.deploy ?? {});
      return;
    case 'site': {
      await runAdminSiteCommand(ctx, tail, options.admin ?? {});
      return;
    }
    case 'token': {
      await runAdminTokenCommand(ctx, tail, options.admin ?? {});
      return;
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
  const terminal = options.terminal ?? createProcessTerminal();
  let json = false;

  try {
    assertSupportedPlatform(runtime);
    assertSupportedNode(options.nodeVersion ?? process.versions.node);
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
      (head === 'preview' || head === 'generate' || head === 'credentials')
    ) {
      throw usageError(
        '--instance is only valid on administrative commands, connect, and publish.',
      );
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

    await dispatch(ctx, rest, {
      ...(options.deploy !== undefined ? { deploy: options.deploy } : {}),
      ...(options.admin !== undefined ? { admin: options.admin } : {}),
      ...(options.instanceDelete !== undefined ? { instanceDelete: options.instanceDelete } : {}),
      ...(options.publisher !== undefined ? { publisher: options.publisher } : {}),
    });
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
  tryReadPublisherCredential,
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
  tryResolveSelectedInstance,
  deleteInstanceDescriptor,
  clearActiveInstanceIdIf,
} from './instance-store.js';
export {
  requireInteractiveTerminal,
  confirmOrDecline,
  confirmPhraseOrDecline,
  isPublisherCiMode,
  createProcessTerminal,
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
export { applyMigrations, createD1HttpExecutor } from '@nrdocs/persistence';
export type { D1HttpQueryClient, SqlExecutor } from '@nrdocs/persistence';
export { runDeployCommand, createFakeCloudflare } from './deploy.js';
export type { DeployOptions } from './deploy.js';
export { extractWranglerToken } from './deploy/auth.js';
export { parseAccountsResult, classifyCfError } from './deploy/parsers.js';
export { generateResourceSuffix, plannedResourceNames } from './deploy/names.js';
export {
  runAdminSiteCommand,
  runAdminTokenCommand,
  parseTtlDuration,
  MAX_TTL_SECONDS,
  derivePasswordVerifier,
  generatePublishingToken,
} from './admin.js';
export type { AdminOptions } from './admin.js';
export { runConnectCommand } from './connect.js';
export type { ConnectOptions } from './connect.js';
export { runPublishCommand } from './publish.js';
export type { PublishOptions } from './publish.js';
