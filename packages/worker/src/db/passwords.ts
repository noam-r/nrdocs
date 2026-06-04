/**
 * Password credential query helpers for D1.
 */

import type { PasswordCredential, RepoRecord } from '@nrdocs/shared';
import { generateId } from './id.js';
import { hashPassword } from '../crypto.js';

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


/**
 * Computes the next password version for a given repo.
 * Mirrors the version-bump logic in setPassword.
 */
async function nextPasswordVersion(
  db: D1Database,
  repoId: string,
): Promise<number> {
  const latest = await db
    .prepare(
      `SELECT MAX(password_version) as max_version FROM password_credentials WHERE repo_id = ?`,
    )
    .bind(repoId)
    .first<{ max_version: number | null }>();
  return (latest?.max_version ?? 0) + 1;
}

export interface StoreSelfServicePasswordArgs {
  repo: RepoRecord;
  plaintext: string;
  fullName: string;
  buildId: string;
}

/**
 * Stores a self-service password atomically via db.batch([...]).
 *
 * Performs:
 * 1. Hash the plaintext via the existing PBKDF2 pipeline
 * 2. Deactivate any prior active credential for the repo
 * 3. Insert the new credential
 * 4. Insert a `repo.self_password_set` audit row
 * 5. If the repo is approved + access_mode='none', flip access_mode to 'password'
 *    and insert a `repo.access_changed` audit row
 *
 * Returns { ok: true } on success, { ok: false } if the batch throws or
 * any statement's meta.error is set.
 *
 * SECURITY: Never logs plaintext, hash, or salt.
 */
export async function storeSelfServicePassword(
  db: D1Database,
  args: StoreSelfServicePasswordArgs,
): Promise<{ ok: true } | { ok: false }> {
  const { hash, salt, iteration_count } = await hashPassword(args.plaintext);
  const credId = generateId('cred_');
  const auditCredId = generateId('evt_');
  const now = new Date().toISOString();
  const version = await nextPasswordVersion(db, args.repo.id);

  // Determine if access_mode needs to flip (access-mode interaction matrix)
  const flipToPassword =
    args.repo.approval_state === 'approved' && args.repo.access_mode === 'none';

  const stmts: D1PreparedStatement[] = [];

  // 1. Deactivate prior active credential
  stmts.push(
    db
      .prepare(
        `UPDATE password_credentials SET active = 0, updated_at = ?, updated_by = ? WHERE repo_id = ? AND active = 1`,
      )
      .bind(now, 'repo_owner', args.repo.id),
  );

  // 2. Insert new credential
  stmts.push(
    db
      .prepare(
        `INSERT INTO password_credentials (id, repo_id, password_hash, hash_algorithm, salt, iteration_count, password_version, active, created_at, updated_at, updated_by)
         VALUES (?, ?, ?, 'pbkdf2-sha256', ?, ?, ?, 1, ?, ?, ?)`,
      )
      .bind(
        credId,
        args.repo.id,
        hash,
        salt,
        iteration_count,
        version,
        now,
        now,
        'repo_owner',
      ),
  );

  // 3. Insert self_password_set audit row
  stmts.push(
    db
      .prepare(
        `INSERT INTO audit_log (id, event_type, actor_type, actor_id, repo_id, build_id, rule_id, metadata_json, created_at)
         VALUES (?, 'repo.self_password_set', 'github_action', ?, ?, ?, NULL, NULL, ?)`,
      )
      .bind(auditCredId, args.fullName, args.repo.id, args.buildId, now),
  );

  // 4. Conditionally flip access_mode and write access_changed audit
  if (flipToPassword) {
    const auditModeId = generateId('evt_');
    stmts.push(
      db
        .prepare(
          `UPDATE repos SET access_mode = 'password', updated_at = ? WHERE id = ?`,
        )
        .bind(now, args.repo.id),
    );
    stmts.push(
      db
        .prepare(
          `INSERT INTO audit_log (id, event_type, actor_type, actor_id, repo_id, build_id, rule_id, metadata_json, created_at)
           VALUES (?, 'repo.access_changed', 'github_action', ?, ?, ?, NULL, ?, ?)`,
        )
        .bind(
          auditModeId,
          args.fullName,
          args.repo.id,
          args.buildId,
          JSON.stringify({ old_mode: args.repo.access_mode, new_mode: 'password' }),
          now,
        ),
    );
  }

  try {
    const results = await db.batch(stmts);
    for (const r of results) {
      if ((r as unknown as { error?: string }).error) {
        return { ok: false };
      }
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
