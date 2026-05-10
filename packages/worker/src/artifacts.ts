/**
 * R2 artifact storage helpers.
 */

/**
 * Generates the R2 key prefix for a build's artifacts.
 * Format: artifacts/{repo_id}/{build_id}/
 */
export function buildArtifactPrefix(repoId: string, buildId: string): string {
  return `artifacts/${repoId}/${buildId}/`;
}

/**
 * Generates the full R2 key for a specific file within a build.
 */
export function buildArtifactKey(repoId: string, buildId: string, filePath: string): string {
  return `${buildArtifactPrefix(repoId, buildId)}${filePath}`;
}

/**
 * Stores a single file in R2 under the build prefix.
 */
export async function storeArtifactFile(
  r2: R2Bucket,
  repoId: string,
  buildId: string,
  filePath: string,
  content: ArrayBuffer | ReadableStream | string,
  contentType?: string,
): Promise<void> {
  const key = buildArtifactKey(repoId, buildId, filePath);
  const options: R2PutOptions = {};
  if (contentType) {
    options.httpMetadata = { contentType };
  }
  await r2.put(key, content, options);
}

/**
 * Retrieves a file from R2 for a given build.
 * Returns null if not found.
 */
export async function getArtifactFile(
  r2: R2Bucket,
  repoId: string,
  buildId: string,
  filePath: string,
): Promise<R2ObjectBody | null> {
  const key = buildArtifactKey(repoId, buildId, filePath);
  return r2.get(key);
}

/**
 * Lists all files under a build prefix.
 * Returns relative file paths (without the prefix).
 */
export async function listArtifactFiles(
  r2: R2Bucket,
  repoId: string,
  buildId: string,
): Promise<string[]> {
  const prefix = buildArtifactPrefix(repoId, buildId);
  const files: string[] = [];
  let cursor: string | undefined;

  do {
    const listed = await r2.list({ prefix, cursor });
    for (const obj of listed.objects) {
      files.push(obj.key.slice(prefix.length));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return files;
}
