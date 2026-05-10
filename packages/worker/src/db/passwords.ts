/**
 * Password credential query helpers for D1.
 */

import type { PasswordCredential } from '@nrdocs/shared';
import { generateId } from './id.js';

export async function setPassword(
  db: D1Database,
  repoId: string,
  hash: string,
  salt: string,
  iterationCount: number,
  updatedBy: string,
): Promise<PasswordCredential> {
  const now = new Date().toISOString();

  // Deactivate any existing active passwords for this repo
  await db
    .prepare(
      `UPDATE password_credentials SET active = 0, updated_at = ?, updated_by = ? WHERE repo_id = ? AND active = 1`,
    )
    .bind(now, updatedBy, repoId)
    .run();

  // Get the next version number
  const latest = await db
    .prepare(
      `SELECT MAX(password_version) as max_version FROM password_credentials WHERE repo_id = ?`,
    )
    .bind(repoId)
    .first<{ max_version: number | null }>();
  const nextVersion = (latest?.max_version ?? 0) + 1;

  // Insert new active credential
  const id = generateId('cred_');
  await db
    .prepare(
      `INSERT INTO password_credentials (id, repo_id, password_hash, hash_algorithm, salt, iteration_count, password_version, active, created_at, updated_at, updated_by)
       VALUES (?, ?, ?, 'pbkdf2-sha256', ?, ?, ?, 1, ?, ?, ?)`,
    )
    .bind(id, repoId, hash, salt, iterationCount, nextVersion, now, now, updatedBy)
    .run();

  const cred = await db
    .prepare('SELECT * FROM password_credentials WHERE id = ?')
    .bind(id)
    .first<PasswordCredential>();
  return cred!;
}

export async function getActivePassword(
  db: D1Database,
  repoId: string,
): Promise<PasswordCredential | null> {
  const result = await db
    .prepare(
      'SELECT * FROM password_credentials WHERE repo_id = ? AND active = 1 ORDER BY password_version DESC LIMIT 1',
    )
    .bind(repoId)
    .first<PasswordCredential>();
  return result ?? null;
}

export async function hasPassword(
  db: D1Database,
  repoId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      'SELECT COUNT(*) as cnt FROM password_credentials WHERE repo_id = ? AND active = 1',
    )
    .bind(repoId)
    .first<{ cnt: number }>();
  return (result?.cnt ?? 0) > 0;
}
