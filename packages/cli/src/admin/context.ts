import {
  assertDescriptorConsistency,
  deleteSitePrefix,
  MemoryArtifactStore,
  type ArtifactObjectStore,
  type SqlExecutor,
} from '@nrdocs/persistence';
import type { InstanceDescriptor, InstanceId, SiteId } from '@nrdocs/contracts';
import type { CommandContext } from '../command-context.js';
import {
  resolveTargetInstanceId,
  readInstanceDescriptor,
  readActiveInstanceId,
} from '../instance-store.js';
import { requireInteractiveTerminal } from '../terminal.js';
import { presentHumanSuccess } from '../present.js';
import { usageError } from '../errors.js';

export type AdminOptions = {
  /** Open a SqlExecutor for the selected instance (tests inject sqlite). */
  openDb?: (descriptor: InstanceDescriptor) => Promise<SqlExecutor>;
  /** Optional store factory; defaults to MemoryArtifactStore for tests. */
  openStore?: (descriptor: InstanceDescriptor) => Promise<ArtifactObjectStore>;
  /** Fixed store override (tests). */
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
    const { createDefaultAdminOptions } = await import('../deploy/production.js');
    options = { ...(await createDefaultAdminOptions(ctx.runtime)), ...options };
  }

  if (!options.openDb) {
    throw usageError(
      'Administrative D1 backend is not wired in this build path.\nUse a control-plane-enabled CLI build.',
    );
  }
  const db = await options.openDb(descriptor);
  await assertDescriptorConsistency(db, descriptor);

  let store: ArtifactObjectStore;
  if (options.artifactStore) {
    store = options.artifactStore;
  } else if (options.openStore) {
    store = await options.openStore(descriptor);
  } else {
    store = new MemoryArtifactStore();
  }

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
    store,
  };
}

/** Open an admin session when a local instance is selected; otherwise null. */
export async function tryBeginAdminSession(
  ctx: CommandContext,
  action: string,
  options: AdminOptions,
): Promise<AdminSession | null> {
  if (ctx.instance === undefined) {
    const active = await readActiveInstanceId(ctx.runtime);
    if (!active) return null;
  }
  return beginAdminSession(ctx, action, options, { mutating: false });
}

export async function purgeSiteArtifacts(
  store: ArtifactObjectStore,
  siteId: SiteId,
): Promise<{ empty: boolean; deleted: number }> {
  return deleteSitePrefix(store, siteId);
}
