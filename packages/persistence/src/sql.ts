/** Runtime-neutral SQL execution seam used by CLI and Worker adapters. */

export type SqlValue = string | number | null;

export type SqlRow = Record<string, SqlValue>;

export type SqlRunResult = {
  changes: number;
};

export type SqlExecutor = {
  run(sql: string, params?: readonly SqlValue[]): Promise<SqlRunResult>;
  one(sql: string, params?: readonly SqlValue[]): Promise<SqlRow | null>;
  many(sql: string, params?: readonly SqlValue[]): Promise<SqlRow[]>;
  /**
   * Execute `fn` atomically. Nested transactions may flatten depending on the adapter;
   * top-level calls must roll back on throw.
   */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
};
