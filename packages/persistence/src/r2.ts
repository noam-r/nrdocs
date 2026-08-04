import type { ArtifactId, SiteId } from '@nrdocs/contracts';
import { artifactObjectKey, artifactPrefix, sitePrefix } from './r2-keys.js';

export type ArtifactObject = {
  key: string;
  body: Uint8Array;
  contentType?: string;
};

/**
 * Private artifact object store (R2). D1 remains authoritative for which prefix is current.
 */
export type ArtifactObjectStore = {
  put(object: ArtifactObject): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  /** List object keys under a prefix; may be paginated by the adapter. */
  list(
    prefix: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{
    keys: string[];
    cursor?: string;
  }>;
};

export type StagingWrite = {
  siteId: SiteId;
  artifactId: ArtifactId;
  objects: ReadonlyArray<{ path: string; body: Uint8Array; contentType?: string }>;
};

export async function writeStagingArtifact(
  store: ArtifactObjectStore,
  write: StagingWrite,
): Promise<string> {
  const prefix = artifactPrefix(write.siteId, write.artifactId);
  for (const obj of write.objects) {
    const key = artifactObjectKey(write.siteId, write.artifactId, obj.path);
    await store.put({
      key,
      body: obj.body,
      ...(obj.contentType !== undefined ? { contentType: obj.contentType } : {}),
    });
  }
  return prefix;
}

export async function deletePrefixBestEffort(
  store: ArtifactObjectStore,
  prefix: string,
): Promise<{ deleted: number; remaining: number }> {
  let deleted = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await store.list(prefix, {
      ...(cursor !== undefined ? { cursor } : {}),
      limit: 1000,
    });
    for (const key of page.keys) {
      try {
        await store.delete(key);
        deleted += 1;
      } catch {
        // best-effort
      }
    }
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  const remaining = (await store.list(prefix, { limit: 1 })).keys.length;
  return { deleted, remaining };
}

/**
 * Delete every object under sites/{siteId}/. Returns whether a fresh listing is empty.
 */
export async function deleteSitePrefix(
  store: ArtifactObjectStore,
  siteId: SiteId,
): Promise<{ empty: boolean; deleted: number }> {
  const prefix = sitePrefix(siteId);
  let total = 0;
  // Keep deleting until a fresh listing is empty (or stall).
  for (let round = 0; round < 100; round++) {
    const page = await store.list(prefix, { limit: 1000 });
    if (page.keys.length === 0) {
      return { empty: true, deleted: total };
    }
    for (const key of page.keys) {
      await store.delete(key);
      total += 1;
    }
  }
  const left = (await store.list(prefix, { limit: 1 })).keys.length;
  return { empty: left === 0, deleted: total };
}

/**
 * Remove an orphan/staging prefix only when it is not the current artifact prefix.
 */
export async function cleanupOrphanPrefix(
  store: ArtifactObjectStore,
  options: {
    siteId: SiteId;
    candidateArtifactId: ArtifactId;
    currentArtifactId: ArtifactId | null;
  },
): Promise<{ deleted: number; skipped: boolean }> {
  if (
    options.currentArtifactId !== null &&
    options.candidateArtifactId === options.currentArtifactId
  ) {
    return { deleted: 0, skipped: true };
  }
  const prefix = artifactPrefix(options.siteId, options.candidateArtifactId);
  const result = await deletePrefixBestEffort(store, prefix);
  return { deleted: result.deleted, skipped: false };
}

/** In-memory R2 stand-in for conformance tests. */
export class MemoryArtifactStore implements ArtifactObjectStore {
  readonly objects = new Map<string, Uint8Array>();

  async put(object: ArtifactObject): Promise<void> {
    this.objects.set(object.key, object.body);
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(
    prefix: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<{ keys: string[]; cursor?: string }> {
    const limit = options.limit ?? 1000;
    const all = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    let start = 0;
    if (options.cursor) {
      const idx = all.indexOf(options.cursor);
      start = idx >= 0 ? idx + 1 : 0;
    }
    const slice = all.slice(start, start + limit);
    const next = start + limit < all.length ? slice[slice.length - 1] : undefined;
    return next !== undefined ? { keys: slice, cursor: next } : { keys: slice };
  }
}
