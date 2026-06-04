import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRule, updateRule, matchRules } from '../db/rules.js';

const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');

function readMigration(filename: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, filename), 'utf-8');
}

function createD1FromSqlJs(sqlDb: SqlJsDatabase): D1Database {
  function prepare(sql: string): D1PreparedStatement {
    let bindings: unknown[] = [];
    const stmt: D1PreparedStatement = {
      bind(...args: unknown[]) {
        bindings = args;
        return stmt;
      },
      async first<T = Record<string, unknown>>(): Promise<T | null> {
        const prepared = sqlDb.prepare(sql);
        try {
          prepared.bind(bindings as any[]);
          if (!prepared.step()) return null;
          return prepared.getAsObject() as T;
        } finally {
          prepared.free();
        }
      },
      async run() {
        sqlDb.run(sql, bindings as any[]);
        return {
          success: true,
          meta: { duration: 0, changes: sqlDb.getRowsModified(), last_row_id: 0, changed_db: true, size_after: 0, rows_read: 0, rows_written: 0 },
          results: [],
        };
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
        return { success: true, meta: { duration: 0, changes: 0, last_row_id: 0, changed_db: false, size_after: 0, rows_read: 0, rows_written: 0 }, results };
      },
      raw: async () => [] as any,
    };
    return stmt;
  }

  return {
    prepare,
    batch: async (stmts: D1PreparedStatement[]) => {
      const results = [];
      for (const s of stmts) results.push(await (s as any).run());
      return results;
    },
    dump: async () => new ArrayBuffer(0),
    exec: async (sql: string) => {
      sqlDb.run(sql);
      return { count: 0, duration: 0 } as unknown as D1ExecResult;
    },
  } as unknown as D1Database;
}

describe('auto_approval_rules allow_unlisted_assets', () => {
  let SQL: Awaited<ReturnType<typeof initSqlJs>>;

  beforeAll(async () => {
    SQL = await initSqlJs();
  });

  function createTestDb(): D1Database {
    const sqlDb = new SQL.Database();
    sqlDb.run(readMigration('0001_initial_schema.sql'));
    sqlDb.run(readMigration('0002_repo_owner_password_optin.sql'));
    sqlDb.run(readMigration('0003_rule_self_password_default.sql'));
    sqlDb.run(readMigration('0004_rule_unlisted_assets.sql'));
    return createD1FromSqlJs(sqlDb);
  }

  it('defaults allow_unlisted_assets to false on create', async () => {
    const db = createTestDb();
    const rule = await createRule(db, 'acme/*', 'password', 'op@test');
    expect(rule.allow_unlisted_assets).toBe(false);
    const matched = await matchRules(db, 'acme/docs');
    expect(matched?.allow_unlisted_assets).toBe(false);
  });

  it('stores allow_unlisted_assets when set at create', async () => {
    const db = createTestDb();
    const rule = await createRule(db, 'acme/*', 'password', 'op@test', 0, true, true);
    expect(rule.allow_unlisted_assets).toBe(true);
    const matched = await matchRules(db, 'acme/docs');
    expect(matched?.allow_unlisted_assets).toBe(true);
  });

  it('updates allow_unlisted_assets via updateRule', async () => {
    const db = createTestDb();
    const rule = await createRule(db, 'acme/*', 'password', 'op@test');
    const updated = await updateRule(
      db,
      rule.id,
      { allow_unlisted_assets: true },
      'op@test',
    );
    expect(updated?.allow_unlisted_assets).toBe(true);
    const matched = await matchRules(db, 'acme/docs');
    expect(matched?.allow_unlisted_assets).toBe(true);
  });
});
