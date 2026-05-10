/**
 * Build query helpers for D1.
 */

import type { BuildRecord } from '@nrdocs/shared';
import { generateId } from './id.js';

export interface CreateBuildInput {
  repo_id: string;
  github_repository_id: string;
  git_sha: string;
  git_ref?: string;
  workflow_ref?: string;
  run_id?: string;
}

export async function createBuild(
  db: D1Database,
  input: CreateBuildInput,
): Promise<BuildRecord> {
  const id = generateId('build_');
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO builds (id, repo_id, github_repository_id, git_sha, git_ref, workflow_ref, run_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading', ?)`,
    )
    .bind(
      id,
      input.repo_id,
      input.github_repository_id,
      input.git_sha,
      input.git_ref ?? null,
      input.workflow_ref ?? null,
      input.run_id ?? null,
      now,
    )
    .run();

  const build = await db
    .prepare('SELECT * FROM builds WHERE id = ?')
    .bind(id)
    .first<BuildRecord>();
  return build!;
}

export async function markBuildSuccess(
  db: D1Database,
  buildId: string,
  artifactPrefix: string,
  sizeBytes: number,
  fileCount: number,
  contentHash: string,
): Promise<BuildRecord> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE builds SET status = 'success', artifact_prefix = ?, artifact_size_bytes = ?, file_count = ?, content_hash = ?, completed_at = ? WHERE id = ?`,
    )
    .bind(artifactPrefix, sizeBytes, fileCount, contentHash, now, buildId)
    .run();

  const build = await db
    .prepare('SELECT * FROM builds WHERE id = ?')
    .bind(buildId)
    .first<BuildRecord>();
  return build!;
}

export async function markBuildFailed(
  db: D1Database,
  buildId: string,
  errorCode: string,
  errorMessage: string,
): Promise<BuildRecord> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE builds SET status = 'failed', error_code = ?, error_message = ?, completed_at = ? WHERE id = ?`,
    )
    .bind(errorCode, errorMessage, now, buildId)
    .run();

  const build = await db
    .prepare('SELECT * FROM builds WHERE id = ?')
    .bind(buildId)
    .first<BuildRecord>();
  return build!;
}

export async function findBuildById(
  db: D1Database,
  buildId: string,
): Promise<BuildRecord | null> {
  const result = await db
    .prepare('SELECT * FROM builds WHERE id = ?')
    .bind(buildId)
    .first<BuildRecord>();
  return result ?? null;
}
