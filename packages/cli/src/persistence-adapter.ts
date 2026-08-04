/**
 * Administrator control-plane persistence adapter.
 * Executes shared @nrdocs/persistence operations through node:sqlite (tests)
 * or the D1 HTTP query client (deploy/admin commands).
 */
export {
  applyMigrations,
  createD1HttpExecutor,
  sqliteAsD1HttpClient,
  PersistenceError,
  type D1HttpQueryClient,
  type SqlExecutor,
} from '@nrdocs/persistence';
export { createSqliteExecutor, openMemorySqlite } from '@nrdocs/persistence/sqlite';
