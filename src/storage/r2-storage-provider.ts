import type { StorageProvider } from '../interfaces/storage-provider';

/**
 * R2StorageProvider — Cloudflare R2 implementation of the StorageProvider interface.
 *
 * Phase 1 implementation backed by Cloudflare R2.
 * Requirement 13.1: Upload built artifacts to R2 using stable paths keyed by project slug.
 * Requirement 18.1: Abstracted behind the StorageProvider interface.
 */
export class R2StorageProvider implements StorageProvider {
  constructor(private readonly bucket: R2Bucket) {}

  async put(
    path: string,
    content: ArrayBuffer,
    contentType: string,
  ): Promise<void> {
    await this.bucket.put(path, content, {
      httpMetadata: { contentType },
    });
  }

  async get(
    path: string,
  ): Promise<{ content: ArrayBuffer; contentType: string } | null> {
    const obj = await this.bucket.get(path);
    if (obj === null) {
      return null;
    }
    return {
      content: await obj.arrayBuffer(),
      contentType:
        obj.httpMetadata?.contentType ?? 'application/octet-stream',
    };
  }

  async delete(path: string): Promise<void> {
    await this.bucket.delete(path);
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;

    do {
      const result = await this.bucket.list({
        prefix,
        cursor,
      });
      for (const obj of result.objects) {
        keys.push(obj.key);
      }
      cursor = result.truncated ? result.cursor : undefined;
    } while (cursor);

    return keys;
  }

  async deletePrefix(prefix: string): Promise<void> {
    const keys = await this.list(prefix);
    // R2 delete supports arrays of up to 1000 keys per call.
    const batchSize = 1000;
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      await this.bucket.delete(batch);
    }
  }
}
