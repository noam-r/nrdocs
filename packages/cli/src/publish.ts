import {
  buildArtifactFromConfig,
  generateNavigationEntries,
  formatPublicationDiagnostics,
  type PublicationDiagnostic,
  type RendererError,
  type RenderProgress,
} from '@nrdocs/renderer';
import type { CommandContext } from './command-context.js';
import { parseFlags } from './argv.js';
import { resolvePublicationDirectory } from './config.js';
import { readEnvCredentialPair, tryReadPublisherCredential } from './credentials-store.js';
import { credentialError, usageError } from './errors.js';
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
import {
  ExitCode,
  type NrdocsConfig,
  type PublishResultData,
  type SiteId,
} from '@nrdocs/contracts';
import { tryLoadPublicationConfig, writeExplicitNavigationYml } from './publication-config.js';
import { tryBeginAdminSession, type AdminOptions, type AdminSession } from './admin/context.js';
import { bindDirectoryOnAdminInstance } from './admin/publish-bind.js';
import { applyAdminPublication } from './admin/promote.js';
import { getSiteById } from '@nrdocs/persistence';
import { createStatusReporter, type StatusReporter } from './progress.js';

export type PublishOptions = PublisherClientOptions & AdminOptions;

function isRendererFailure(error: unknown): error is RendererError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: string }).name === 'RendererError'
  );
}

function connectRequired(root: string, siteId?: SiteId): CliError {
  if (siteId) {
    return credentialError(
      [
        `No local publishing credential exists for:`,
        `  ${siteId}`,
        '',
        'On an administrator machine, select the instance that hosts this site and retry.',
        'Otherwise connect with a publishing token:',
        '',
        '  nrdocs instance use <instance-id>',
        `  nrdocs connect ${root}`,
      ].join('\n'),
    );
  }
  return credentialError(
    [
      `No publishing credential is available for:`,
      `  ${root}`,
      '',
      'On an administrator machine with a local instance:',
      '',
      `  nrdocs publish ${root}`,
      '',
      'Otherwise connect with a publishing token:',
      '',
      `  nrdocs connect ${root}`,
    ].join('\n'),
  );
}

function presentPublishResult(
  ctx: CommandContext,
  result: PublishResultData,
  summary: string,
): void {
  const lines = [
    result.publication.result === 'unchanged'
      ? 'Publication unchanged.'
      : 'Published successfully.',
    '',
    summary,
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

function refuseOrWarnBrokenReferences(
  ctx: CommandContext,
  diagnostics: PublicationDiagnostic[] | undefined,
  force: boolean,
): void {
  if (!diagnostics || diagnostics.length === 0) return;
  const report = formatPublicationDiagnostics(diagnostics);
  const n = diagnostics.length;
  const pageOnly = diagnostics.every((d) => d.code === 'unlisted_markdown');
  const noun = pageOnly
    ? n === 1
      ? 'broken page link'
      : 'broken page links'
    : n === 1
      ? 'broken link'
      : 'broken links';
  if (!force) {
    throw new CliError({
      code: 'local_validation',
      phase: 'validation',
      exit_code: ExitCode.LocalValidation,
      safe_message: [
        `Publish found ${noun}.`,
        '',
        report,
        '',
        'Re-run with --force to publish anyway. Broken links are shown struck through in the reader.',
        '',
        'The currently published site was not changed.',
      ].join('\n'),
    });
  }
  ctx.runtime.io.writeStderr(`Publishing with ${noun} (--force).\n\n${report}\n\n`);
}

function reportRenderProgress(status: StatusReporter): (progress: RenderProgress) => void {
  return (progress) => {
    status.tick(`Rendering pages ${progress.current}/${progress.total}`);
  };
}

async function withPublishStatus<T>(
  ctx: CommandContext,
  fn: (status: StatusReporter) => Promise<T>,
): Promise<T> {
  const status = createStatusReporter(ctx.runtime);
  try {
    return await fn(status);
  } finally {
    status.stop();
  }
}

async function publishViaHttp(
  ctx: CommandContext,
  input: {
    root: string;
    config: NrdocsConfig;
    siteId: SiteId;
    server: string;
    token: string;
    options: PublisherClientOptions;
    force: boolean;
  },
): Promise<void> {
  await withPublishStatus(ctx, async (status) => {
    status.phase('Checking destination');
    const protocol = await fetchProtocolVersion(input.server, input.options);

    let target;
    try {
      target = await fetchPublishTarget(input.server, input.token, {
        ...input.options,
        expectedSiteId: input.siteId,
      });
    } catch (error) {
      if (error instanceof CliError && error.code === 'site_mismatch') {
        throw credentialError(
          [
            'Publishing credential does not match this directory.',
            '',
            `Expected site: ${input.siteId}`,
            `Token site:    (unauthorized)`,
            '',
            'Nothing was uploaded.',
          ].join('\n'),
        );
      }
      throw error;
    }

    if (target.site.id !== input.siteId) {
      throw credentialError(
        [
          'Publishing credential does not match this directory.',
          '',
          `Expected site: ${input.siteId}`,
          `Token site:    ${target.site.id}`,
          '',
          'Nothing was uploaded.',
        ].join('\n'),
      );
    }

    status.phase('Building publication');
    const built = await buildForPublish(ctx, input.root, input.config, input.siteId, {
      onProgress: reportRenderProgress(status),
      force: input.force,
    });
    if (
      built.artifact.manifest.schema_version === 3 &&
      !protocol.artifact_schema_versions.includes(3)
    ) {
      throw new CliError({
        code: 'unsupported_protocol',
        phase: 'credential',
        exit_code: ExitCode.CompatibilityOrProtocol,
        safe_message:
          'This publication requires a Worker that accepts artifact schema 3.\nRedeploy the instance, then retry:\n  nrdocs deploy --instance <instance-id>',
      });
    }
    status.phase('Uploading');
    const result = await uploadArtifact(
      input.server,
      input.token,
      {
        expectedSiteId: input.siteId,
        digest: built.digest,
        gzipBytes: built.gzipBytes,
      },
      input.options,
    );
    status.stop();
    presentPublishResult(ctx, result, summarizeManifest(built.artifact.manifest));
  });
}

async function publishViaAdmin(
  ctx: CommandContext,
  input: {
    root: string;
    config: NrdocsConfig;
    siteId: SiteId;
    session: AdminSession;
    force: boolean;
  },
): Promise<void> {
  await withPublishStatus(ctx, async (status) => {
    status.phase('Building publication');
    const built = await buildForPublish(ctx, input.root, input.config, input.siteId, {
      onProgress: reportRenderProgress(status),
      force: input.force,
    });
    status.phase('Uploading');
    const result = await applyAdminPublication(input.session, {
      siteId: input.siteId,
      artifact: built.artifact,
      digest: built.digest,
    });
    status.stop();
    presentPublishResult(ctx, result, summarizeManifest(built.artifact.manifest));
  });
}

async function buildForPublish(
  ctx: CommandContext,
  root: string,
  config: NrdocsConfig,
  siteId: SiteId,
  options: { onProgress?: (progress: RenderProgress) => void; force: boolean },
): Promise<{
  artifact: Awaited<ReturnType<typeof buildArtifactFromConfig>>['artifact'];
  digest: string;
  gzipBytes: Uint8Array;
  config: NrdocsConfig;
}> {
  const progress = options.onProgress ? { onProgress: options.onProgress } : {};
  const finish = (
    built: Awaited<ReturnType<typeof buildArtifactFromConfig>>,
    nextConfig: NrdocsConfig,
  ) => {
    refuseOrWarnBrokenReferences(ctx, built.diagnostics, options.force);
    return { ...built, config: nextConfig };
  };
  try {
    const built = await buildArtifactFromConfig(root, config, {
      siteId,
      generatorVersion: CLI_VERSION,
      ...progress,
    });
    return finish(built, config);
  } catch (error) {
    if (
      isRendererFailure(error) &&
      error.code === 'nonconforming' &&
      config.navigation === 'auto'
    ) {
      const entries = await generateNavigationEntries(root);
      const updated = await writeExplicitNavigationYml(ctx, root, config, entries);
      presentHumanSuccess(
        ctx.runtime,
        'Non-standard filenames detected.\nWrote explicit navigation to nrdocs.yml.',
      );
      const built = await buildArtifactFromConfig(root, updated, {
        siteId,
        generatorVersion: CLI_VERSION,
        ...progress,
      });
      return finish(built, updated);
    }
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
}

export async function runPublishCommand(
  ctx: CommandContext,
  args: readonly string[],
  options: PublishOptions = {},
): Promise<void> {
  if (ctx.help) {
    presentHumanSuccess(ctx.runtime, 'nrdocs publish [directory] [--title <title>] [--force]\n');
    return;
  }
  if (ctx.json) throw usageError('publish does not support --json.');

  const { flags, positionals } = parseFlags(args, { string: ['--title'], boolean: ['--force'] });
  if (positionals.length > 1) {
    throw usageError('publish accepts at most one directory argument.');
  }
  const titleFlag = typeof flags['--title'] === 'string' ? flags['--title'] : undefined;
  const force = Boolean(flags['--force']);

  const root = await resolvePublicationDirectory(ctx.runtime, positionals[0]);
  const existing = await tryLoadPublicationConfig(ctx, root);
  const envPair = readEnvCredentialPair(ctx.runtime);
  const boundSiteId = existing?.config.publish?.credential;

  if (envPair) {
    if (!existing?.config || !boundSiteId) {
      throw credentialError(
        `publish.credential is required in:\n  ${root}/nrdocs.yml\n\nRun:\n  nrdocs connect ${root}`,
      );
    }
    await publishViaHttp(ctx, {
      root,
      config: existing.config,
      siteId: boundSiteId,
      server: envPair.server,
      token: envPair.token,
      options,
      force,
    });
    return;
  }

  if (boundSiteId) {
    const file = await tryReadPublisherCredential(ctx.runtime, boundSiteId);
    if (file) {
      await publishViaHttp(ctx, {
        root,
        config: existing!.config,
        siteId: boundSiteId,
        server: file.credential.server,
        token: file.credential.token,
        options,
        force,
      });
      return;
    }
  }

  const session = await tryBeginAdminSession(ctx, 'nrdocs publish', options);
  if (!session) {
    throw connectRequired(root, boundSiteId);
  }

  if (boundSiteId) {
    const site = await getSiteById(session.db, boundSiteId);
    if (!site) {
      throw credentialError(
        [
          'This site is not on the selected administrative instance.',
          '',
          `Site ID:  ${boundSiteId}`,
          `Instance: ${session.descriptor.canonical_origin}`,
          '',
          'Run:',
          '  nrdocs instance use <instance-id>',
          `  nrdocs connect ${root}`,
        ].join('\n'),
      );
    }
    await publishViaAdmin(ctx, {
      root,
      config: existing!.config,
      siteId: boundSiteId,
      session,
      force,
    });
    return;
  }

  const bound = await bindDirectoryOnAdminInstance(ctx, {
    session,
    root,
    existing: existing?.config ?? null,
    titleFlag,
  });
  await publishViaAdmin(ctx, {
    root,
    config: bound.config,
    siteId: bound.siteId,
    session,
    force,
  });
}
