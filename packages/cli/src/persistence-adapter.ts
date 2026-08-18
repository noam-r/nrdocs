/**
 * Administrator control-plane persistence adapter.
 * Production commands use the D1 HTTP query client.
 * Tests import `@nrdocs/persistence/sqlite` directly so `node:sqlite` stays
 * off the published CLI startup graph.
 */
export {
  applyMigrations,
  createD1HttpExecutor,
  sqliteAsD1HttpClient,
  PersistenceError,
  type D1HttpQueryClient,
  type SqlExecutor,
} from '@nrdocs/persistence';
