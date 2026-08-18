/**
 * Cloudflare D1 binding + control-plane HTTP adapters.
 * Structural types only — no workers-types or network client dependency.
 */

import { mapSqlEngineError } from './errors.js';
import type { SqlExecutor, SqlRow, SqlRunResult, SqlValue } from './sql.js';

export type D1PreparedStatementLike = {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = SqlRow>(): Promise<T | null>;
  all<T = SqlRow>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number; rows_written?: number }; changes?: number }>;
};

export type D1DatabaseLike = {
  prepare(query: string): D1PreparedStatementLike;
};

function mapD1Error(error: unknown): never {
  mapSqlEngineError(error);
}

function changesFrom(result: {
  meta?: { changes?: number; rows_written?: number; changed_db?: boolean };
  changes?: number;
}): number {
  const top = typeof result.changes === 'number' ? result.changes : 0;
  const metaChanges = typeof result.meta?.changes === 'number' ? result.meta.changes : 0;
  const rowsWritten = typeof result.meta?.rows_written === 'number' ? result.meta.rows_written : 0;
  const changedDb = result.meta?.changed_db === true ? 1 : 0;
  return Math.max(top, metaChanges, rowsWritten, changedDb);
}

/** Worker `env.DB` adapter — same SqlExecutor seam as the CLI. */
export function createD1Executor(d1: D1DatabaseLike): SqlExecutor {
  const exec: SqlExecutor = {
    async run(sql, params = []): Promise<SqlRunResult> {
      try {
        const result = await d1
          .prepare(sql)
          .bind(...params)
          .run();
        return { changes: changesFrom(result) };
      } catch (error) {
        mapD1Error(error);
      }
    },
    async one(sql, params = []): Promise<SqlRow | null> {
      try {
        return (
          (await d1
            .prepare(sql)
            .bind(...params)
            .first<SqlRow>()) ?? null
        );
      } catch (error) {
        mapD1Error(error);
      }
    },
    async many(sql, params = []): Promise<SqlRow[]> {
      try {
        const result = await d1
          .prepare(sql)
          .bind(...params)
          .all<SqlRow>();
        return result.results;
      } catch (error) {
        mapD1Error(error);
      }
    },
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      // Worker requests are the atomic unit for sequential conditional SQL.
      // Correctness for locks/promotion relies on WHERE clauses, not SQL BEGIN.
      return fn(exec);
    },
  };
  return exec;
}

/** Narrow HTTP query client used by the administrator control plane. */
export type D1HttpQueryClient = {
  query(
    sql: string,
    params?: readonly SqlValue[],
  ): Promise<{
    results: SqlRow[];
    meta?: { changes?: number; rows_written?: number; changed_db?: boolean };
  }>;
};

/** Administrator D1 HTTP adapter — one statement per request/params array. */
export function createD1HttpExecutor(client: D1HttpQueryClient): SqlExecutor {
  const exec: SqlExecutor = {
    async run(sql, params = []): Promise<SqlRunResult> {
      try {
        const result = await client.query(sql, params);
        return { changes: changesFrom(result) };
      } catch (error) {
        mapD1Error(error);
      }
    },
    async one(sql, params = []): Promise<SqlRow | null> {
      try {
        const result = await client.query(sql, params);
        return result.results[0] ?? null;
      } catch (error) {
        mapD1Error(error);
      }
    },
    async many(sql, params = []): Promise<SqlRow[]> {
      try {
        const result = await client.query(sql, params);
        return result.results;
      } catch (error) {
        mapD1Error(error);
      }
    },
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      return fn(exec);
    },
  };
  return exec;
}

/**
 * Adapt a Sqlite SqlExecutor into a D1DatabaseLike so Worker adapter code can
 * be conformance-tested against real SQLite without Cloudflare.
 */
export function sqliteAsD1Database(sqlite: SqlExecutor): D1DatabaseLike {
  return {
    prepare(query: string): D1PreparedStatementLike {
      let bound: readonly SqlValue[] = [];
      const stmt: D1PreparedStatementLike = {
        bind(...values: unknown[]) {
          bound = values as SqlValue[];
          return stmt;
        },
        async first<T = SqlRow>() {
          return (await sqlite.one(query, bound)) as T | null;
        },
        async all<T = SqlRow>() {
          const results = (await sqlite.many(query, bound)) as T[];
          return { results };
        },
        async run() {
          const result = await sqlite.run(query, bound);
          return { meta: { changes: result.changes } };
        },
      };
      return stmt;
    },
  };
}

/** Adapt Sqlite into a D1 HTTP query client for control-plane adapter tests. */
export function sqliteAsD1HttpClient(sqlite: SqlExecutor): D1HttpQueryClient {
  return {
    async query(sql, params = []) {
      const trimmed = sql.trim().toLowerCase();
      if (trimmed.startsWith('select') || trimmed.startsWith('with') || /returning\b/i.test(sql)) {
        const results = await sqlite.many(sql, params);
        return { results, meta: { changes: 0 } };
      }
      const result = await sqlite.run(sql, params);
      return { results: [], meta: { changes: result.changes } };
    },
  };
}
