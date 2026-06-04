/**
 * Worker tests for handleAllowSelfPassword and handleDisallowSelfPassword handlers.
 * Covers: success paths, 401 on missing token, 404 on unknown repo, audit rows.
 *
 * Property 3: Operator allow/disallow idempotence and audit completeness (fast-check)
 * Validates: Requirements 2.1, 2.2, 2.8, 2.9
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fc from 'fast-check';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { handleAllowSelfPassword, handleDisallowSelfPassword } from '../handlers/repos.js';
import type { Env } from '../index.js';

// --- D1 adapter over sql.js ---

const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');

function readMigration(filename: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, filename), 'utf-8');
}

/**
 * Minimal D1Database adapter wrapping sql.js for testing.
 * Implements the subset of D1Database used by the handlers under test.
 */
function createD1FromSqlJs(sqlDb: SqlJsDatabase): D1Database {
  function prepare(sql: string): D1PreparedStatement {
    let bindings: unknown[] = [];

    const stmt: D1PreparedStatement = {
      bind(...args: unknown[]) {
        bindings = args;
        return stmt;
      },
      async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
        const prepared = sqlDb.prepare(sql);
        try {
          prepared.bind(bindings as any[]);
          if (!prepared.step()) return null;
          const row = prepared.getAsObject() as Record<string, unknown>;
          if (colName) return (row[colName] as T) ?? null;
          return row as T;
        } finally {
          prepared.free();
        }
      },
      async run<T = Record<string, unknown>>() {
        sqlDb.run(sql, bindings as any[]);
        return {
          success: true,
          meta: { duration: 0, changes: sqlDb.getRowsModified(), last_row_id: 0, changed_db: true, size_after: 0, rows_read: 0, rows_written: 0 },
          results: [],
        } as D1Result<T>;
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
        return {
          success: true,
          meta: { duration: 0, changes: 0, last_row_id: 0, changed_db: false, size_after: 0, rows_read: 0, rows_written: 0 },
          results,
        } as D1Result<T>;
      },
      raw: async (_options?: { columnNames?: boolean }) => {
        return [] as any;
      },
    };
    return stmt;
  }

  async function batch<T = unknown>(stmts: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const s of stmts) {
      results.push(await (s as any).run());
    }
    return results;
  }

  return {
    prepare,
    batch,
    dump: async () => new ArrayBuffer(0),
    exec: async (sql: string) => {
      sqlDb.run(sql);
      return { count: 0, duration: 0 } as unknown as D1ExecResult;
    },
  } as unknown as D1Database;
}

// --- Test setup ---

const OPERATOR_TOKEN = 'test-operator-token-12345';

function makeEnv(db: D1Database): Env {
  return {
    OPERATOR_TOKEN,
    DB: db,
    ARTIFACTS: {} as R2Bucket,
    SESSION_SECRET: 'secret',
    BASE_URL: 'https://docs.example.com',
  };
}

function makeRequest(
  method: string,
  url: string,
  options?: { token?: string | null },
): Request {
  const headers: Record<string, string> = {};
  if (options?.token !== null) {
    headers['Authorization'] = `Bearer ${options?.token ?? OPERATOR_TOKEN}`;
  }
  return new Request(url, { method, headers });
}

function paramsFromUrl(owner: string, repo: string): Record<string, string> {
  return { owner, repo };
}

describe('handleAllowSelfPassword / handleDisallowSelfPassword', () => {
  let SQL: Awaited<ReturnType<typeof initSqlJs>>;

  beforeAll(async () => {
    SQL = await initSqlJs();
  });

  function createTestDb(): { sqlDb: SqlJsDatabase; d1: D1Database } {
    const sqlDb = new SQL.Database();
    sqlDb.run(readMigration('0001_initial_schema.sql'));
    sqlDb.run(readMigration('0002_repo_owner_password_optin.sql'));
    sqlDb.run(readMigration('0003_rule_self_password_default.sql'));
    const d1 = createD1FromSqlJs(sqlDb);
    return { sqlDb, d1 };
  }

  function seedRepo(
    sqlDb: SqlJsDatabase,
    overrides: {
      id?: string;
      owner?: string;
      name?: string;
      full_name?: string;
      github_repository_id?: string;
      allow_repo_owner_password?: number;
    } = {},
  ): void {
    const id = overrides.id ?? 'repo_test001';
    const owner = overrides.owner ?? 'myorg';
    const name = overrides.name ?? 'myrepo';
    const fullName = overrides.full_name ?? `${owner}/${name}`;
    const ghId = overrides.github_repository_id ?? 'gh_12345';
    const allowFlag = overrides.allow_repo_owner_password ?? 0;

    sqlDb.run(
      `INSERT INTO repos (id, github_repository_id, owner, name, full_name, approval_state, access_mode, allow_repo_owner_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'approved', 'public', ?, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z')`,
      [id, ghId, owner, name, fullName, allowFlag],
    );
  }

  function getAuditRows(sqlDb: SqlJsDatabase): Array<Record<string, unknown>> {
    const stmt = sqlDb.prepare('SELECT * FROM audit_log ORDER BY created_at ASC');
    const rows: Array<Record<string, unknown>> = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  function getRepoFlag(sqlDb: SqlJsDatabase, repoId: string): number {
    const stmt = sqlDb.prepare('SELECT allow_repo_owner_password FROM repos WHERE id = ?');
    stmt.bind([repoId]);
    stmt.step();
    const val = stmt.getAsObject()['allow_repo_owner_password'] as number;
    stmt.free();
    return val;
  }

  // --- Success paths ---

  describe('allow-self-password success path', () => {
    it('sets allow_repo_owner_password to true and returns updated repo', async () => {
      const { sqlDb, d1 } = createTestDb();
      seedRepo(sqlDb, { allow_repo_owner_password: 0 });
      const env = makeEnv(d1);

      const request = makeRequest('POST', 'http://localhost/api/repos/myorg/myrepo/allow-self-password');
      const response = await handleAllowSelfPassword(request, env, paramsFromUrl('myorg', 'myrepo'));

      expect(response.status).toBe(200);
      const body = await response.json() as { ok: boolean; data: { repo: { allow_repo_owner_password: boolean } } };
      expect(body.ok).toBe(true);
      expect(body.data.repo.allow_repo_owner_password).toBe(true);

      // Verify DB state
      expect(getRepoFlag(sqlDb, 'repo_test001')).toBe(1);
      sqlDb.close();
    });

    it('writes repo.self_password_allowed audit entry', async () => {
      const { sqlDb, d1 } = createTestDb();
      seedRepo(sqlDb);
      const env = makeEnv(d1);

      const request = makeRequest('POST', 'http://localhost/api/repos/myorg/myrepo/allow-self-password');
      await handleAllowSelfPassword(request, env, paramsFromUrl('myorg', 'myrepo'));

      const auditRows = getAuditRows(sqlDb);
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]!['event_type']).toBe('repo.self_password_allowed');
      expect(auditRows[0]!['actor_type']).toBe('operator');
      expect(auditRows[0]!['repo_id']).toBe('repo_test001');
      sqlDb.close();
    });
  });

  describe('disallow-self-password success path', () => {
    it('sets allow_repo_owner_password to false and returns updated repo', async () => {
      const { sqlDb, d1 } = createTestDb();
      seedRepo(sqlDb, { allow_repo_owner_password: 1 });
      const env = makeEnv(d1);

      const request = makeRequest('POST', 'http://localhost/api/repos/myorg/myrepo/disallow-self-password');
      const response = await handleDisallowSelfPassword(request, env, paramsFromUrl('myorg', 'myrepo'));

      expect(response.status).toBe(200);
      const body = await response.json() as { ok: boolean; data: { repo: { allow_repo_owner_password: boolean } } };
      expect(body.ok).toBe(true);
      expect(body.data.repo.allow_repo_owner_password).toBe(false);

      // Verify DB state
      expect(getRepoFlag(sqlDb, 'repo_test001')).toBe(0);
      sqlDb.close();
    });

    it('writes repo.self_password_disallowed audit entry', async () => {
      const { sqlDb, d1 } = createTestDb();
      seedRepo(sqlDb, { allow_repo_owner_password: 1 });
      const env = makeEnv(d1);

      const request = makeRequest('POST', 'http://localhost/api/repos/myorg/myrepo/disallow-self-password');
      await handleDisallowSelfPassword(request, env, paramsFromUrl('myorg', 'myrepo'));

      const auditRows = getAuditRows(sqlDb);
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]!['event_type']).toBe('repo.self_password_disallowed');
      expect(auditRows[0]!['actor_type']).toBe('operator');
      expect(auditRows[0]!['repo_id']).toBe('repo_test001');
      sqlDb.close();
    });
  });

  // --- 401 on missing token ---

  describe('401 on missing/invalid token', () => {
    it('allow-self-password returns 401 when no Authorization header', async () => {
      const { sqlDb, d1 } = createTestDb();
      seedRepo(sqlDb);
      const env = makeEnv(d1);

      const request = makeRequest('POST', 'http://localhost/api/repos/myorg/myrepo/allow-self-password', { token: null });
      const response = await handleAllowSelfPassword(request, env, paramsFromUrl('myorg', 'myrepo'));

      expect(response.status).toBe(401);
      const body = await response.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      sqlDb.close();
    });

    it('disallow-self-password returns 401 when no Authorization header', async () => {
      const { sqlDb, d1 } = createTestDb();
      seedRepo(sqlDb);
      const env = makeEnv(d1);

      const request = makeRequest('POST', 'http://localhost/api/repos/myorg/myrepo/disallow-self-password', { token: null });
      const response = await handleDisallowSelfPassword(request, env, paramsFromUrl('myorg', 'myrepo'));

      expect(response.status).toBe(401);
      const body = await response.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      sqlDb.close();
    });

    it('allow-self-password returns 401 when token is wrong', async () => {
      const { sqlDb, d1 } = createTestDb();
      seedRepo(sqlDb);
      const env = makeEnv(d1);

      const request = makeRequest('POST', 'http://localhost/api/repos/myorg/myrepo/allow-self-password', { token: 'wrong-token' });
      const response = await handleAllowSelfPassword(request, env, paramsFromUrl('myorg', 'myrepo'));

      expect(response.status).toBe(401);
      sqlDb.close();
    });
  });

  // --- 404 on unknown repo ---

  describe('404 on unknown repo', () => {
    it('allow-self-password returns 404 for non-existent repo', async () => {
      const { sqlDb, d1 } = createTestDb();
      const env = makeEnv(d1);

      const request = makeRequest('POST', 'http://localhost/api/repos/unknown/repo/allow-self-password');
      const response = await handleAllowSelfPassword(request, env, paramsFromUrl('unknown', 'repo'));

      expect(response.status).toBe(404);
      const body = await response.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      sqlDb.close();
    });

    it('disallow-self-password returns 404 for non-existent repo', async () => {
      const { sqlDb, d1 } = createTestDb();
      const env = makeEnv(d1);

      const request = makeRequest('POST', 'http://localhost/api/repos/unknown/repo/disallow-self-password');
      const response = await handleDisallowSelfPassword(request, env, paramsFromUrl('unknown', 'repo'));

      expect(response.status).toBe(404);
      const body = await response.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      sqlDb.close();
    });
  });

  // --- Idempotence ---

  describe('idempotence (R2.9)', () => {
    it('calling allow twice succeeds both times and writes two audit entries', async () => {
      const { sqlDb, d1 } = createTestDb();
      seedRepo(sqlDb, { allow_repo_owner_password: 0 });
      const env = makeEnv(d1);

      const request1 = makeRequest('POST', 'http://localhost/api/repos/myorg/myrepo/allow-self-password');
      const response1 = await handleAllowSelfPassword(request1, env, paramsFromUrl('myorg', 'myrepo'));
      expect(response1.status).toBe(200);

      const request2 = makeRequest('POST', 'http://localhost/api/repos/myorg/myrepo/allow-self-password');
      const response2 = await handleAllowSelfPassword(request2, env, paramsFromUrl('myorg', 'myrepo'));
      expect(response2.status).toBe(200);

      // Flag should still be true
      expect(getRepoFlag(sqlDb, 'repo_test001')).toBe(1);

      // Two audit entries
      const auditRows = getAuditRows(sqlDb);
      expect(auditRows).toHaveLength(2);
      expect(auditRows[0]!['event_type']).toBe('repo.self_password_allowed');
      expect(auditRows[1]!['event_type']).toBe('repo.self_password_allowed');
      sqlDb.close();
    });

    it('calling disallow twice succeeds both times and writes two audit entries', async () => {
      const { sqlDb, d1 } = createTestDb();
      seedRepo(sqlDb, { allow_repo_owner_password: 1 });
      const env = makeEnv(d1);

      const request1 = makeRequest('POST', 'http://localhost/api/repos/myorg/myrepo/disallow-self-password');
      const response1 = await handleDisallowSelfPassword(request1, env, paramsFromUrl('myorg', 'myrepo'));
      expect(response1.status).toBe(200);

      const request2 = makeRequest('POST', 'http://localhost/api/repos/myorg/myrepo/disallow-self-password');
      const response2 = await handleDisallowSelfPassword(request2, env, paramsFromUrl('myorg', 'myrepo'));
      expect(response2.status).toBe(200);

      // Flag should still be false
      expect(getRepoFlag(sqlDb, 'repo_test001')).toBe(0);

      // Two audit entries
      const auditRows = getAuditRows(sqlDb);
      expect(auditRows).toHaveLength(2);
      expect(auditRows[0]!['event_type']).toBe('repo.self_password_disallowed');
      expect(auditRows[1]!['event_type']).toBe('repo.self_password_disallowed');
      sqlDb.close();
    });
  });

  // --- Property 3: Operator allow/disallow idempotence and audit completeness ---

  describe('Property 3: Operator allow/disallow idempotence and audit completeness', () => {
    /**
     * Feature: repo-owner-self-service-password, Property P-3: Operator allow/disallow idempotence and audit completeness
     *
     * **Validates: Requirements 2.1, 2.2, 2.8, 2.9**
     *
     * For any arbitrary sequence of allow/disallow calls:
     * 1. The final flag state matches the last call in the sequence
     * 2. The number of audit rows equals the total number of calls (idempotent writes)
     */
    it('final flag matches last call and audit count equals call count', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.boolean(), { minLength: 1, maxLength: 20 }),
          async (sequence) => {
            const { sqlDb, d1 } = createTestDb();
            seedRepo(sqlDb, { allow_repo_owner_password: 0 });
            const env = makeEnv(d1);

            for (const allow of sequence) {
              const request = makeRequest(
                'POST',
                `http://localhost/api/repos/myorg/myrepo/${allow ? 'allow' : 'disallow'}-self-password`,
              );
              const handler = allow ? handleAllowSelfPassword : handleDisallowSelfPassword;
              const response = await handler(request, env, paramsFromUrl('myorg', 'myrepo'));
              expect(response.status).toBe(200);
            }

            // Final flag state matches the last call
            const lastCall = sequence[sequence.length - 1]!;
            const finalFlag = getRepoFlag(sqlDb, 'repo_test001');
            expect(finalFlag).toBe(lastCall ? 1 : 0);

            // Audit row count equals total number of calls
            const auditRows = getAuditRows(sqlDb);
            expect(auditRows).toHaveLength(sequence.length);

            // Each audit row has the correct event type
            for (let i = 0; i < sequence.length; i++) {
              const expectedType = sequence[i]
                ? 'repo.self_password_allowed'
                : 'repo.self_password_disallowed';
              expect(auditRows[i]!['event_type']).toBe(expectedType);
              expect(auditRows[i]!['actor_type']).toBe('operator');
              expect(auditRows[i]!['repo_id']).toBe('repo_test001');
            }

            sqlDb.close();
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
