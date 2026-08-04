import { assertRfc3339, formatRfc3339 } from '@nrdocs/contracts';
import { invariantFailure } from './errors.js';
import type { SqlExecutor } from './sql.js';

/** Authoritative UTC instant from the database engine (not the workstation clock). */
export async function getAuthoritativeUtcNow(db: SqlExecutor): Promise<string> {
  const row = await db.one(`SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now') AS now`);
  const value = row?.now;
  if (typeof value !== 'string') throw invariantFailure('authoritative time query failed');
  return formatRfc3339(assertRfc3339(value));
}
