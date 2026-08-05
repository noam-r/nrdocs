import {
  applyMigrations,
  insertInstanceMetadata,
  getInstanceMetadata,
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
      'nrdocs deploy [--domain <hostname>] [--instance <instance-id>]\n',
    );
    return;
  }
  if (ctx.json) throw usageError('deploy does not support --json.');
  requireInteractiveTerminal(ctx.runtime, 'deploy');

  if (!options.cloudflare) {
    const { createDefaultDeployOptions } = await import('./deploy/production.js');
    options = { ...(await createDefaultDeployOptions(ctx.runtime)), ...options };
  }

  const { flags, positionals } = parseFlags(args, {
    string: ['--domain', '--instance'],
  });
  if (positionals.length > 0) throw usageError('deploy does not take positional arguments.');
  if (ctx.instance !== undefined && flags['--instance'] !== undefined) {
    throw usageError('Pass --instance at most once.');
  }
  const instanceFlag =
    (typeof flags['--instance'] === 'string' ? flags['--instance'] : undefined) ?? ctx.instance;
  const domainFlag = typeof flags['--domain'] === 'string' ? flags['--domain'] : undefined;
  if (domainFlag !== undefined) {
    const host = parseCanonicalHostname(domainFlag);
    if (!host) throw usageError('Invalid --domain hostname.');
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

  let descriptor: InstanceDescriptor;
  let isNew = false;

  if (instanceFlag) {
    const id = parseInstanceId(instanceFlag);
    if (!id) throw usageError('--instance requires a valid opaque instance ID.');
    descriptor = await readInstanceDescriptor(ctx.runtime, id);
  } else {
    isNew = true;
    const displayRaw = await ctx.terminal.promptLine('Instance name:');
    const display_name = normalizeDisplayName(displayRaw);
    if (!display_name) throw usageError('Invalid instance name.');

    let custom_hostname: string | null = null;
    if (domainFlag) {
      custom_hostname = parseCanonicalHostname(domainFlag);
    } else {
      const wantDomain = await promptYesNo(ctx.terminal, 'Custom domain? [y/N]');
      if (wantDomain) {
        const entered = parseCanonicalHostname(await ctx.terminal.promptLine('Hostname:'));
        if (!entered) throw usageError('Invalid custom hostname.');
        custom_hostname = entered;
      }
    }

    // Auth + account before first mutation.
    const tempDir = options.mkdtemp ? await options.mkdtemp() : await createNeutralTemp();
    try {
      if (!options.runCommand && !options.cloudflare) {
        // unreachable due to cloudflare check above
      }
      // Credential resolution is required for real deploys; fakes inject cloudflare only.
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
  }

  presentHumanSuccess(ctx.runtime, 'Creating Cloudflare resources...');

  const initialDescriptorSnapshot = isNew ? null : { ...descriptor };

  try {
    descriptor = await reconcileInstance(ctx, cf, descriptor, {
      packageVersion,
      openD1: options.openD1,
      randomBytes,
      isResume: !isNew,
    });
  } catch (error) {
    const failed = {
      ...descriptor,
      status: (descriptor.status === 'active' ? 'degraded' : 'provisioning') as
        'degraded' | 'provisioning',
      reconciliation: {
        completed_steps: [...stepsOf(descriptor)],
        resume_hint: `nrdocs deploy --instance ${descriptor.instance_id}`,
      },
    };
    await writeInstanceDescriptor(ctx.runtime, failed);
    presentHumanSuccess(
      ctx.runtime,
      `Deployment incomplete.\n\nResume with:\n  nrdocs deploy --instance ${descriptor.instance_id}`,
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

  if (
    !isNew &&
    initialWasActiveComplete(initialDescriptorSnapshot) &&
    descriptor.status === 'active' &&
    descriptor.deployed_version === packageVersion
  ) {
    presentHumanSuccess(ctx.runtime, 'unchanged');
    return;
  }

  presentHumanSuccess(
    ctx.runtime,
    [
      'nrdocs deployed.',
      '',
      `Name:      ${descriptor.display_name}`,
      `URL:       ${descriptor.canonical_origin}`,
      `Instance:  ${descriptor.instance_id}`,
      `Status:    active administrative instance`,
      '',
      'Next:',
      '  nrdocs site create <slug>',
    ].join('\n'),
  );
}

function initialWasActiveComplete(desc: InstanceDescriptor | null): boolean {
  return (
    desc !== null &&
    desc.status === 'active' &&
    desc.reconciliation === null &&
    desc.canonical_origin !== '' &&
    desc.database_id !== ''
  );
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
  const done = stepsOf(desc);
  const names = plannedResourceNames(desc.account_id, desc.resource_suffix);

  if (
    options.isResume &&
    initial.status === 'active' &&
    initial.reconciliation === null &&
    initial.deployed_version === options.packageVersion &&
    initial.database_id !== '' &&
    initial.canonical_origin !== ''
  ) {
    const preflight = await cf.preflight(desc.account_id, desc.custom_hostname !== null);
    if (!preflight.ok) {
      throw authorityError(`Missing Cloudflare capability:\n  ${preflight.missing}`);
    }
    const markerBytes = await cf.getR2Object(
      desc.account_id,
      names.bucket_name,
      '_nrdocs/instance.json',
    );
    if (!markerBytes) throw authorityError('R2 ownership marker missing.');
    const marker = JSON.parse(new TextDecoder().decode(markerBytes)) as R2InstanceMarker;
    if (marker.instance_id !== desc.instance_id) {
      throw authorityError('R2 ownership marker mismatch.');
    }
    const version = await cf.smokeGet(`${desc.canonical_origin}/_nrdocs/api/version`);
    const root = await cf.smokeGet(`${desc.canonical_origin}/`);
    if (version.status !== 200 || root.status !== 200) {
      throw new CloudflareApiError('api_error', 500, 'Smoke test failed against canonical origin.');
    }
    return initial;
  }

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
  if (desc.custom_hostname) {
    const zones = await cf.listZones(desc.account_id, parentZone(desc.custom_hostname));
    const zone = zones.find((z) => z.status === 'active');
    if (!zone) throw usageError('Custom domain zone is not active in this account.');
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
      const { MIGRATIONS } = await import('@nrdocs/persistence');
      const statements = MIGRATIONS.flatMap((m) =>
        m.statements.map((sql) => ({ sql, params: [] as Array<string | number | null> })),
      );
      await cf.d1Batch(desc.account_id, desc.database_id, statements);
      const rows = await cf.d1Query(
        desc.account_id,
        desc.database_id,
        'SELECT id FROM instance_metadata',
      );
      if (rows.length === 0) {
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
      createSessionKey: true,
      sessionKeyBytes: options.randomBytes(32),
      workersDev: desc.custom_hostname === null,
      customDomain: desc.custom_hostname,
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
    desc = withStep(desc, 'origin');
    await writeInstanceDescriptor(ctx.runtime, desc);
  }

  // Smoke — workers.dev routing can lag 30–90s+ after subdomain enable.
  if (!done.has('smoke')) {
    const { version, root } = await waitForOriginSmoke(cf.smokeGet.bind(cf), desc.canonical_origin, {
      attempts: 60,
      delayMs: 3000,
      onRetry: async (attempt) => {
        if (desc.custom_hostname !== null) return;
        if (attempt === 0 || attempt % 5 !== 0) return;
        await cf.enableWorkersDev(desc.account_id, names.worker_name);
      },
    });
    if (version.status !== 200 || root.status !== 200) {
      throw new CloudflareApiError(
        'api_error',
        500,
        `Smoke test failed against canonical origin (version=${version.status}, root=${root.status}).`,
      );
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

function parentZone(hostname: string): string {
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join('.');
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
