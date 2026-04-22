/**
 * StorageProvider — platform-agnostic interface for object storage operations.
 *
 * Phase 1 implementation: R2StorageProvider backed by Cloudflare R2.
 * Abstracted per Requirement 18.1 so alternative storage backends
 * can be substituted without modifying core logic.
 */
export interface StorageProvider {
  /** Upload a single artifact to a path. */
  put(path: string, content: ArrayBuffer, contentType: string): Promise<void>;

  /** Read an artifact by path. Returns null if the object does not exist. */
  get(path: string): Promise<{ content: ArrayBuffer; contentType: string } | null>;

  /** Delete a single artifact. */
  delete(path: string): Promise<void>;

  /** List object keys under a prefix. */
  list(prefix: string): Promise<string[]>;

  /** Delete all objects under a prefix. */
  deletePrefix(prefix: string): Promise<void>;
}
