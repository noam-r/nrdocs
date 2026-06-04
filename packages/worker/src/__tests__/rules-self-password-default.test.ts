/**
 * Worker tests for rule-driven self-password stamping at auto-approval time.
 *
 * Tasks 5.3, 5.4, 5.5:
 * - 5.3: upsertRepo with allow_repo_owner_password=true on INSERT → row has flag=true
 * - 5.4: upsertRepo with allow_repo_owner_password=false on INSERT → row has flag=false
 * - 5.5: upsertRepo with allow_repo_owner_password=true on UPDATE (existing repo) → flag NOT changed
 *
 * Validates: Requirements 11.5, 11.6, 9.7, 9.8, 9.9
 */

import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { upsertRepo } from '../db/repos.js';

// --- D1 adapter over sql.js ---

const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');

function readMigration(filename: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, filename), 'utf-8');
}

/**
 * Minimal D1Database adapter wrapping sql.js for testing.
 */
function createD1FromSqlJs(sqlDb: SqlJsDatabase): D1Database {
  function prepare(sql: string): D1PreparedStatement {
    let bindings: unknown[] = [];

    const stmt: D1PreparedStatement = {
      bind(...args: unknown[]) {
        bindings = args;
        return stmt;
      },
      async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
        const prepared = sqlDb.prepare(sql);
        try {
          prepared.bind(bindings as any[]);
          if (!prepared.step()) return null;
          const row = prepared.getAsObject() as Record<string, unknown>;
          if (colName) return (row[colName] as T) ?? null;
          return row as T;
        } finally {
          prepared.free();
        }
      },
      async run<T = Record<string, unknown>>() {
        sqlDb.run(sql, bindings as any[]);
        return {
          success: true,
          meta: { duration: 0, changes: sqlDb.getRowsModified(), last_row_id: 0, changed_db: true, size_after: 0, rows_read: 0, rows_written: 0 },
          results: [],
        } as D1Result<T>;
      },
      async all<T = Record<string, unknown>>() {
        const prepared = sqlDb.prepare(sql);
        const results: T[] = [];
        try {
          prepared.bind(bindings as any[]);
          while (prepared.step()) {
            results.push(prepared.getAsObject() as T);
          }
        } finally {
          prepared.free();
        }
        return {
          success: true,
          meta: { duration: 0, changes: 0, last_row_id: 0, changed_db: false, size_after: 0, rows_read: 0, rows_written: 0 },
          results,
        } as D1Result<T>;
      },
      raw: async (_options?: { columnNames?: boolean }) => {
        return [] as any;
      },
    };
    return stmt;
  }

  async function batch<T = unknown>(stmts: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const s of stmts) {
      results.push(await (s as any).run());
    }
    return results;
  }

  return {
    prepare,
    batch,
    dump: async () => new ArrayBuffer(0),
    exec: async (sql: string) => {
      sqlDb.run(sql);
      return { count: 0, duration: 0 } as unknown as D1ExecResult;
    },
  } as unknown as D1Database;
}

// --- Test setup ---

describe('upsertRepo: rule-driven self-password stamping', () => {
  let SQL: Awaited<ReturnType<typeof initSqlJs>>;

  beforeAll(async () => {
    SQL = await initSqlJs();
  });

  function createTestDb(): { sqlDb: SqlJsDatabase; d1: D1Database } {
    const sqlDb = new SQL.Database();
    sqlDb.run(readMigration('0001_initial_schema.sql'));
    sqlDb.run(readMigration('0002_repo_owner_password_optin.sql'));
    sqlDb.run(readMigration('0003_rule_self_password_default.sql'));
    sqlDb.run(readMigration('0004_rule_unlisted_assets.sql'));
    const d1 = createD1FromSqlJs(sqlDb);
    return { sqlDb, d1 };
  }

  function getRepoFlag(sqlDb: SqlJsDatabase, fullName: string): number | null {
    const stmt = sqlDb.prepare(
      'SELECT allow_repo_owner_password FROM repos WHERE full_name = ?',
    );
    stmt.bind([fullName]);
    if (!stmt.step()) {
      stmt.free();
      return null;
    }
    const val = stmt.getAsObject()['allow_repo_owner_password'] as number;
    stmt.free();
    return val;
  }

  // --- Task 5.3: Stamping with allow=true on INSERT ---

  describe('Task 5.3: INSERT with allow_repo_owner_password=true', () => {
    it('inserted repo row has allow_repo_owner_password=true when upsertRepo is called with allow_repo_owner_password=true on a new repo', async () => {
      const { sqlDb, d1 } = createTestDb();

      // No repos in the table — this is a brand new repo
      const result = await upsertRepo(d1, {
        github_repository_id: 'gh_new_001',
        owner: 'org',
        name: 'repo1',
        full_name: 'org/repo1',
        allow_repo_owner_password: true,
      });

      // The returned record should have the flag set to true
      expect(result.allow_repo_owner_password).toBe(true);

      // Verify directly in the DB
      expect(getRepoFlag(sqlDb, 'org/repo1')).toBe(1);

      sqlDb.close();
    });
  });

  // --- Task 5.4: Stamping with allow=false on INSERT ---

  describe('Task 5.4: INSERT with allow_repo_owner_password=false', () => {
    it('inserted repo row has allow_repo_owner_password=false when upsertRepo is called with allow_repo_owner_password=false on a new repo', async () => {
      const { sqlDb, d1 } = createTestDb();

      const result = await upsertRepo(d1, {
        github_repository_id: 'gh_new_002',
        owner: 'org',
        name: 'repo2',
        full_name: 'org/repo2',
        allow_repo_owner_password: false,
      });

      // The returned record should have the flag set to false
      expect(result.allow_repo_owner_password).toBe(false);

      // Verify directly in the DB
      expect(getRepoFlag(sqlDb, 'org/repo2')).toBe(0);

      sqlDb.close();
    });

    it('inserted repo row defaults to allow_repo_owner_password=false when the field is omitted', async () => {
      const { sqlDb, d1 } = createTestDb();

      const result = await upsertRepo(d1, {
        github_repository_id: 'gh_new_003',
        owner: 'org',
        name: 'repo3',
        full_name: 'org/repo3',
        // allow_repo_owner_password is NOT provided
      });

      expect(result.allow_repo_owner_password).toBe(false);
      expect(getRepoFlag(sqlDb, 'org/repo3')).toBe(0);

      sqlDb.close();
    });
  });

  // --- Task 5.5: Non-retroactivity of rule changes ---

  describe('Task 5.5: UPDATE does NOT change allow_repo_owner_password on existing repo', () => {
    it('existing repo with allow_repo_owner_password=false is NOT changed when upsertRepo is called with allow_repo_owner_password=true', async () => {
      const { sqlDb, d1 } = createTestDb();

      // Pre-seed a repo with allow_repo_owner_password=false
      sqlDb.run(
        `INSERT INTO repos (id, github_repository_id, owner, name, full_name, approval_state, access_mode, allow_repo_owner_password, created_at, updated_at)
         VALUES ('repo_existing_001', 'gh_existing_001', 'org', 'repo1', 'org/repo1', 'approved', 'public', 0, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z')`,
      );

      // Simulate a publish from this existing repo — upsertRepo is called with
      // allow_repo_owner_password=true (as if a matching rule has default=true)
      const result = await upsertRepo(d1, {
        github_repository_id: 'gh_existing_001',
        owner: 'org',
        name: 'repo1',
        full_name: 'org/repo1',
        allow_repo_owner_password: true, // rule says true, but repo already exists
      });

      // The flag should still be false — UPDATE branch does NOT touch it
      expect(result.allow_repo_owner_password).toBe(false);

      // Verify directly in the DB
      expect(getRepoFlag(sqlDb, 'org/repo1')).toBe(0);

      sqlDb.close();
    });

    it('existing repo with allow_repo_owner_password=true is NOT changed when upsertRepo is called with allow_repo_owner_password=false', async () => {
      const { sqlDb, d1 } = createTestDb();

      // Pre-seed a repo with allow_repo_owner_password=true
      sqlDb.run(
        `INSERT INTO repos (id, github_repository_id, owner, name, full_name, approval_state, access_mode, allow_repo_owner_password, created_at, updated_at)
         VALUES ('repo_existing_002', 'gh_existing_002', 'org', 'repo2', 'org/repo2', 'approved', 'public', 1, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z')`,
      );

      // Simulate a publish — upsertRepo called with allow_repo_owner_password=false
      const result = await upsertRepo(d1, {
        github_repository_id: 'gh_existing_002',
        owner: 'org',
        name: 'repo2',
        full_name: 'org/repo2',
        allow_repo_owner_password: false, // rule says false, but repo already exists with true
      });

      // The flag should still be true — UPDATE branch does NOT touch it
      expect(result.allow_repo_owner_password).toBe(true);

      // Verify directly in the DB
      expect(getRepoFlag(sqlDb, 'org/repo2')).toBe(1);

      sqlDb.close();
    });

    it('existing repo flag is unchanged even when other fields are updated', async () => {
      const { sqlDb, d1 } = createTestDb();

      // Pre-seed a repo with allow_repo_owner_password=false
      sqlDb.run(
        `INSERT INTO repos (id, github_repository_id, owner, name, full_name, approval_state, access_mode, allow_repo_owner_password, created_at, updated_at)
         VALUES ('repo_existing_003', 'gh_existing_003', 'org', 'repo3', 'org/repo3', 'approved', 'public', 0, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z')`,
      );

      // Call upsertRepo with a new site_title and allow_repo_owner_password=true
      const result = await upsertRepo(d1, {
        github_repository_id: 'gh_existing_003',
        owner: 'org',
        name: 'repo3',
        full_name: 'org/repo3',
        site_title: 'Updated Title',
        allow_repo_owner_password: true,
      });

      // Flag should still be false
      expect(result.allow_repo_owner_password).toBe(false);
      expect(getRepoFlag(sqlDb, 'org/repo3')).toBe(0);

      // But site_title should have been updated
      const stmt = sqlDb.prepare('SELECT site_title FROM repos WHERE full_name = ?');
      stmt.bind(['org/repo3']);
      stmt.step();
      expect(stmt.getAsObject()['site_title']).toBe('Updated Title');
      stmt.free();

      sqlDb.close();
    });
  });
});
