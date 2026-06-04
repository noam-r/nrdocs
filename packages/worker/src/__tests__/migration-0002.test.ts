import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');

function readMigration(filename: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, filename), 'utf-8');
}

describe('Migration 0002: repo_owner_password_optin', () => {
  let SQL: Awaited<ReturnType<typeof initSqlJs>>;

  beforeAll(async () => {
    SQL = await initSqlJs();
  });

  function createDbWithInitialSchema(): Database {
    const db = new SQL.Database();
    db.run(readMigration('0001_initial_schema.sql'));
    return db;
  }

  function seedRepos(db: Database, count: number): void {
    const stmt = db.prepare(
      `INSERT INTO repos (
        id, github_repository_id, owner, name, full_name,
        approval_state, access_mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < count; i++) {
      stmt.run([
        `repo_${String(i).padStart(4, '0')}`,
        `gh_${i}`,
        'testorg',
        `repo${i}`,
        `testorg/repo${i}`,
        'approved',
        'public',
        '2024-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
      ]);
    }
    stmt.free();
  }

  it('adds allow_repo_owner_password column with default 0 for existing rows', () => {
    const db = createDbWithInitialSchema();
    seedRepos(db, 3);

    // Apply migration 0002
    db.run(readMigration('0002_repo_owner_password_optin.sql'));

    // All existing rows should have allow_repo_owner_password = 0
    const results = db.exec('SELECT id, allow_repo_owner_password FROM repos ORDER BY id');
    expect(results).toHaveLength(1);

    const rows = results[0]!.values;
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row[1]).toBe(0);
    }

    db.close();
  });

  it('sets allow_repo_owner_password = 0 for all pre-existing rows without modifying other columns', () => {
    const db = createDbWithInitialSchema();
    seedRepos(db, 2);

    // Capture state before migration
    const beforeRows = db.exec(
      'SELECT id, github_repository_id, owner, name, full_name, approval_state, access_mode, created_at, updated_at FROM repos ORDER BY id',
    );

    // Apply migration 0002
    db.run(readMigration('0002_repo_owner_password_optin.sql'));

    // Capture state after migration (same columns minus the new one)
    const afterRows = db.exec(
      'SELECT id, github_repository_id, owner, name, full_name, approval_state, access_mode, created_at, updated_at FROM repos ORDER BY id',
    );

    // All original columns should be unchanged
    expect(afterRows[0]!.values).toEqual(beforeRows[0]!.values);

    db.close();
  });

  it('re-applying migration 0002 fails with duplicate column name error', () => {
    const db = createDbWithInitialSchema();
    seedRepos(db, 1);

    // Apply migration 0002 first time — should succeed
    db.run(readMigration('0002_repo_owner_password_optin.sql'));

    // Apply migration 0002 again — should fail with duplicate column name
    expect(() => {
      db.run(readMigration('0002_repo_owner_password_optin.sql'));
    }).toThrow(/duplicate column name/i);

    db.close();
  });

  it('new rows inserted after migration also get default 0', () => {
    const db = createDbWithInitialSchema();
    db.run(readMigration('0002_repo_owner_password_optin.sql'));

    // Insert a new row without specifying allow_repo_owner_password
    db.run(
      `INSERT INTO repos (
        id, github_repository_id, owner, name, full_name,
        approval_state, access_mode, created_at, updated_at
      ) VALUES ('repo_new', 'gh_new', 'org', 'new', 'org/new', 'pending', 'none', '2024-06-01T00:00:00.000Z', '2024-06-01T00:00:00.000Z')`,
    );

    const results = db.exec(
      "SELECT allow_repo_owner_password FROM repos WHERE id = 'repo_new'",
    );
    expect(results[0]!.values[0]![0]).toBe(0);

    db.close();
  });
});
