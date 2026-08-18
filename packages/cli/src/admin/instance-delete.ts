/**
 * Tear down a local instance and its owned Cloudflare resources.
 */
import { assertDescriptorConsistency, type SqlExecutor } from '@nrdocs/persistence';
import { parseInstanceId, type InstanceDescriptor, type InstanceId } from '@nrdocs/contracts';
import type { CommandContext } from '../command-context.js';
import { parseFlags } from '../argv.js';
import {
  clearActiveInstanceIdIf,
  deleteInstanceDescriptor,
  readInstanceDescriptor,
} from '../instance-store.js';
import { requireInteractiveTerminal, confirmPhraseOrDecline } from '../terminal.js';
import { presentHumanSuccess } from '../present.js';
import { credentialError, usageError } from '../errors.js';
import {
  CloudflareApiError,
  type CloudflareControlPlane,
  type R2InstanceMarker,
} from '../deploy/cloudflare.js';

export type InstanceDeleteOptions = {
  cloudflare?: CloudflareControlPlane;
  /** When set, used to verify D1 instance_metadata ownership. */
  openDb?: (descriptor: InstanceDescriptor) => Promise<SqlExecutor>;
};

function isNotFound(error: unknown): boolean {
  return (
    error instanceof CloudflareApiError &&
    (error.status === 404 || /not found|does not exist/i.test(error.message))
  );
}

async function resolveBackends(
  ctx: CommandContext,
  options: InstanceDeleteOptions,
): Promise<{ cf: CloudflareControlPlane; openDb?: InstanceDeleteOptions['openDb'] }> {
  if (options.cloudflare) {
    return { cf: options.cloudflare, openDb: options.openDb };
  }
  const { createDefaultDeployOptions } = await import('../deploy/production.js');
  const deploy = await createDefaultDeployOptions(ctx.runtime);
  if (!deploy.cloudflare) {
    throw usageError('Cloudflare control plane is not available in this build path.');
  }
  const cf = deploy.cloudflare;
  const openDb =
    options.openDb ??
    (async (descriptor: InstanceDescriptor) => {
      const { createAdminD1Executor } = await import('../deploy/production.js');
      return createAdminD1Executor(cf, descriptor);
    });
  return { cf, openDb };
}

async function verifyOwnership(
  desc: InstanceDescriptor,
  cf: CloudflareControlPlane,
  openDb: InstanceDeleteOptions['openDb'],
  notes: string[],
): Promise<void> {
  if (desc.bucket_name) {
    const buckets = await cf.listR2(desc.account_id);
    if (buckets.some((b) => b.name === desc.bucket_name)) {
      const markerBytes = await cf.getR2Object(
        desc.account_id,
        desc.bucket_name,
        '_nrdocs/instance.json',
      );
      if (!markerBytes) {
        throw credentialError(
          `R2 ownership marker missing for bucket:\n  ${desc.bucket_name}\nRefusing to delete.`,
        );
      }
      let marker: R2InstanceMarker;
      try {
        marker = JSON.parse(new TextDecoder().decode(markerBytes)) as R2InstanceMarker;
      } catch {
        throw credentialError('R2 ownership marker is malformed; refusing to delete.');
      }
      if (marker.instance_id !== desc.instance_id || marker.account_id !== desc.account_id) {
        throw credentialError('R2 ownership marker mismatch; refusing to delete.');
      }
    } else {
      notes.push(`R2 bucket not found (skipped): ${desc.bucket_name}`);
    }
  }

  if (desc.database_id) {
    const d1List = await cf.listD1(desc.account_id);
    if (d1List.some((d) => d.uuid === desc.database_id)) {
      if (!openDb) {
        throw usageError('D1 verification backend is not wired in this build path.');
      }
      const db = await openDb(desc);
      await assertDescriptorConsistency(db, desc);
    } else {
      notes.push(`D1 database not found (skipped): ${desc.database_id}`);
    }
  }
}

async function emptyAndDeleteBucket(
  cf: CloudflareControlPlane,
  accountId: string,
  bucket: string,
  notes: string[],
): Promise<void> {
  const buckets = await cf.listR2(accountId);
  if (!buckets.some((b) => b.name === bucket)) {
    notes.push(`R2 bucket already absent: ${bucket}`);
    return;
  }
  let cursor: string | undefined;
  for (;;) {
    const page = await cf.listR2Objects(accountId, bucket, '', {
      ...(cursor ? { cursor } : {}),
      limit: 500,
    });
    for (const key of page.keys) {
      await cf.deleteR2Object(accountId, bucket, key);
    }
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  await cf.deleteR2Bucket(accountId, bucket);
}

export async function runInstanceDeleteCommand(
  ctx: CommandContext,
  args: readonly string[],
  options: InstanceDeleteOptions = {},
): Promise<void> {
  if (ctx.help) {
    presentHumanSuccess(
      ctx.runtime,
      [
        'nrdocs instance delete <instance-id>',
        '',
        'Permanently deletes the Cloudflare Worker, R2 bucket, and D1 database',
        'owned by this local instance descriptor, then removes local state.',
      ].join('\n') + '\n',
    );
    return;
  }
  if (ctx.json) throw usageError('instance delete does not support --json.');
  requireInteractiveTerminal(ctx.runtime, 'instance delete');

  const { positionals } = parseFlags(args);
  if (positionals.length !== 1) {
    throw usageError('instance delete requires exactly one opaque instance ID.');
  }
  const instanceId = parseInstanceId(positionals[0]);
  if (!instanceId) {
    throw usageError('instance delete requires a valid opaque instance ID.');
  }
  const desc = await readInstanceDescriptor(ctx.runtime, instanceId as InstanceId);

  presentHumanSuccess(
    ctx.runtime,
    [
      'This permanently deletes the Cloudflare instance and local descriptor:',
      `  name:    ${desc.display_name}`,
      `  id:      ${desc.instance_id}`,
      `  origin:  ${desc.canonical_origin || '(none)'}`,
      `  worker:  ${desc.worker_name || '(none)'}`,
      `  D1:      ${desc.database_id || '(none)'}`,
      `  R2:      ${desc.bucket_name || '(none)'}`,
      '',
      'All sites, publications, tokens, and reader sessions on this instance are destroyed.',
      'There is no recovery.',
    ].join('\n'),
  );

  if (
    (await confirmPhraseOrDecline(
      ctx.terminal,
      `Type the instance ID to confirm (${desc.instance_id}):`,
      desc.instance_id,
    )) === 'declined'
  ) {
    presentHumanSuccess(ctx.runtime, 'Cancelled.');
    return;
  }

  const { cf, openDb } = await resolveBackends(ctx, options);
  const notes: string[] = [];
  await verifyOwnership(desc, cf, openDb, notes);

  if (desc.worker_name) {
    try {
      await cf.deleteWorker(desc.account_id, desc.worker_name);
    } catch (error) {
      if (isNotFound(error)) notes.push(`Worker already absent: ${desc.worker_name}`);
      else throw error;
    }
  } else {
    notes.push('Worker name empty (skipped).');
  }

  if (desc.bucket_name) {
    try {
      await emptyAndDeleteBucket(cf, desc.account_id, desc.bucket_name, notes);
    } catch (error) {
      if (isNotFound(error)) notes.push(`R2 bucket already absent: ${desc.bucket_name}`);
      else throw error;
    }
  }

  if (desc.database_id) {
    try {
      await cf.deleteD1(desc.account_id, desc.database_id);
    } catch (error) {
      if (isNotFound(error)) notes.push(`D1 already absent: ${desc.database_id}`);
      else throw error;
    }
  }

  const clearedActive = await clearActiveInstanceIdIf(ctx.runtime, desc.instance_id);
  await deleteInstanceDescriptor(ctx.runtime, desc.instance_id);

  const lines = [
    'Instance deleted.',
    '',
    `ID:    ${desc.instance_id}`,
    `Name:  ${desc.display_name}`,
  ];
  if (clearedActive) {
    lines.push('', 'Cleared active-instance pointer (no instance is selected).');
  }
  if (notes.length > 0) {
    lines.push('', 'Notes:', ...notes.map((n) => `  ${n}`));
  }
  presentHumanSuccess(ctx.runtime, lines.join('\n'));
}
