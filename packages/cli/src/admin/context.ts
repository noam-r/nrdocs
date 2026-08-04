import {
  assertDescriptorConsistency,
  deleteSitePrefix,
  MemoryArtifactStore,
  type ArtifactObjectStore,
  type SqlExecutor,
} from '@nrdocs/persistence';
import type { InstanceDescriptor, InstanceId, SiteId } from '@nrdocs/contracts';
import type { CommandContext } from '../command-context.js';
import { resolveTargetInstanceId, readInstanceDescriptor } from '../instance-store.js';
import { requireInteractiveTerminal } from '../terminal.js';
import { presentHumanSuccess } from '../present.js';
import { usageError } from '../errors.js';

export type AdminOptions = {
  /** Open a SqlExecutor for the selected instance (tests inject sqlite). */
  openDb?: (descriptor: InstanceDescriptor) => Promise<SqlExecutor>;
  /** R2 object store for site deletion (tests inject MemoryArtifactStore). */
  artifactStore?: ArtifactObjectStore;
};

export type AdminSession = {
  descriptor: InstanceDescriptor;
  instanceId: InstanceId;
  db: SqlExecutor;
  store: ArtifactObjectStore;
};

export async function beginAdminSession(
  ctx: CommandContext,
  action: string,
  options: AdminOptions,
  opts: { mutating: boolean },
): Promise<AdminSession> {
  if (opts.mutating) {
    requireInteractiveTerminal(ctx.runtime, action);
    if (ctx.json) throw usageError(`${action} does not support --json.`);
  }

  const instanceId = await resolveTargetInstanceId(ctx.runtime, ctx.instance);
  const descriptor = await readInstanceDescriptor(ctx.runtime, instanceId);

  if (!options.openDb) {
    throw usageError(
      'Administrative D1 backend is not wired in this build path.\nUse a control-plane-enabled CLI build.',
    );
  }
  const db = await options.openDb(descriptor);
  await assertDescriptorConsistency(db, descriptor);

  if (opts.mutating) {
    presentHumanSuccess(
      ctx.runtime,
      `Instance: ${descriptor.canonical_origin}\nID:       ${descriptor.instance_id}`,
    );
  }

  return {
    descriptor,
    instanceId,
    db,
    store: options.artifactStore ?? new MemoryArtifactStore(),
  };
}

export async function purgeSiteArtifacts(
  store: ArtifactObjectStore,
  siteId: SiteId,
): Promise<{ empty: boolean; deleted: number }> {
  return deleteSitePrefix(store, siteId);
}
