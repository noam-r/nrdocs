import type { SiteId } from '@nrdocs/contracts';
import { buildArtifactFromConfig } from '@nrdocs/renderer';
import type { RendererError } from '@nrdocs/renderer';
import type { CommandContext } from './command-context.js';
import { parseFlags } from './argv.js';
import { loadNrdocsConfig, resolvePublicationDirectory } from './config.js';
import { localValidationError, usageError } from './errors.js';
import { presentHumanSuccess } from './present.js';
import { CLI_VERSION } from './help.js';
import { listenPreviewServer, summarizeManifest, type PreviewServer } from './preview-server.js';

/** Opaque site ID used only when previewing an unconnected publication. */
export const PREVIEW_PLACEHOLDER_SITE_ID = 'site_00000000000000000000000000' as SiteId;

export type PreviewCommandOptions = {
  /** When set, preview exits when aborted instead of waiting for SIGINT. */
  signal?: AbortSignal;
  /** Injected for tests — runs after the loopback server is listening. */
  onListening?: (server: PreviewServer) => void | Promise<void>;
};

function isRendererFailure(error: unknown): error is RendererError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: string }).name === 'RendererError'
  );
}

export async function runPreviewCommand(
  ctx: CommandContext,
  args: readonly string[],
  options: PreviewCommandOptions = {},
): Promise<void> {
  if (ctx.help) {
    presentHumanSuccess(ctx.runtime, 'nrdocs preview [directory]\n');
    return;
  }
  if (ctx.json) throw usageError('preview does not support --json.');

  const { positionals } = parseFlags(args);
  if (positionals.length > 1) {
    throw usageError('preview accepts at most one directory argument.');
  }

  const root = await resolvePublicationDirectory(ctx.runtime, positionals[0]);
  const { config } = await loadNrdocsConfig(ctx.runtime, root);

  const siteId = config.publish?.credential ?? PREVIEW_PLACEHOLDER_SITE_ID;

  let built;
  try {
    built = await buildArtifactFromConfig(root, config, {
      siteId,
      generatorVersion: CLI_VERSION,
    });
  } catch (error) {
    if (isRendererFailure(error)) {
      throw localValidationError(error.message);
    }
    throw error;
  }

  const server = await listenPreviewServer(built.artifact);

  presentHumanSuccess(
    ctx.runtime,
    [
      'Preview ready.',
      '',
      summarizeManifest(built.artifact.manifest),
      '',
      `URL: ${server.url}`,
    ].join('\n'),
  );

  if (options.onListening) {
    await options.onListening(server);
  }

  await waitForShutdown(server, options.signal);
}

async function waitForShutdown(server: PreviewServer, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    await server.close();
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = async () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        await server.close();
      } catch {
        // ignore close races
      }
      resolve();
    };
    const onAbort = () => {
      void finish();
    };
    const onSignal = () => {
      void finish();
    };
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  });
}

export { listenPreviewServer, summarizeManifest };
export type { PreviewServer };
