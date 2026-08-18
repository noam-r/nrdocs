import { DatabaseSync } from 'node:sqlite';
import { mapSqlEngineError } from './errors.js';
import type { SqlExecutor, SqlRow, SqlRunResult, SqlValue } from './sql.js';

function mapSqliteError(error: unknown): never {
  mapSqlEngineError(error);
}

export type SqliteDatabase = DatabaseSync;

export function createSqliteExecutor(db: DatabaseSync): SqlExecutor {
  db.exec('PRAGMA foreign_keys = ON');

  const make = (active: DatabaseSync): SqlExecutor => ({
    async run(sql, params = []): Promise<SqlRunResult> {
      try {
        const stmt = active.prepare(sql);
        const info = stmt.run(...(params as SqlValue[]));
        return { changes: Number(info.changes ?? 0) };
      } catch (error) {
        mapSqliteError(error);
      }
    },
    async one(sql, params = []): Promise<SqlRow | null> {
      try {
        const stmt = active.prepare(sql);
        const row = stmt.get(...(params as SqlValue[])) as SqlRow | undefined;
        return row ?? null;
      } catch (error) {
        mapSqliteError(error);
      }
    },
    async many(sql, params = []): Promise<SqlRow[]> {
      try {
        const stmt = active.prepare(sql);
        return stmt.all(...(params as SqlValue[])) as SqlRow[];
      } catch (error) {
        mapSqliteError(error);
      }
    },
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      active.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(make(active));
        active.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          active.exec('ROLLBACK');
        } catch {
          // ignore rollback races
        }
        throw error;
      }
    },
  });

  return make(db);
}

export function openMemorySqlite(): { db: DatabaseSync; executor: SqlExecutor } {
  const db = new DatabaseSync(':memory:');
  return { db, executor: createSqliteExecutor(db) };
}
