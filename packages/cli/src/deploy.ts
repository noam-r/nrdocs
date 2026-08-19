import {
  applyMigrations,
  insertInstanceMetadata,
  getInstanceMetadata,
  updateInstanceCanonicalOrigin,
  type SqlExecutor,
} from '@nrdocs/persistence';
import {
  normalizeDisplayName,
  parseCanonicalHostname,
  parseInstanceId,
  type InstanceDescriptor,
  type ReconciliationProgress,
} from '@nrdocs/contracts';
import { ExitCode } from '@nrdocs/contracts';
import type { CommandContext } from './command-context.js';
import { parseFlags } from './argv.js';
import { CliError, usageError } from './errors.js';
import { presentHumanSuccess } from './present.js';
import { requireInteractiveTerminal, type Terminal } from './terminal.js';
import {
  listInstanceDescriptors,
  readActiveInstanceId,
  readInstanceDescriptor,
  writeActiveInstanceId,
  writeInstanceDescriptor,
} from './instance-store.js';
import { CLI_VERSION } from './help.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareCredential,
  type RunCommand,
} from './deploy/auth.js';
import {
  CloudflareApiError,
  waitForOriginSmoke,
  workersDevOrigin,
  type CloudflareControlPlane,
  type R2InstanceMarker,
} from './deploy/cloudflare.js';
import {
  generateInstanceId,
  generateResourceSuffix,
  plannedResourceNames,
} from './deploy/names.js';
import {
  BUNDLED_PLATFORM_CSS,
  BUNDLED_PLATFORM_JS,
  BUNDLED_PLATFORM_MERMAID,
  BUNDLED_WORKER_MODULE,
} from './deploy/worker-bundle.js';

export type DeployOptions = {
  cloudflare?: CloudflareControlPlane;
  runCommand?: RunCommand;
  randomBytes?: (n: number) => Uint8Array;
  packageVersion?: string;
  /** Injected D1 executor factory for applying migrations without live CF. */
  openD1?: (databaseId: string) => Promise<SqlExecutor>;
  mkdtemp?: () => Promise<string>;
  rmTemp?: (dir: string) => Promise<void>;
};

function authorityError(message: string): CliError {
  return new CliError({
    code: 'credential_or_authority',
    phase: 'credential',
    exit_code: ExitCode.CredentialOrAuthority,
    safe_message: message,
  });
}

function mapCfError(error: unknown): never {
  if (error instanceof CloudflareApiError) {
    if (error.kind === 'permission_denied') {
      throw authorityError(`Cloudflare permission denied:\n  ${error.message}`);
    }
    if (error.kind === 'rate_limited') {
      throw new CliError({
        code: 'rate_limited',
        phase: 'admin',
        exit_code: ExitCode.RetryableExternal,
        safe_message: 'Cloudflare rate limit exceeded. Retry later.',
      });
    }
    throw new CliError({
      code: 'cloudflare_api',
      phase: 'admin',
      exit_code: ExitCode.RetryableExternal,
      safe_message: `Cloudflare API error:\n  ${error.message}`,
    });
  }
  throw error;
}

async function promptYesNo(terminal: Terminal, question: string): Promise<boolean> {
  const answer = (await terminal.promptLine(question)).trim().toLowerCase();
  if (answer === 'y' || answer === 'yes') return true;
  if (answer === 'n' || answer === 'no' || answer === '') return false;
  return promptYesNo(terminal, question);
}

/** Longest matching active zone for a hostname (apex or subdomain). */
export function findZoneForHostname(
  zones: ReadonlyArray<{ id: string; name: string; status: string }>,
  hostname: string,
): { id: string; name: string; status: string } | undefined {
  const host = hostname.toLowerCase();
  return zones
    .filter((z) => z.status === 'active')
    .filter((z) => host === z.name || host.endsWith(`.${z.name}`))
    .sort((a, b) => b.name.length - a.name.length)[0];
}

function hostnameUnderZone(hostname: string, zoneName: string): boolean {
  return hostname === zoneName || hostname.endsWith(`.${zoneName}`);
}

/** Single DNS label suitable for `<label>.<zone>` shorthand. */
function isDnsLabel(value: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value);
}

/**
 * Normalize operator hostname input for a selected Cloudflare zone.
 * Accepts a full hostname under the zone, or a single label expanded to
 * `<label>.<zone>` (operators often type only the subdomain after picking a zone).
 */
export function resolveHostnameUnderZone(raw: string, zoneName: string): string {
  let candidate = raw.trim().toLowerCase();
  if (!candidate) {
    throw usageError(
      [
        'Hostname is required.',
        '',
        `Enter the full hostname under ${zoneName}, for example:`,
        `  ${zoneName}`,
        `  docs.${zoneName}`,
        `Or enter only a label such as docs (becomes docs.${zoneName}).`,
        'Do not include https://, a path, or a port.',
      ].join('\n'),
    );
  }
  candidate = candidate.replace(/^https?:\/\//, '');
  const slash = candidate.indexOf('/');
  if (slash >= 0) candidate = candidate.slice(0, slash);
  const colon = candidate.indexOf(':');
  if (colon >= 0) candidate = candidate.slice(0, colon);
  candidate = candidate.replace(/\.$/, '');

  const parsed = parseCanonicalHostname(candidate);
  if (parsed) {
    if (!hostnameUnderZone(parsed, zoneName)) {
      throw usageError(
        [
          `Hostname must be ${zoneName} or a subdomain of it.`,
          `You entered: ${parsed}`,
          '',
          'Examples:',
          `  ${zoneName}`,
          `  docs.${zoneName}`,
        ].join('\n'),
      );
    }
    return parsed;
  }

  if (!candidate.includes('.') && isDnsLabel(candidate)) {
    const expanded = `${candidate}.${zoneName}`;
    const ok = parseCanonicalHostname(expanded);
    if (ok) return ok;
  }

  throw usageError(
    [
      `Invalid hostname: ${raw.trim()}`,
      '',
      `Expected a full DNS name under ${zoneName}, for example:`,
      `  ${zoneName}`,
      `  docs.${zoneName}`,
      `Or a single label such as docs (becomes docs.${zoneName}).`,
      'Do not include https://, a path, a port, or a wildcard (*).',
      'Hostnames must be lowercase letters, digits, and hyphens.',
    ].join('\n'),
  );
}

function requireCanonicalHostname(raw: string, flagLabel: string): string {
  const candidate = raw.trim().toLowerCase();
  const host = parseCanonicalHostname(candidate);
  if (host) return host;
  throw usageError(
    [
      `Invalid ${flagLabel} value: ${raw.trim()}`,
      '',
      'Expected a full lowercase hostname such as docs.example.com',
      '(no https://, path, port, or wildcard).',
    ].join('\n'),
  );
}

async function promptPublishOrigin(
  ctx: CommandContext,
  cf: CloudflareControlPlane,
  accountId: string,
  plannedWorkersDevOrigin: string,
  domainFlag: string | undefined,
): Promise<string | null> {
  if (domainFlag !== undefined) {
    const host = requireCanonicalHostname(domainFlag, '--domain');
    presentHumanSuccess(
      ctx.runtime,
      [
        'Publish location (from --domain):',
        `  Instance origin: https://${host}`,
        `  Site URLs:       https://${host}/<slug>/`,
        '',
        'This instance will not use workers.dev.',
      ].join('\n'),
    );
    return host;
  }

  presentHumanSuccess(
    ctx.runtime,
    [
      'Where should this instance publish documentation?',
      '',
      '  [1] Cloudflare workers.dev  (default — no DNS setup)',
      `      Origin: ${plannedWorkersDevOrigin}`,
      `      Sites:  ${plannedWorkersDevOrigin}/<slug>/`,
      '',
      '  [2] Custom domain on a Cloudflare zone in this account',
      '      You pick a zone, then enter the hostname (apex or subdomain).',
      '      workers.dev will be disabled for this instance.',
    ].join('\n'),
  );

  const choiceRaw = (await ctx.terminal.promptLine('Publish location [1/2]')).trim();
  const choice = choiceRaw === '' ? '1' : choiceRaw;
  if (choice === '1') {
    presentHumanSuccess(
      ctx.runtime,
      [
        'Using workers.dev.',
        `Docs sites will be published under:`,
        `  ${plannedWorkersDevOrigin}/<slug>/`,
      ].join('\n'),
    );
    return null;
  }
  if (choice !== '2') {
    throw usageError('Publish location must be 1 (workers.dev) or 2 (custom domain).');
  }

  const zones = (await cf.listZones(accountId).catch(mapCfError)).filter(
    (z) => z.status === 'active',
  );
  if (zones.length === 0) {
    throw authorityError(
      [
        'No active Cloudflare zones are visible for this account.',
        'Custom domains require Zone Read on the API token and a zone in this account.',
        'Choose publish location [1] for workers.dev, or add Zone permissions and retry.',
      ].join('\n'),
    );
  }

  presentHumanSuccess(
    ctx.runtime,
    ['Cloudflare zones in this account:', ...zones.map((z, i) => `  [${i + 1}] ${z.name}`)].join(
      '\n',
    ),
  );
  const zoneChoice = Number((await ctx.terminal.promptLine('Zone number:')).trim());
  if (!Number.isInteger(zoneChoice) || zoneChoice < 1 || zoneChoice > zones.length) {
    throw usageError('Invalid zone selection.');
  }
  const zone = zones[zoneChoice - 1]!;

  presentHumanSuccess(
    ctx.runtime,
    [
      `Selected zone: ${zone.name}`,
      '',
      'Enter the hostname to attach under this zone.',
      'It must be a full DNS name, for example:',
      `  ${zone.name}`,
      `  docs.${zone.name}`,
      `Or type only a label such as docs — that becomes docs.${zone.name}.`,
      'Do not include https://, a path, or a port.',
    ].join('\n'),
  );
  const entered = resolveHostnameUnderZone(await ctx.terminal.promptLine('Hostname:'), zone.name);

  const origin = `https://${entered}`;
  presentHumanSuccess(
    ctx.runtime,
    [
      'Using custom domain.',
      `  Instance origin: ${origin}`,
      `  Site URLs:       ${origin}/<slug>/`,
      '',
      'workers.dev will be disabled for this instance.',
    ].join('\n'),
  );

  const confirmed = await promptYesNo(ctx.terminal, 'Proceed with this hostname? [y/N]');
  if (!confirmed) throw usageError('Deploy cancelled.');
  return entered;
}

function stepsOf(desc: InstanceDescriptor): Set<string> {
  return new Set(desc.reconciliation?.completed_steps ?? []);
}

function withStep(desc: InstanceDescriptor, step: string): InstanceDescriptor {
  const completed = [...stepsOf(desc), step];
  const reconciliation: ReconciliationProgress = {
    completed_steps: completed.filter(
      (s, i, arr) =>
        arr.indexOf(s) === i &&
        ['preflight', 'd1', 'r2', 'migrations', 'worker', 'origin', 'smoke'].includes(s),
    ),
    resume_hint: `nrdocs deploy --instance ${desc.instance_id}`,
  };
  return { ...desc, reconciliation };
}

export async function runDeployCommand(
  ctx: CommandContext,
  args: readonly string[],
  options: DeployOptions = {},
): Promise<void> {
  if (ctx.help) {
    presentHumanSuccess(
      ctx.runtime,
      [
        'nrdocs deploy [--new] [--domain <hostname>] [--instance <instance-id>]',
        '',
        'Upgrades the selected instance, or provisions a new Cloudflare instance',
        '(Worker + D1 + R2) when you pass --new. It does not upload Markdown;',
        'use site create, connect, and publish after.',
        '',
        'Bare deploy upgrades the active instance. --instance upgrades that local',
        'instance. --new creates a new instance. --domain is only valid with --new.',
        'Without --domain, a new instance chooses workers.dev or a custom domain',
        'interactively.',
      ].join('\n') + '\n',
    );
    return;
  }
  if (ctx.json) throw usageError('deploy does not support --json.');

  const { flags, positionals } = parseFlags(args, {
    string: ['--domain', '--instance'],
    boolean: ['--new'],
  });
  if (positionals.length > 0) throw usageError('deploy does not take positional arguments.');
  if (ctx.instance !== undefined && flags['--instance'] !== undefined) {
    throw usageError('Pass --instance at most once.');
  }
  const instanceFlag =
    (typeof flags['--instance'] === 'string' ? flags['--instance'] : undefined) ?? ctx.instance;
  const domainFlag = typeof flags['--domain'] === 'string' ? flags['--domain'] : undefined;
  const wantNew = flags['--new'] === true;
  if (domainFlag !== undefined) {
    requireCanonicalHostname(domainFlag, '--domain');
  }
  if (wantNew && instanceFlag) {
    throw usageError('--new cannot be combined with --instance.');
  }
  if (domainFlag !== undefined && !wantNew) {
    throw usageError(
      '--domain is only valid with --new.\nCreate a new instance with:\n  nrdocs deploy --new --domain <hostname>',
    );
  }

  const known = await listInstanceDescriptors(ctx.runtime);
  const active = await readActiveInstanceId(ctx.runtime);

  let descriptor: InstanceDescriptor | undefined;
  let isNew = false;

  if (instanceFlag) {
    const id = parseInstanceId(instanceFlag);
    if (!id) throw usageError('--instance requires a valid opaque instance ID.');
    descriptor = await readInstanceDescriptor(ctx.runtime, id);
  } else if (wantNew) {
    isNew = true;
  } else if (active) {
    descriptor = await readInstanceDescriptor(ctx.runtime, active);
  } else {
    throw usageError(
      [
        'nrdocs deploy does not create a new Cloudflare instance unless you pass --new.',
        ...(known.length === 0
          ? []
          : [
              '',
              'Local instances:',
              ...known.map((d) => `  ${d.instance_id}  ${d.display_name}`),
              '',
              'Select one, then upgrade it:',
              '  nrdocs instance use <instance-id>',
              '  nrdocs deploy',
              'Or upgrade a specific instance:',
              '  nrdocs deploy --instance <instance-id>',
            ]),
        '',
        'To provision a new instance (Worker, D1, and R2):',
        '  nrdocs deploy --new',
      ].join('\n'),
    );
  }

  requireInteractiveTerminal(ctx.runtime, 'deploy');

  if (isNew && known.length > 0) {
    presentHumanSuccess(
      ctx.runtime,
      [
        'This will provision a new Cloudflare instance (Worker, D1, and R2).',
        'It will not upgrade an existing instance:',
        ...known.map(
          (d) =>
            `  ${d.display_name}  ${d.instance_id}${d.canonical_origin ? `  ${d.canonical_origin}` : ''}`,
        ),
      ].join('\n'),
    );
    const confirmed = await promptYesNo(ctx.terminal, 'Create a new instance? [y/N]');
    if (!confirmed) throw usageError('Deploy cancelled.');
  }

  if (!options.cloudflare) {
    const { createDefaultDeployOptions } = await import('./deploy/production.js');
    options = { ...(await createDefaultDeployOptions(ctx.runtime)), ...options };
  }

  if (!options.cloudflare) {
    throw new CliError({
      code: 'internal',
      phase: 'internal',
      exit_code: ExitCode.InternalSoftware,
      safe_message:
        'Deploy Cloudflare client is not wired in this build path. Use the packaged CLI entry.',
    });
  }
  const cf = options.cloudflare;
  const randomBytes =
    options.randomBytes ?? ((n) => globalThis.crypto.getRandomValues(new Uint8Array(n)));
  const packageVersion = options.packageVersion ?? CLI_VERSION;

  // Snapshot invocation directory contents to prove no durable files are written there.
  const cwdBefore = await snapshotDir(ctx.runtime.cwd, ctx);

  if (isNew) {
    presentHumanSuccess(
      ctx.runtime,
      [
        'nrdocs deploy --new creates a Cloudflare instance that will host your documentation.',
        'Markdown is published later with: nrdocs site create → connect → publish.',
        '',
        'Each site will be available at:',
        '  <instance-origin>/<slug>/',
      ].join('\n'),
    );

    const displayRaw = await ctx.terminal.promptLine('Instance name (label only):');
    const display_name = normalizeDisplayName(displayRaw);
    if (!display_name) throw usageError('Invalid instance name.');

    // Auth + account before origin choice (needed for zones / workers.dev subdomain).
    const tempDir = options.mkdtemp ? await options.mkdtemp() : await createNeutralTemp();
    try {
      if (options.runCommand) {
        await resolveCloudflareCredential(ctx.runtime, options.runCommand, tempDir);
      }
    } finally {
      if (options.rmTemp) await options.rmTemp(tempDir);
    }

    const accounts = await cf.listAccounts().catch(mapCfError);
    let account_id: string;
    const pinned = await resolveCloudflareAccountId(ctx.runtime);
    if (pinned) {
      if (!accounts.some((a) => a.id === pinned)) {
        throw authorityError('CLOUDFLARE_ACCOUNT_ID is not accessible to this credential.');
      }
      account_id = pinned;
    } else if (accounts.length === 1) {
      account_id = accounts[0]!.id;
    } else if (accounts.length === 0) {
      throw authorityError('No Cloudflare accounts are accessible.');
    } else {
      presentHumanSuccess(
        ctx.runtime,
        accounts.map((a, i) => `  [${i + 1}] ${a.name} (${a.id})`).join('\n'),
      );
      const choice = Number((await ctx.terminal.promptLine('Account number:')).trim());
      if (!Number.isInteger(choice) || choice < 1 || choice > accounts.length) {
        throw usageError('Invalid account selection.');
      }
      account_id = accounts[choice - 1]!.id;
    }

    const suffix = generateResourceSuffix(randomBytes(16));
    const names = plannedResourceNames(account_id, suffix);
    const instance_id = generateInstanceId(randomBytes(16));
    const accountSubdomain = await cf.getWorkersDevSubdomain(account_id).catch(mapCfError);
    const plannedWorkersDevOrigin = workersDevOrigin(names.worker_name, accountSubdomain);

    const custom_hostname = await promptPublishOrigin(
      ctx,
      cf,
      account_id,
      plannedWorkersDevOrigin,
      domainFlag,
    );

    descriptor = {
      instance_id,
      display_name,
      canonical_origin: '',
      custom_hostname,
      account_id,
      resource_suffix: suffix,
      database_id: '',
      bucket_name: names.bucket_name,
      worker_name: names.worker_name,
      status: 'provisioning',
      deployed_version: packageVersion,
      reconciliation: {
        completed_steps: [],
        resume_hint: `nrdocs deploy --instance ${instance_id}`,
      },
    };
    await writeInstanceDescriptor(ctx.runtime, descriptor);
  } else if (descriptor) {
    presentHumanSuccess(
      ctx.runtime,
      [
        'Updating existing instance (not creating a new one):',
        `  Name:      ${descriptor.display_name}`,
        `  Instance:  ${descriptor.instance_id}`,
        ...(descriptor.canonical_origin ? [`  Origin:    ${descriptor.canonical_origin}`] : []),
      ].join('\n'),
    );
  }

  if (!descriptor) {
    throw new CliError({
      code: 'internal',
      phase: 'internal',
      exit_code: ExitCode.InternalSoftware,
      safe_message: 'Deploy is missing an instance descriptor.',
    });
  }

  presentHumanSuccess(
    ctx.runtime,
    isNew ? 'Creating Cloudflare resources...' : 'Updating Cloudflare resources...',
  );

  try {
    descriptor = await reconcileInstance(ctx, cf, descriptor, {
      packageVersion,
      openD1: options.openD1,
      randomBytes,
      isResume: !isNew,
    });
  } catch (error) {
    // reconcileInstance persists progress to disk as steps complete, but the
    // in-memory `descriptor` is only reassigned on success. Re-read so a failure
    // does not wipe completed_steps / database_id with the pre-reconcile snapshot.
    let progressed = descriptor;
    try {
      progressed = await readInstanceDescriptor(ctx.runtime, descriptor.instance_id);
    } catch {
      /* keep caller snapshot */
    }
    const failed = {
      ...progressed,
      status: (progressed.status === 'active' ? 'degraded' : 'provisioning') as
        'degraded' | 'provisioning',
      reconciliation: {
        completed_steps: [...stepsOf(progressed)],
        resume_hint: `nrdocs deploy --instance ${progressed.instance_id}`,
      },
    };
    await writeInstanceDescriptor(ctx.runtime, failed);
    presentHumanSuccess(
      ctx.runtime,
      `Deployment incomplete.\n\nResume with:\n  nrdocs deploy --instance ${failed.instance_id}`,
    );
    mapCfError(error);
  }

  const cwdAfter = await snapshotDir(ctx.runtime.cwd, ctx);
  if (cwdBefore !== cwdAfter) {
    throw new CliError({
      code: 'internal',
      phase: 'internal',
      exit_code: ExitCode.InternalSoftware,
      safe_message: 'Deploy mutated the invocation directory.',
    });
  }

  // New deploy becomes active. Resume via --instance does not rewrite active-instance.
  if (isNew) {
    await writeActiveInstanceId(ctx.runtime, descriptor.instance_id);
  }

  presentHumanSuccess(
    ctx.runtime,
    [
      'nrdocs deployed.',
      '',
      `Name:      ${descriptor.display_name}`,
      `Origin:    ${descriptor.canonical_origin}`,
      `Instance:  ${descriptor.instance_id}`,
      `Status:    active administrative instance`,
      '',
      'Documentation sites on this instance will be published at:',
      `  ${descriptor.canonical_origin}/<slug>/`,
      '',
      'Next:',
      '  nrdocs site create <slug>',
    ].join('\n'),
  );
}

function completedOrStableSteps(desc: InstanceDescriptor): Set<string> {
  if (desc.status === 'active' && desc.reconciliation === null) {
    return new Set(['preflight', 'd1', 'r2', 'migrations', 'origin']);
  }
  return stepsOf(desc);
}

async function reconcileInstance(
  ctx: CommandContext,
  cf: CloudflareControlPlane,
  initial: InstanceDescriptor,
  options: {
    packageVersion: string;
    openD1?: DeployOptions['openD1'];
    randomBytes: (n: number) => Uint8Array;
    isResume: boolean;
  },
): Promise<InstanceDescriptor> {
  let desc = initial;
  const done = completedOrStableSteps(desc);
  const preserveSessionKey =
    initial.status === 'active' || initial.status === 'degraded' || stepsOf(initial).has('worker');
  const names = plannedResourceNames(desc.account_id, desc.resource_suffix);

  const preflight = await cf.preflight(desc.account_id, desc.custom_hostname !== null);
  if (!preflight.ok) {
    if (preflight.missing === 'rate_limited') {
      throw new CloudflareApiError('rate_limited', 429, 'rate limited');
    }
    throw authorityError(`Missing Cloudflare capability:\n  ${preflight.missing}`);
  }
  desc = withStep(desc, 'preflight');
  await writeInstanceDescriptor(ctx.runtime, desc);

  // Domain eligibility
  let customDomainZone: { id: string; name: string } | undefined;
  if (desc.custom_hostname) {
    const zones = await cf.listZones(desc.account_id);
    const zone = findZoneForHostname(zones, desc.custom_hostname);
    if (!zone) {
      throw usageError('Custom domain must belong to an active Cloudflare zone in this account.');
    }
    customDomainZone = { id: zone.id, name: zone.name };
  }

  // D1
  if (!done.has('d1') || !desc.database_id) {
    const listed = await cf.listD1(desc.account_id);
    let db = listed.find((d) => d.name === names.database_name);
    if (!db) {
      try {
        db = await cf.createD1(desc.account_id, names.database_name);
      } catch (error) {
        if (error instanceof CloudflareApiError && error.kind === 'already_exists') {
          db = (await cf.listD1(desc.account_id)).find((d) => d.name === names.database_name);
        } else throw error;
      }
    }
    if (!db) throw new CloudflareApiError('api_error', 500, 'D1 database missing after create.');
    // Ownership: empty DB is adoptable only when we create/own the name under our suffix.
    desc = {
      ...desc,
      database_id: db.uuid,
      worker_name: names.worker_name,
      bucket_name: names.bucket_name,
    };
    desc = withStep(desc, 'd1');
    await writeInstanceDescriptor(ctx.runtime, desc);
  }

  // R2 + marker
  if (!done.has('r2')) {
    const buckets = await cf.listR2(desc.account_id);
    if (!buckets.some((b) => b.name === names.bucket_name)) {
      try {
        await cf.createR2(desc.account_id, names.bucket_name);
      } catch (error) {
        if (!(error instanceof CloudflareApiError && error.kind === 'already_exists')) throw error;
      }
    }
    const existing = await cf.getR2Object(
      desc.account_id,
      names.bucket_name,
      '_nrdocs/instance.json',
    );
    const marker: R2InstanceMarker = {
      schema_version: 1,
      instance_id: desc.instance_id,
      account_id: desc.account_id,
      resource_suffix: desc.resource_suffix,
      package_version: options.packageVersion,
    };
    if (existing) {
      let parsed: R2InstanceMarker;
      try {
        parsed = JSON.parse(new TextDecoder().decode(existing)) as R2InstanceMarker;
      } catch {
        throw authorityError('R2 ownership marker is malformed; refusing to adopt bucket.');
      }
      if (parsed.instance_id !== desc.instance_id || parsed.account_id !== desc.account_id) {
        throw authorityError('R2 bucket ownership marker mismatch; refusing to adopt.');
      }
    } else {
      await cf.putR2Object(
        desc.account_id,
        names.bucket_name,
        '_nrdocs/instance.json',
        new TextEncoder().encode(`${JSON.stringify(marker)}\n`),
      );
    }
    desc = withStep(desc, 'r2');
    await writeInstanceDescriptor(ctx.runtime, desc);
  }

  // Migrations + instance_metadata
  if (!done.has('migrations')) {
    if (options.openD1) {
      const db = await options.openD1(desc.database_id);
      await applyMigrations(db);
      try {
        await getInstanceMetadata(db);
      } catch {
        await insertInstanceMetadata(db, {
          id: desc.instance_id,
          display_name: desc.display_name,
          account_id: desc.account_id,
          resource_suffix: desc.resource_suffix,
          canonical_origin: desc.canonical_origin || 'https://placeholder.example.workers.dev',
          deployed_version: options.packageVersion,
        });
      }
    } else {
      const schema = await cf.d1Query(
        desc.account_id,
        desc.database_id,
        `SELECT name
           FROM sqlite_master
          WHERE type = 'table'
            AND name = 'schema_migrations'
          LIMIT 1`,
      );
      if (schema.results.length === 0) {
        const { MIGRATIONS } = await import('@nrdocs/persistence');
        const statements = MIGRATIONS.flatMap((m) =>
          m.statements.map((sql) => ({ sql, params: [] as Array<string | number | null> })),
        );
        await cf.d1Batch(desc.account_id, desc.database_id, statements);
      }
      const result = await cf.d1Query(
        desc.account_id,
        desc.database_id,
        'SELECT id FROM instance_metadata',
      );
      if (result.results.length === 0) {
        await cf.d1Batch(desc.account_id, desc.database_id, [
          {
            sql: `INSERT INTO instance_metadata (
              id, display_name, account_id, resource_suffix, canonical_origin,
              deployed_version, schema_version, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
            params: [
              desc.instance_id,
              desc.display_name,
              desc.account_id,
              desc.resource_suffix,
              desc.canonical_origin || 'https://placeholder.example.workers.dev',
              options.packageVersion,
              new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
            ],
          },
        ]);
      }
    }
    desc = withStep(desc, 'migrations');
    await writeInstanceDescriptor(ctx.runtime, desc);
  }

  // Worker
  let workersDevUrl: string | null = null;
  if (!done.has('worker')) {
    if (desc.custom_hostname && !customDomainZone) {
      const zones = await cf.listZones(desc.account_id);
      const zone = findZoneForHostname(zones, desc.custom_hostname);
      if (!zone) {
        throw usageError('Custom domain must belong to an active Cloudflare zone in this account.');
      }
      customDomainZone = { id: zone.id, name: zone.name };
    }
    const plannedOrigin = desc.custom_hostname
      ? `https://${desc.custom_hostname}`
      : desc.canonical_origin ||
        workersDevOrigin(names.worker_name, await cf.getWorkersDevSubdomain(desc.account_id));
    const result = await cf.deployWorker({
      accountId: desc.account_id,
      workerName: names.worker_name,
      databaseId: desc.database_id,
      bucketName: names.bucket_name,
      instanceId: desc.instance_id,
      packageVersion: options.packageVersion,
      script: BUNDLED_WORKER_MODULE,
      platformCss: BUNDLED_PLATFORM_CSS,
      platformJs: BUNDLED_PLATFORM_JS,
      platformMermaid: BUNDLED_PLATFORM_MERMAID,
      createSessionKey: !preserveSessionKey,
      ...(preserveSessionKey ? {} : { sessionKeyBytes: options.randomBytes(32) }),
      workersDev: desc.custom_hostname === null,
      customDomain: desc.custom_hostname,
      canonicalOrigin: plannedOrigin.replace(/\/$/, ''),
      ...(customDomainZone
        ? {
            customDomainZoneId: customDomainZone.id,
            customDomainZoneName: customDomainZone.name,
          }
        : {}),
    });
    workersDevUrl = result.workersDevUrl;
    desc = withStep(desc, 'worker');
    await writeInstanceDescriptor(ctx.runtime, desc);
  }

  // Origin
  if (!done.has('origin') || !desc.canonical_origin) {
    let origin: string;
    if (desc.custom_hostname !== null) {
      origin = `https://${desc.custom_hostname}`;
    } else if (workersDevUrl) {
      origin = workersDevUrl;
    } else {
      const subdomain = await cf.getWorkersDevSubdomain(desc.account_id);
      origin = workersDevOrigin(names.worker_name, subdomain);
    }
    desc = { ...desc, canonical_origin: origin };
    // Migrations may have written a temporary placeholder origin before the Worker
    // URL was known — sync D1 so publish responses show the real site URL.
    if (options.openD1) {
      const db = await options.openD1(desc.database_id);
      await updateInstanceCanonicalOrigin(db, origin);
    } else {
      await cf.d1Batch(desc.account_id, desc.database_id, [
        {
          sql: `UPDATE instance_metadata SET canonical_origin = ?`,
          params: [origin],
        },
      ]);
    }
    desc = withStep(desc, 'origin');
    await writeInstanceDescriptor(ctx.runtime, desc);
  }

  // Smoke — workers.dev routing can lag 30–90s+ after subdomain enable;
  // custom domains also need DNS + TLS activation.
  if (!done.has('smoke')) {
    const { version, root } = await waitForOriginSmoke(
      cf.smokeGet.bind(cf),
      desc.canonical_origin,
      {
        attempts: 60,
        delayMs: 3000,
        maxConsecutiveDnsMisses: desc.custom_hostname ? 20 : 8,
        onRetry: async (attempt) => {
          if (desc.custom_hostname !== null) return;
          if (attempt === 0 || attempt % 5 !== 0) return;
          await cf.enableWorkersDev(desc.account_id, names.worker_name);
        },
      },
    );
    if (version.status !== 200 || root.status !== 200) {
      const lines = [
        `Smoke test failed against ${desc.canonical_origin}`,
        `  /_nrdocs/api/version → HTTP ${version.status}`,
        `  /                    → HTTP ${root.status}`,
      ];
      if (version.status === 0 || root.status === 0) {
        lines.push(
          '',
          'HTTP 0 means the hostname did not resolve or TLS could not connect from this machine.',
          'Public DNS may still be propagating. Check with:',
          `  dig @1.1.1.1 ${desc.custom_hostname ?? new URL(desc.canonical_origin).hostname} A`,
          'Then resume:',
          `  nrdocs deploy --instance ${desc.instance_id}`,
        );
      }
      throw new CloudflareApiError('api_error', 500, lines.join('\n'));
    }
    desc = withStep(desc, 'smoke');
    await writeInstanceDescriptor(ctx.runtime, desc);
  }

  desc = {
    ...desc,
    status: 'active',
    deployed_version: options.packageVersion,
    reconciliation: null,
  };
  await writeInstanceDescriptor(ctx.runtime, desc);
  return desc;
}

async function snapshotDir(dir: string, ctx: CommandContext): Promise<string> {
  try {
    const names = await ctx.runtime.fs.readdir(dir);
    return names.sort().join('\n');
  } catch {
    return '';
  }
}

async function createNeutralTemp(): Promise<string> {
  const os = await import('node:os');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  return fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-deploy-'));
}

export { resolveCloudflareAccountId, resolveCloudflareCredential } from './deploy/auth.js';
export { createFakeCloudflare } from './deploy/fake-cloudflare.js';
