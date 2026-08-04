import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  normalizeTitle,
  parseHttpsServerUrl,
  parseNrdocsConfig,
  type NrdocsConfig,
  type SiteId,
} from '@nrdocs/contracts';
import { serializeNrdocsYaml } from '@nrdocs/renderer';
import type { CommandContext } from './command-context.js';
import { parseFlags } from './argv.js';
import { configPathFor, loadNrdocsConfig, resolvePublicationDirectory } from './config.js';
import { readEnvCredentialPair, writePublisherCredential } from './credentials-store.js';
import { credentialError, ioError, localValidationError, usageError } from './errors.js';
import { presentHumanSuccess } from './present.js';
import {
  fetchProtocolVersion,
  fetchPublishTarget,
  type PublisherClientOptions,
} from './publisher-client.js';
import { atomicWriteProjectFile } from './fs-safe.js';
import { confirmOrDecline, requireInteractiveTerminal } from './terminal.js';
import { credentialPath } from './runtime.js';
import { CliError } from './errors.js';
import { ExitCode } from '@nrdocs/contracts';

export type ConnectOptions = PublisherClientOptions;

async function tryLoadConfig(
  ctx: CommandContext,
  root: string,
): Promise<{ path: string; config: NrdocsConfig } | null> {
  try {
    const loaded = await loadNrdocsConfig(ctx.runtime, root);
    return { path: loaded.path, config: loaded.config };
  } catch (error) {
    if (error instanceof Error && /nrdocs\.yml was not found/.test(error.message)) {
      return null;
    }
    throw error;
  }
}

function resolveTitle(input: {
  existing: NrdocsConfig | null;
  titleFlag: string | undefined;
  interactive: boolean;
  prompt: () => Promise<string>;
}): Promise<string> {
  return (async () => {
    const existingTitle = input.existing?.title;
    if (typeof input.titleFlag === 'string') {
      const normalized = normalizeTitle(input.titleFlag);
      if (!normalized) throw localValidationError('Invalid --title value.');
      if (existingTitle && existingTitle !== normalized) {
        throw localValidationError(
          `Site title already set to:\n  ${existingTitle}\n\nEdit nrdocs.yml directly to change it. connect does not update the site title.`,
        );
      }
      return existingTitle ?? normalized;
    }
    if (existingTitle) return existingTitle;
    if (!input.interactive) {
      throw usageError(
        'A title is required when creating or completing nrdocs.yml.\nPass --title <title>.',
      );
    }
    const entered = (await input.prompt()).trim();
    const normalized = normalizeTitle(entered);
    if (!normalized) throw localValidationError('Invalid title.');
    return normalized;
  })();
}

export async function runConnectCommand(
  ctx: CommandContext,
  args: readonly string[],
  options: ConnectOptions = {},
): Promise<void> {
  if (ctx.help) {
    presentHumanSuccess(ctx.runtime, 'nrdocs connect [directory] [--title <title>]\n');
    return;
  }
  if (ctx.json) throw usageError('connect does not support --json.');

  const { flags, positionals } = parseFlags(args, { string: ['--title'] });
  if (positionals.length > 1) {
    throw usageError('connect accepts at most one directory argument.');
  }
  const titleFlag = typeof flags['--title'] === 'string' ? flags['--title'] : undefined;

  const root = await resolvePublicationDirectory(ctx.runtime, positionals[0]);
  const configPath = configPathFor(root);
  const existing = await tryLoadConfig(ctx, root);

  const envPair = readEnvCredentialPair(ctx.runtime);
  const envMode = envPair !== null;

  let server: string;
  let token: string;
  if (envMode) {
    server = envPair!.server;
    token = envPair!.token;
  } else {
    requireInteractiveTerminal(ctx.runtime, 'connect');
    const serverRaw = (await ctx.terminal.promptLine('Server:')).trim();
    const parsed = parseHttpsServerUrl(serverRaw, true);
    if (!parsed) {
      throw localValidationError(
        'Server must be an https origin (http://127.0.0.1 is allowed locally).',
      );
    }
    server = parsed;
    token = await ctx.terminal.promptMasked('Publishing token:');
    if (!/^nrd_pub_[A-Za-z0-9_-]{43}$/.test(token)) {
      throw credentialError('Publishing token is malformed.');
    }
  }

  const title = await resolveTitle({
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
      // First discovery without expected header shouldn't hit this; with expected it can.
      // Re-fetch without expected to learn token site for rebind confirmation.
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

  // Interactive rebind when pointer differs but server accepted expected header...
  // Actually if expected was sent and matched, sites are equal. If no expected, we discovered.
  // If expected was sent and mismatch, we handled above via site_mismatch.
  // Additional case: expected exists, we omitted header on purpose? We always send expected when present.
  // For interactive rebind after mismatch we already confirmed.

  if (expectedExisting && expectedExisting !== target.site.id && !envMode) {
    // Safety: if somehow we got a different site without going through confirm
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
  const language = existing?.config.language ?? 'und';
  const direction = existing?.config.direction ?? 'auto';
  const navigation =
    existing?.config.navigation === undefined ? 'auto' : existing.config.navigation;

  const nextConfig: NrdocsConfig = {
    publish: { credential: siteId },
    title,
    language,
    direction,
    navigation: navigation === undefined ? 'auto' : navigation,
  };

  const yamlText = Array.isArray(nextConfig.navigation)
    ? serializeNrdocsYaml(nextConfig, nextConfig.navigation)
    : serializeNrdocsYaml({ ...nextConfig, navigation: 'auto' });

  try {
    parseNrdocsConfig(parseYaml(yamlText), { requireCredential: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'invalid config';
    throw localValidationError(`Proposed nrdocs.yml failed validation (${msg}).`);
  }

  // Writes only after full validation.
  try {
    await atomicWriteProjectFile(ctx.runtime, configPath, yamlText, 0o644);
  } catch (error) {
    if (error instanceof Error && /symbolic-link|Failed to write/.test(error.message)) throw error;
    throw ioError(`Unable to write:\n  ${configPath}`);
  }

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
