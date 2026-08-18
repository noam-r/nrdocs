import path from 'node:path';
import { parseHttpsServerUrl, type SiteId } from '@nrdocs/contracts';
import type { CommandContext } from './command-context.js';
import { parseFlags } from './argv.js';
import { resolvePublicationDirectory } from './config.js';
import { readEnvCredentialPair, writePublisherCredential } from './credentials-store.js';
import { credentialError, localValidationError, usageError } from './errors.js';
import { presentHumanSuccess } from './present.js';
import {
  fetchProtocolVersion,
  fetchPublishTarget,
  type PublisherClientOptions,
} from './publisher-client.js';
import { confirmOrDecline, requireInteractiveTerminal } from './terminal.js';
import { credentialPath } from './runtime.js';
import { CliError } from './errors.js';
import { ExitCode } from '@nrdocs/contracts';
import {
  resolvePublicationTitle,
  tryLoadPublicationConfig,
  writeConnectedNrdocsYml,
} from './publication-config.js';
import { tryResolveSelectedInstance } from './instance-store.js';
import { tryBeginAdminSession, type AdminOptions, type AdminSession } from './admin/context.js';
import { bindDirectoryOnAdminInstance } from './admin/publish-bind.js';
import { getSiteById } from '@nrdocs/persistence';
import { siteUrl } from './admin/site.js';
import type { SiteRow } from '@nrdocs/persistence';

export type ConnectOptions = PublisherClientOptions & AdminOptions;

function presentAdminConnectSuccess(
  ctx: CommandContext,
  input: {
    root: string;
    session: AdminSession;
    site: SiteRow;
    siteId: SiteId;
    title: string;
  },
): void {
  const relDir = path.relative(ctx.runtime.cwd, input.root) || '.';
  const origin = input.session.descriptor.canonical_origin;
  presentHumanSuccess(
    ctx.runtime,
    [
      'Connected directory.',
      '',
      `Directory:  ${input.root}`,
      `Site:       ${input.title}`,
      `Site ID:    ${input.siteId}`,
      `Instance:   ${origin}`,
      `URL:        ${siteUrl(origin, input.site.slug)}`,
      '',
      'No publishing token is required on this machine.',
      '',
      'Next:',
      `  nrdocs preview ${relDir}`,
      `  nrdocs publish ${relDir}`,
    ].join('\n'),
  );
}

async function tryConnectViaAdminInstance(
  ctx: CommandContext,
  input: {
    root: string;
    existing: Awaited<ReturnType<typeof tryLoadPublicationConfig>>;
    titleFlag: string | undefined;
    options: AdminOptions;
  },
): Promise<boolean> {
  const session = await tryBeginAdminSession(ctx, 'nrdocs connect', input.options);
  if (!session) return false;

  requireInteractiveTerminal(ctx.runtime, 'connect');
  const boundSiteId = input.existing?.config.publish?.credential ?? null;

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
          `  nrdocs connect ${input.root}`,
        ].join('\n'),
      );
    }
    const title = await resolvePublicationTitle({
      existing: input.existing?.config ?? null,
      titleFlag: input.titleFlag,
      interactive: true,
      prompt: async () => ctx.terminal.promptLine('Site title:'),
    });
    await writeConnectedNrdocsYml(ctx, input.root, {
      existing: input.existing?.config ?? null,
      siteId: boundSiteId,
      title,
    });
    presentAdminConnectSuccess(ctx, {
      root: input.root,
      session,
      site,
      siteId: boundSiteId,
      title,
    });
    return true;
  }

  const bound = await bindDirectoryOnAdminInstance(ctx, {
    session,
    root: input.root,
    existing: input.existing?.config ?? null,
    titleFlag: input.titleFlag,
    mode: 'connect',
  });
  const site = await getSiteById(session.db, bound.siteId);
  if (!site) {
    throw localValidationError('Site disappeared after connect bind.');
  }
  presentAdminConnectSuccess(ctx, {
    root: input.root,
    session,
    site,
    siteId: bound.siteId,
    title: bound.config.title ?? bound.siteId,
  });
  return true;
}

export async function runConnectCommand(
  ctx: CommandContext,
  args: readonly string[],
  options: ConnectOptions = {},
): Promise<void> {
  if (ctx.help) {
    presentHumanSuccess(
      ctx.runtime,
      [
        'nrdocs connect [directory] [--title <title>]',
        '',
        'On a remote machine, connect a docs directory with a publishing token.',
        'On an administrator machine with a local instance, prefer:',
        '',
        '  nrdocs publish [directory]',
        '',
        'which binds and publishes without a token.',
      ].join('\n'),
    );
    return;
  }
  if (ctx.json) throw usageError('connect does not support --json.');

  const { flags, positionals } = parseFlags(args, { string: ['--title'] });
  if (positionals.length > 1) {
    throw usageError('connect accepts at most one directory argument.');
  }
  const titleFlag = typeof flags['--title'] === 'string' ? flags['--title'] : undefined;

  const root = await resolvePublicationDirectory(ctx.runtime, positionals[0]);
  const existing = await tryLoadPublicationConfig(ctx, root);

  const envPair = readEnvCredentialPair(ctx.runtime);
  const envMode = envPair !== null;

  if (!envMode && (await tryConnectViaAdminInstance(ctx, { root, existing, titleFlag, options }))) {
    return;
  }

  let server: string;
  let token: string;
  if (envMode) {
    server = envPair!.server;
    token = envPair!.token;
  } else {
    requireInteractiveTerminal(ctx.runtime, 'connect');
    const localInstance = await tryResolveSelectedInstance(ctx.runtime, ctx.instance);
    const origin = localInstance?.canonical_origin
      ? parseHttpsServerUrl(localInstance.canonical_origin, true)
      : null;
    if (origin) {
      server = origin;
      presentHumanSuccess(ctx.runtime, `Server:     ${server}`);
    } else {
      const serverRaw = (await ctx.terminal.promptLine('Server:')).trim();
      const parsed = parseHttpsServerUrl(serverRaw, true);
      if (!parsed) {
        throw localValidationError(
          'Server must be an https origin (http://127.0.0.1 is allowed locally).',
        );
      }
      server = parsed;
    }
    token = await ctx.terminal.promptMasked('Publishing token:');
    if (!/^nrd_pub_[A-Za-z0-9_-]{43}$/.test(token)) {
      throw credentialError('Publishing token is malformed.');
    }
  }

  const title = await resolvePublicationTitle({
    existing: existing?.config ?? null,
    titleFlag,
    interactive: !envMode,
    prompt: async () => ctx.terminal.promptLine('Site title:'),
  });

  await fetchProtocolVersion(server, options);

  const expectedExisting = existing?.config.publish?.credential ?? null;
  let target;
  try {
    target = await fetchPublishTarget(server, token, {
      ...options,
      ...(expectedExisting ? { expectedSiteId: expectedExisting } : {}),
    });
  } catch (error) {
    if (
      error instanceof CliError &&
      error.code === 'site_mismatch' &&
      expectedExisting &&
      !envMode
    ) {
      const discovered = await fetchPublishTarget(server, token, options);
      presentHumanSuccess(
        ctx.runtime,
        [
          'This directory is already connected to a different site.',
          '',
          `Configured site: ${expectedExisting}`,
          `Token site:      ${discovered.site.id}`,
          '',
          'Rebinding replaces the local destination pointer.',
        ].join('\n'),
      );
      if (
        (await confirmOrDecline(ctx.terminal, 'Rebind this directory to the token site?')) ===
        'declined'
      ) {
        presentHumanSuccess(ctx.runtime, 'Cancelled.');
        return;
      }
      target = discovered;
    } else if (error instanceof CliError && error.code === 'site_mismatch' && envMode) {
      throw new CliError({
        code: 'site_mismatch',
        phase: 'credential',
        exit_code: ExitCode.CredentialOrAuthority,
        safe_message:
          'Publishing credential does not match this directory.\n\nEnvironment-backed connect cannot rebind a different site.\nNothing was written.',
      });
    } else {
      throw error;
    }
  }

  if (expectedExisting && expectedExisting !== target.site.id && !envMode) {
    presentHumanSuccess(
      ctx.runtime,
      [
        'This directory is already connected to a different site.',
        '',
        `Configured site: ${expectedExisting}`,
        `Token site:      ${target.site.id}`,
        '',
        'Rebinding replaces the local destination pointer.',
      ].join('\n'),
    );
    if (
      (await confirmOrDecline(ctx.terminal, 'Rebind this directory to the token site?')) ===
      'declined'
    ) {
      presentHumanSuccess(ctx.runtime, 'Cancelled.');
      return;
    }
  } else if (expectedExisting && expectedExisting !== target.site.id && envMode) {
    throw new CliError({
      code: 'site_mismatch',
      phase: 'credential',
      exit_code: ExitCode.CredentialOrAuthority,
      safe_message:
        'Publishing credential does not match this directory.\n\nEnvironment-backed connect cannot rebind a different site.\nNothing was written.',
    });
  }

  const siteId = target.site.id as SiteId;
  await writeConnectedNrdocsYml(ctx, root, {
    existing: existing?.config ?? null,
    siteId,
    title,
  });

  if (!envMode) {
    await writePublisherCredential(ctx.runtime, siteId, { server, token });
  }

  const relDir = path.relative(ctx.runtime.cwd, root) || '.';
  const displayDir = root;
  const lines = [
    'Connected directory.',
    '',
    `Directory:  ${displayDir}`,
    `Site:       ${title}`,
    `Site ID:    ${siteId}`,
    `Server:     ${server}`,
    '',
  ];
  if (envMode) {
    lines.push('Credential was supplied by the environment and was not stored.');
    lines.push('');
    lines.push('Next:');
    lines.push(`  nrdocs preview ${relDir}`);
    lines.push(`  NRDOCS_URL=... NRDOCS_TOKEN=... nrdocs publish ${relDir}`);
  } else {
    const stored = credentialPath(ctx.runtime, siteId);
    lines.push('Credential stored:');
    lines.push(`  ${stored}`);
    lines.push('');
    lines.push('Next:');
    lines.push(`  nrdocs preview ${relDir}`);
    lines.push(`  nrdocs publish ${relDir}`);
  }
  presentHumanSuccess(ctx.runtime, lines.join('\n'));
}
