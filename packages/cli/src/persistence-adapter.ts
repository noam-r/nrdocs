/**
 * Administrator control-plane persistence adapter.
 * Executes shared @nrdocs/persistence operations through node:sqlite (tests)
 * or the D1 HTTP query client (deploy/admin commands in later phases).
 */
export {
  applyMigrations,
  createD1HttpExecutor,
  createSqliteExecutor,
  openMemorySqlite,
  sqliteAsD1HttpClient,
  PersistenceError,
  type D1HttpQueryClient,
  type SqlExecutor,
} from '@nrdocs/persistence';
