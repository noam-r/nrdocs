import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');

function readMigration(filename: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, filename), 'utf-8');
}

describe('Migration 0004: rule_unlisted_assets', () => {
  let SQL: Awaited<ReturnType<typeof initSqlJs>>;

  beforeAll(async () => {
    SQL = await initSqlJs();
  });

  function createDbWithRules(): Database {
    const db = new SQL.Database();
    db.run(readMigration('0001_initial_schema.sql'));
    db.run(readMigration('0002_repo_owner_password_optin.sql'));
    db.run(readMigration('0003_rule_self_password_default.sql'));
    db.run(
      `INSERT INTO auto_approval_rules (
        id, pattern, access_mode, enabled, priority,
        default_allow_repo_owner_password,
        created_at, created_by, updated_at, updated_by
      ) VALUES (
        'rule_1', 'acme/*', 'password', 1, 0, 1,
        '2024-01-01T00:00:00.000Z', 'op', '2024-01-01T00:00:00.000Z', 'op'
      )`,
    );
    return db;
  }

  it('adds allow_unlisted_assets with default 0 for existing rules', () => {
    const db = createDbWithRules();
    db.run(readMigration('0004_rule_unlisted_assets.sql'));

    const results = db.exec(
      'SELECT id, allow_unlisted_assets FROM auto_approval_rules',
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.values[0]).toEqual(['rule_1', 0]);
    db.close();
  });
});
