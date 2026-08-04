import { buildArtifactFromConfig, type RendererError } from '@nrdocs/renderer';
import type { CommandContext } from './command-context.js';
import { parseFlags } from './argv.js';
import { loadNrdocsConfig, resolvePublicationDirectory } from './config.js';
import { resolvePublisherCredential } from './credentials-store.js';
import { credentialError, localValidationError, usageError } from './errors.js';
import { presentHumanSuccess } from './present.js';
import { CLI_VERSION } from './help.js';
import { summarizeManifest } from './preview-server.js';
import {
  fetchProtocolVersion,
  fetchPublishTarget,
  uploadArtifact,
  type PublisherClientOptions,
} from './publisher-client.js';
import { CliError } from './errors.js';
import { ExitCode } from '@nrdocs/contracts';

export type PublishOptions = PublisherClientOptions;

function isRendererFailure(error: unknown): error is RendererError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: string }).name === 'RendererError'
  );
}

export async function runPublishCommand(
  ctx: CommandContext,
  args: readonly string[],
  options: PublishOptions = {},
): Promise<void> {
  if (ctx.help) {
    presentHumanSuccess(ctx.runtime, 'nrdocs publish [directory]\n');
    return;
  }
  if (ctx.json) throw usageError('publish does not support --json.');

  const { positionals } = parseFlags(args);
  if (positionals.length > 1) {
    throw usageError('publish accepts at most one directory argument.');
  }

  const root = await resolvePublicationDirectory(ctx.runtime, positionals[0]);

  let loaded;
  try {
    loaded = await loadNrdocsConfig(ctx.runtime, root, { requireCredential: true });
  } catch (error) {
    if (error instanceof Error && /publish\.credential is required/.test(error.message)) {
      throw localValidationError(
        `publish.credential is required in:\n  ${root}/nrdocs.yml\n\nRun:\n  nrdocs connect ${root}`,
      );
    }
    throw error;
  }

  const expectedSiteId = loaded.config.publish!.credential;
  const credential = await resolvePublisherCredential(ctx.runtime, expectedSiteId);

  await fetchProtocolVersion(credential.server, options);

  let target;
  try {
    target = await fetchPublishTarget(credential.server, credential.token, {
      ...options,
      expectedSiteId,
    });
  } catch (error) {
    if (error instanceof CliError && error.code === 'site_mismatch') {
      throw credentialError(
        [
          'Publishing credential does not match this directory.',
          '',
          `Expected site: ${expectedSiteId}`,
          `Token site:    (unauthorized)`,
          '',
          'Nothing was uploaded.',
        ].join('\n'),
      );
    }
    throw error;
  }

  if (target.site.id !== expectedSiteId) {
    throw credentialError(
      [
        'Publishing credential does not match this directory.',
        '',
        `Expected site: ${expectedSiteId}`,
        `Token site:    ${target.site.id}`,
        '',
        'Nothing was uploaded.',
      ].join('\n'),
    );
  }

  let built;
  try {
    built = await buildArtifactFromConfig(root, loaded.config, {
      siteId: expectedSiteId,
      generatorVersion: CLI_VERSION,
    });
  } catch (error) {
    if (isRendererFailure(error)) {
      throw new CliError({
        code: 'local_validation',
        phase: 'validation',
        exit_code: ExitCode.LocalValidation,
        safe_message: `Publish failed during validation.\n\n${error.message}\n\nThe currently published site was not changed.`,
      });
    }
    throw error;
  }

  presentHumanSuccess(ctx.runtime, summarizeManifest(built.artifact.manifest));

  const result = await uploadArtifact(
    credential.server,
    credential.token,
    {
      expectedSiteId,
      digest: built.digest,
      gzipBytes: built.gzipBytes,
    },
    options,
  );

  const lines = [
    result.publication.result === 'unchanged'
      ? 'Publication unchanged.'
      : 'Published successfully.',
    '',
    summarizeManifest(built.artifact.manifest),
    '',
    `URL: ${result.site.url}`,
  ];
  if (!result.site.enabled) {
    lines.push('');
    lines.push(
      'Site is currently disabled. Content was updated but is unavailable to readers until an administrator enables it.',
    );
  }
  presentHumanSuccess(ctx.runtime, lines.join('\n'));
}
