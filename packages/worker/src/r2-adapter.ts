import type { ArtifactObjectStore } from '@nrdocs/persistence';

/** Minimal R2 bucket surface used by the Worker binding. */
export type R2BucketLike = {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | null,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
};

export function r2AsArtifactStore(bucket: R2BucketLike): ArtifactObjectStore {
  return {
    async put(object) {
      await bucket.put(object.key, object.body, {
        ...(object.contentType ? { httpMetadata: { contentType: object.contentType } } : {}),
      });
    },
    async get(key) {
      const obj = await bucket.get(key);
      if (!obj) return null;
      return new Uint8Array(await obj.arrayBuffer());
    },
    async delete(key) {
      await bucket.delete(key);
    },
    async list(prefix, options) {
      const page = await bucket.list({
        prefix,
        ...(options?.cursor !== undefined ? { cursor: options.cursor } : {}),
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
      });
      return {
        keys: page.objects.map((o) => o.key),
        ...(page.truncated && page.cursor ? { cursor: page.cursor } : {}),
      };
    },
  };
}
