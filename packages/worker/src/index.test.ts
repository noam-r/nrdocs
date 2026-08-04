import { describe, expect, it } from 'vitest';
import { applyMigrations, openMemorySqlite, sqliteAsD1Database } from '@nrdocs/persistence';
import { WORKER_PACKAGE, workerDependencies, workerPersistence } from './index.js';

describe('@nrdocs/worker', () => {
  it('depends on contracts and persistence only', () => {
    expect(WORKER_PACKAGE).toBe('@nrdocs/worker');
    expect(workerDependencies()).toEqual({
      contracts: '@nrdocs/contracts',
      persistence: '@nrdocs/persistence',
    });
  });

  it('binds D1 through the shared persistence adapter', async () => {
    const { executor } = openMemorySqlite();
    const db = workerPersistence(sqliteAsD1Database(executor));
    const result = await applyMigrations(db);
    expect(result.schemaVersion).toBe(1);
  });
});
