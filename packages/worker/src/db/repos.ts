/**
 * Repo query helpers for D1.
 */

import type { RepoRecord, ApprovalState, AccessMode } from '@nrdocs/shared';
import { generateId } from './id.js';

/**
 * Coerce D1 INTEGER 0/1 columns to JS booleans on a raw repo row.
 */
export function normalizeRepo(row: Record<string, unknown>): RepoRecord {
  return {
    ...(row as unknown as RepoRecord),
    allow_repo_owner_password: (row as Record<string, unknown>)['allow_repo_owner_password'] === 1,
  };
}

export interface UpsertRepoInput {
  github_repository_id: string;
  owner: string;
  name: string;
  full_name: string;
  site_title?: string;
  requested_access?: string;
  allow_repo_owner_password?: boolean;
}

export async function findRepoByFullName(
  db: D1Database,
  fullName: string,
): Promise<RepoRecord | null> {
  const row = await db
    .prepare('SELECT * FROM repos WHERE full_name = ?')
    .bind(fullName.toLowerCase())
    .first<Record<string, unknown>>();
  return row ? normalizeRepo(row) : null;
}

export async function findRepoByGithubId(
  db: D1Database,
  githubRepoId: string,
): Promise<RepoRecord | null> {
  const row = await db
    .prepare('SELECT * FROM repos WHERE github_repository_id = ?')
    .bind(githubRepoId)
    .first<Record<string, unknown>>();
  return row ? normalizeRepo(row) : null;
}

export async function upsertRepo(
  db: D1Database,
  input: UpsertRepoInput,
): Promise<RepoRecord> {
  const now = new Date().toISOString();
  const owner = input.owner.toLowerCase();
  const name = input.name.toLowerCase();
  const fullName = input.full_name.toLowerCase();

  // Try to find existing repo by github_repository_id
  const existing = await findRepoByGithubId(db, input.github_repository_id);

  if (existing) {
    // Update existing repo
    await db
      .prepare(
        `UPDATE repos SET owner = ?, name = ?, full_name = ?, site_title = COALESCE(?, site_title), requested_access = COALESCE(?, requested_access), updated_at = ? WHERE id = ?`,
      )
      .bind(
        owner,
        name,
        fullName,
        input.site_title ?? null,
        input.requested_access ?? null,
        now,
        existing.id,
      )
      .run();

    const updated = await findRepoByGithubId(db, input.github_repository_id);
    return updated!;
  }

  // Insert new repo
  const id = generateId('repo_');
  await db
    .prepare(
      `INSERT INTO repos (id, github_repository_id, owner, name, full_name, approval_state, access_mode, allow_repo_owner_password, site_title, requested_access, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 'none', ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.github_repository_id,
      owner,
      name,
      fullName,
      input.allow_repo_owner_password === true ? 1 : 0,
      input.site_title ?? null,
      input.requested_access ?? null,
      now,
      now,
    )
    .run();

  const created = await findRepoByGithubId(db, input.github_repository_id);
  return created!;
}

export async function approveRepo(
  db: D1Database,
  repoId: string,
  accessMode: 'public' | 'password',
  approvedBy: string,
): Promise<RepoRecord> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE repos SET approval_state = 'approved', access_mode = ?, approved_at = ?, approved_by = ?, disabled_at = NULL, disabled_by = NULL, updated_at = ? WHERE id = ?`,
    )
    .bind(accessMode, now, approvedBy, now, repoId)
    .run();

  const row = await db
    .prepare('SELECT * FROM repos WHERE id = ?')
    .bind(repoId)
    .first<Record<string, unknown>>();
  return normalizeRepo(row!);
}

export async function disableRepo(
  db: D1Database,
  repoId: string,
  disabledBy: string,
  reason?: string,
): Promise<RepoRecord> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE repos SET approval_state = 'disabled', access_mode = 'none', disabled_at = ?, disabled_by = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(now, disabledBy, now, repoId)
    .run();

  // reason is stored in audit log, not on the repo record itself
  void reason;

  const row = await db
    .prepare('SELECT * FROM repos WHERE id = ?')
    .bind(repoId)
    .first<Record<string, unknown>>();
  return normalizeRepo(row!);
}

export async function setAccessMode(
  db: D1Database,
  repoId: string,
  accessMode: AccessMode,
): Promise<RepoRecord> {
  const now = new Date().toISOString();
  await db
    .prepare(`UPDATE repos SET access_mode = ?, updated_at = ? WHERE id = ?`)
    .bind(accessMode, now, repoId)
    .run();

  const row = await db
    .prepare('SELECT * FROM repos WHERE id = ?')
    .bind(repoId)
    .first<Record<string, unknown>>();
  return normalizeRepo(row!);
}

export async function setSelfPasswordAllowFlag(
  db: D1Database,
  repoId: string,
  allow: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE repos SET allow_repo_owner_password = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(allow ? 1 : 0, now, repoId)
    .run();
}

export async function updateLatestBuild(
  db: D1Database,
  repoId: string,
  buildId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE repos SET latest_successful_build_id = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(buildId, now, repoId)
    .run();
}

export interface ListReposFilters {
  state?: ApprovalState;
  access?: AccessMode;
  owner?: string;
  limit?: number;
  cursor?: string;
}

export async function listRepos(
  db: D1Database,
  filters?: ListReposFilters,
): Promise<{ repos: RepoRecord[]; next_cursor: string | null }> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (filters?.state) {
    conditions.push('approval_state = ?');
    bindings.push(filters.state);
  }
  if (filters?.access) {
    conditions.push('access_mode = ?');
    bindings.push(filters.access);
  }
  if (filters?.owner) {
    conditions.push('owner = ?');
    bindings.push(filters.owner.toLowerCase());
  }
  if (filters?.cursor) {
    conditions.push('id > ?');
    bindings.push(filters.cursor);
  }

  const limit = filters?.limit ?? 50;
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `SELECT * FROM repos ${where} ORDER BY id ASC LIMIT ?`;
  bindings.push(limit + 1);

  const stmt = db.prepare(query);
  const result = await stmt.bind(...bindings).all<Record<string, unknown>>();
  const rows = (result.results ?? []).map(normalizeRepo);

  let nextCursor: string | null = null;
  if (rows.length > limit) {
    rows.pop();
    nextCursor = rows[rows.length - 1]?.id ?? null;
  }

  return { repos: rows, next_cursor: nextCursor };
}
