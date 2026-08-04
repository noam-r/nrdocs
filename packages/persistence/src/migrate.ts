import { formatRfc3339 } from '@nrdocs/contracts';
import { SCHEMA_VERSION } from './constants.js';
import { invariantFailure } from './errors.js';
import { MIGRATIONS } from './migrations.js';
import type { SqlExecutor } from './sql.js';

async function hasSchemaMigrationsTable(db: SqlExecutor): Promise<boolean> {
  const row = await db.one(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`,
  );
  return row !== null;
}

async function appliedVersions(db: SqlExecutor): Promise<Set<number>> {
  if (!(await hasSchemaMigrationsTable(db))) return new Set();
  const rows = await db.many(`SELECT version FROM schema_migrations`);
  return new Set(rows.map((r) => Number(r.version)));
}

export async function applyMigrations(
  db: SqlExecutor,
  now: Date = new Date(),
): Promise<{ schemaVersion: number }> {
  const appliedAt = formatRfc3339(now);

  await db.transaction(async (tx) => {
    const done = await appliedVersions(tx);
    for (const migration of MIGRATIONS) {
      if (done.has(migration.version)) continue;
      for (const statement of migration.statements) {
        await tx.run(statement);
      }
      await tx.run(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`, [
        migration.version,
        migration.name,
        appliedAt,
      ]);
      done.add(migration.version);
    }
  });

  const latest = await db.one(`SELECT MAX(version) AS v FROM schema_migrations`);
  const version = Number(latest?.v ?? 0);
  if (version !== SCHEMA_VERSION) {
    throw invariantFailure(`Expected schema version ${SCHEMA_VERSION}, found ${version}`);
  }
  return { schemaVersion: version };
}
