import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import the worker default export
import worker, { type Env, buildEvent } from './index';
import * as GitHubOidc from '../auth/github-oidc';

/** Create a mock D1PreparedStatement. */
function mockStmt(result?: unknown) {
  return {
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue({ success: true }),
    first: vi.fn().mockResolvedValue(result ?? null),
    all: vi.fn().mockResolvedValue({ results: [] }),
  };
}

/** Create a mock D1Database. */
function mockDB(overrides: { prepareImpl?: (sql: string) => ReturnType<typeof mockStmt> } = {}) {
  const defaultStmt = mockStmt();
  return {
    prepare: vi.fn((sql: string) => overrides.prepareImpl?.(sql) ?? defaultStmt),
    batch: vi.fn().mockResolvedValue([]),
  } as unknown as D1Database;
}

/** Minimal mock env for testing. */
function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: mockDB(),
    BUCKET: {} as R2Bucket,
    API_KEY: 'test-secret-key-12345',
    HMAC_SIGNING_KEY: 'test-hmac-key',
    TOKEN_SIGNING_KEY: 'test-token-signing-key',
    ...overrides,
  };
}

/** Build a Request with optional auth header and JSON body. */
function req(
  method: string,
  path: string,
  opts: { apiKey?: string; noAuth?: boolean; body?: unknown } = {},
): Request {
  const headers = new Headers();
  if (!opts.noAuth) {
    headers.set('Authorization', `Bearer ${opts.apiKey ?? 'test-secret-key-12345'}`);
  }
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(opts.body);
  }
  return new Request(`https://control.example.com${path}`, init);
}

describe('Control Plane Worker — API key auth', () => {
  it('rejects requests with no Authorization header (401)', async () => {
    const env = makeEnv();
    const res = await worker.fetch(req('POST', '/repos', { noAuth: true }), env, {} as ExecutionContext);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Missing');
  });

  it('rejects requests with wrong API key (401)', async () => {
    const env = makeEnv();
    const res = await worker.fetch(req('POST', '/repos', { apiKey: 'wrong-key' }), env, {} as ExecutionContext);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Invalid');
  });

  it('rejects requests with malformed Authorization header (401)', async () => {
    const env = makeEnv();
    const request = new Request('https://control.example.com/repos', {
      method: 'POST',
      headers: { Authorization: 'Basic abc123' },
    });
    const res = await worker.fetch(request, env, {} as ExecutionContext);
    expect(res.status).toBe(401);
  });

  it('accepts requests with valid API key', async () => {
    const env = makeEnv();
    const res = await worker.fetch(req('POST', '/repos'), env, {} as ExecutionContext);
    // Should pass auth — now hits the real handler which returns 400 for missing body
    expect(res.status).not.toBe(401);
  });

  it('does not expose API key in error responses', async () => {
    const env = makeEnv();
    const res = await worker.fetch(req('POST', '/repos', { apiKey: 'wrong' }), env, {} as ExecutionContext);
    const text = await res.text();
    expect(text).not.toContain('test-secret-key-12345');
    expect(text).not.toContain('wrong');
  });
});

describe('Control Plane Worker — routing', () => {
  const env = makeEnv();

  it('POST /repos → handler (no longer stub)', async () => {
    const res = await worker.fetch(req('POST', '/repos'), env, {} as ExecutionContext);
    // Route is now implemented — returns 400 for missing body, not 501
    expect(res.status).toBe(400);
  });

  it('POST /repos/:id/approve → 404 when project not found', async () => {
    const res = await worker.fetch(req('POST', '/repos/abc/approve'), env, {} as ExecutionContext);
    expect(res.status).toBe(404);
  });

  it('POST /repos/:id/disable → 404 when project not found', async () => {
    const res = await worker.fetch(req('POST', '/repos/abc/disable'), env, {} as ExecutionContext);
    expect(res.status).toBe(404);
  });

  it('DELETE /repos/:id → 404 when project not found', async () => {
    const res = await worker.fetch(req('DELETE', '/repos/abc'), env, {} as ExecutionContext);
    expect(res.status).toBe(404);
  });

  it('POST /repos/:id/publish → 401 when no auth header', async () => {
    const res = await worker.fetch(req('POST', '/repos/abc/publish', { noAuth: true }), env, {} as ExecutionContext);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Missing authentication credentials');
  });

  it('POST /repos/:id/publish-token → 404 when project not found', async () => {
    const res = await worker.fetch(req('POST', '/repos/abc/publish-token', { body: {} }), env, {} as ExecutionContext);
    expect(res.status).toBe(404);
  });

  it('POST /repo-proof/challenges validates body when unauthenticated', async () => {
    const res = await worker.fetch(
      req('POST', '/repo-proof/challenges', { noAuth: true, body: {} }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('GET /status/:id returns limited status without API key', async () => {
    const repoRow = {
      id: 'proj-1',
      slug: 'demo',
      repo_url: 'https://github.com/acme/demo',
      title: 'Demo Docs',
      description: '',
      status: 'approved',
      access_mode: 'public',
      active_publish_pointer: 'publishes/demo/pub-1/',
      password_hash: null,
      password_version: 0,
      repo_identity: 'github.com/acme/demo',
      created_at: '2026-04-27T00:00:00.000Z',
      updated_at: '2026-04-27T00:00:00.000Z',
    };
    const statusEnv = makeEnv({
      DELIVERY_URL: 'https://docs.example',
      DB: mockDB({
        prepareImpl: (sql: string) => {
          if (sql.includes('FROM repos') && sql.includes('WHERE id = ?')) return mockStmt(repoRow);
          return mockStmt();
        },
      }),
    });

    const res = await worker.fetch(req('GET', '/status/proj-1', { noAuth: true }), statusEnv, {} as ExecutionContext);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      repo_id: 'proj-1',
      repo_identity: 'github.com/acme/demo',
      status: 'approved',
      approved: true,
      published: true,
      url: 'https://docs.example/demo/',
    });
    expect(body).not.toHaveProperty('password_hash');
  });

  it('POST /admin/overrides → 400 for missing body', async () => {
    const res = await worker.fetch(req('POST', '/admin/overrides'), env, {} as ExecutionContext);
    expect(res.status).toBe(400);
  });

  it('PUT /admin/overrides/:id → 400 for missing body', async () => {
    const res = await worker.fetch(req('PUT', '/admin/overrides/xyz'), env, {} as ExecutionContext);
    expect(res.status).toBe(400);
  });

  it('DELETE /admin/overrides/:id → 200', async () => {
    const res = await worker.fetch(req('DELETE', '/admin/overrides/xyz'), env, {} as ExecutionContext);
    expect(res.status).toBe(200);
  });

  it('unknown route → 404', async () => {
    const res = await worker.fetch(req('GET', '/unknown'), env, {} as ExecutionContext);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Not found');
  });

  it('GET /repos → lists approved repos by default', async () => {
    const res = await worker.fetch(req('GET', '/repos'), env, {} as ExecutionContext);
    expect(res.status).toBe(200);
    const body = await res.json() as { repos: unknown[]; count: number };
    expect(body.repos).toEqual([]);
    expect(body.count).toBe(0);
  });
});


describe('Control Plane Worker — POST /repos (registration)', () => {
  const validBody = {
    slug: 'my-project',
    repo_url: 'https://github.com/org/my-project',
    title: 'My Project',
    description: 'A test project',
    access_mode: 'public',
  };

  it('returns 201 with created repo on success', async () => {
    const db = mockDB();
    const env = makeEnv({ DB: db });
    const res = await worker.fetch(
      req('POST', '/repos', { body: validBody }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.slug).toBe('my-project');
    expect(body.repo_url).toBe('https://github.com/org/my-project');
    expect(body.title).toBe('My Project');
    expect(body.description).toBe('A test project');
    expect(body.access_mode).toBe('public');
    expect(body.status).toBe('awaiting_approval');
    expect(body.id).toBeDefined();
    expect(body.created_at).toBeDefined();
    expect(body).not.toHaveProperty('org_id');
  });

  it('calls D1 to insert project and record event', async () => {
    const db = mockDB();
    const env = makeEnv({ DB: db });
    await worker.fetch(
      req('POST', '/repos', { body: validBody }),
      env,
      {} as ExecutionContext,
    );
    // createProject INSERT + recordEvent INSERT = 2 prepare calls
    expect(db.prepare).toHaveBeenCalled();
  });

  it('returns 409 when slug already exists', async () => {
    const db = mockDB({
      prepareImpl: (sql: string) => {
        const stmt = mockStmt();
        if (sql.startsWith('INSERT INTO repos')) {
          stmt.run.mockRejectedValue(new Error('UNIQUE constraint failed: repos.slug'));
        }
        return stmt;
      },
    });
    const env = makeEnv({ DB: db });
    const res = await worker.fetch(
      req('POST', '/repos', { body: validBody }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('already exists');
  });

  it('returns 400 for missing slug', async () => {
    const env = makeEnv();
    const { slug, ...noSlug } = validBody;
    const res = await worker.fetch(
      req('POST', '/repos', { body: noSlug }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('slug');
  });

  it('returns 400 for missing repo_url', async () => {
    const env = makeEnv();
    const { repo_url, ...noRepo } = validBody;
    const res = await worker.fetch(
      req('POST', '/repos', { body: noRepo }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('repo_url');
  });

  it('returns 400 for missing title', async () => {
    const env = makeEnv();
    const { title, ...noTitle } = validBody;
    const res = await worker.fetch(
      req('POST', '/repos', { body: noTitle }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('title');
  });

  it('returns 400 for invalid access_mode', async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      req('POST', '/repos', { body: { ...validBody, access_mode: 'invite_list' } }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('access_mode');
  });

  it('returns 400 for invalid JSON body', async () => {
    const env = makeEnv();
    const request = new Request('https://control.example.com/repos', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-secret-key-12345',
        'Content-Type': 'application/json',
      },
      body: 'not json',
    });
    const res = await worker.fetch(request, env, {} as ExecutionContext);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Invalid JSON');
  });

  it('allows description to be omitted', async () => {
    const db = mockDB();
    const env = makeEnv({ DB: db });
    const { description, ...noDesc } = validBody;
    const res = await worker.fetch(
      req('POST', '/repos', { body: noDesc }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.description).toBe('');
  });

  it('returns 201 with repo_identity when provided', async () => {
    const db = mockDB();
    const env = makeEnv({ DB: db });
    const res = await worker.fetch(
      req('POST', '/repos', {
        body: { ...validBody, repo_identity: 'github.com/acme/docs' },
      }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.repo_identity).toBe('github.com/acme/docs');
  });

  it('returns 400 for invalid repo_identity format', async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      req('POST', '/repos', {
        body: { ...validBody, repo_identity: 'not-a-valid-identity' },
      }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Invalid repo_identity format');
  });
});

describe('Control Plane Worker — GET /repos (list)', () => {
  const projectRow = {
    id: 'p1',
    slug: 'alpha',
    repo_url: 'https://github.com/acme/alpha',
    title: 'Alpha Docs',
    description: 'Docs',
    status: 'approved',
    access_mode: 'public',
    active_publish_pointer: null,
    password_hash: null,
    password_version: 0,
    repo_identity: 'github.com/acme/alpha',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-02T00:00:00.000Z',
  };

  it('defaults to approved projects', async () => {
    let bindValues: unknown[] = [];
    const db = mockDB({
      prepareImpl: (sql: string) => {
        if (sql.includes('FROM repos')) {
          const stmt = mockStmt();
          stmt.bind.mockImplementation((...vals: unknown[]) => {
            bindValues = vals;
            return stmt;
          });
          stmt.all.mockResolvedValue({ results: [projectRow] });
          return stmt;
        }
        return mockStmt();
      },
    });
    const env = makeEnv({ DB: db, DELIVERY_URL: 'https://delivery.example.com' });
    const res = await worker.fetch(req('GET', '/repos'), env, {} as ExecutionContext);
    expect(res.status).toBe(200);
    expect(bindValues).toEqual(['approved']);
    const body = await res.json() as { repos: Array<Record<string, unknown>>; count: number };
    expect(body.count).toBe(1);
    expect(body.repos[0].slug).toBe('alpha');
    expect(body.repos[0].delivery_url).toBe('https://delivery.example.com');
    expect(body.repos[0].url).toBe('https://delivery.example.com/alpha/');
  });

  it('accepts filters and all=1 without default status', async () => {
    let capturedSql = '';
    let bindValues: unknown[] = [];
    const db = mockDB({
      prepareImpl: (sql: string) => {
        if (sql.includes('FROM repos')) {
          capturedSql = sql;
          const stmt = mockStmt();
          stmt.bind.mockImplementation((...vals: unknown[]) => {
            bindValues = vals;
            return stmt;
          });
          stmt.all.mockResolvedValue({ results: [] });
          return stmt;
        }
        return mockStmt();
      },
    });
    const env = makeEnv({ DB: db });
    const res = await worker.fetch(
      req('GET', '/repos?all=1&name=alpha&access_mode=public'),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    expect(capturedSql).toContain('LOWER(slug)');
    expect(bindValues).toEqual(['public', '%alpha%', '%alpha%']);
  });

  it('rejects invalid status', async () => {
    const env = makeEnv();
    const res = await worker.fetch(req('GET', '/repos?status=archived'), env, {} as ExecutionContext);
    expect(res.status).toBe(400);
  });
});

describe('buildEvent helper', () => {
  it('creates an event with UUID, timestamp, and correct fields', () => {
    const event = buildEvent('proj-123', 'registration', '{"slug":"test"}');
    expect(event.id).toBeDefined();
    expect(event.repo_id).toBe('proj-123');
    expect(event.event_type).toBe('registration');
    expect(event.detail).toBe('{"slug":"test"}');
    expect(event.created_at).toBeDefined();
  });

  it('sets detail to null when omitted', () => {
    const event = buildEvent(null, 'approval');
    expect(event.repo_id).toBeNull();
    expect(event.detail).toBeNull();
  });
});

describe('Control Plane Worker — repo-proof challenges', () => {
  it('issues a challenge (201) when enabled and repo matches', async () => {
    const project = {
      id: 'proj-1',
      slug: 'demo',
      repo_url: 'https://github.com/acme/demo',
      title: 'Demo Docs',
      description: '',
      status: 'approved',
      access_mode: 'public',
      active_publish_pointer: null,
      password_hash: null,
      password_version: 0,
      repo_identity: 'github.com/acme/demo',
      created_at: '2026-04-27T00:00:00.000Z',
      updated_at: '2026-04-27T00:00:00.000Z',
    };

    const db = mockDB({
      prepareImpl: (sql: string) => {
        if (sql.includes('SELECT * FROM repos') && sql.includes('WHERE id = ?')) {
          return { bind: () => ({ first: async () => project }) };
        }
        if (sql.includes('DELETE FROM repo_proof_challenges')) {
          return { bind: () => ({ run: async () => ({ meta: { changes: 0 } }) }) };
        }
        if (sql.includes('INSERT INTO repo_proof_challenges')) {
          return { bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) };
        }
        if (sql.includes('INSERT INTO operational_events')) {
          return { bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) };
        }
        return { bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) };
      },
    });

    const env = makeEnv({
      DB: db,
    });

    const res = await worker.fetch(
      req('POST', '/repo-proof/challenges', {
        noAuth: true,
        body: { repo_id: 'proj-1', repo_identity: 'github.com/acme/demo', action: 'set_password' },
      }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { challenge_id: string; public_token: string; private_token: string; verify_file_path: string };
    expect(body.challenge_id).toBeTruthy();
    expect(body.public_token).toBeTruthy();
    expect(body.private_token).toBeTruthy();
    expect(body.verify_file_path).toContain(body.challenge_id);
  });
});

describe('Control Plane Worker — POST /repos/:id/publish-token (operator mint)', () => {
  const APPROVED_PROJECT_ROW = {
    id: 'p1',
    slug: 's',
    repo_url: 'https://github.com/a/b',
    title: 't',
    description: '',
    status: 'approved',
    access_mode: 'public',
    active_publish_pointer: null,
    password_hash: null,
    password_version: 0,
    repo_identity: 'github.com/acmer/beta',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };

  function mintDb(projectRow: typeof APPROVED_PROJECT_ROW | null) {
    return {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('FROM repos') && sql.includes('WHERE id =')) {
          return mockStmt(projectRow);
        }
        if (sql.includes('INSERT INTO repo_publish_tokens')) {
          return mockStmt();
        }
        if (sql.includes('INSERT INTO operational_events')) {
          return mockStmt();
        }
        return mockStmt();
      }),
    } as unknown as D1Database;
  }

  it('returns 201 with JWT when project is approved and has repo_identity', async () => {
    const env = makeEnv({ DB: mintDb(APPROVED_PROJECT_ROW) });
    const res = await worker.fetch(req('POST', '/repos/p1/publish-token', { body: {} }), env, {} as ExecutionContext);
    expect(res.status).toBe(201);
    const body = await res.json() as { repo_publish_token: string };
    expect(body.repo_publish_token.split('.').length).toBe(3);
  });

  it('returns 409 when project is awaiting_approval', async () => {
    const row = { ...APPROVED_PROJECT_ROW, status: 'awaiting_approval' as const };
    const env = makeEnv({ DB: mintDb(row) });
    const res = await worker.fetch(req('POST', '/repos/p1/publish-token', { body: {} }), env, {} as ExecutionContext);
    expect(res.status).toBe(409);
  });

  it('returns 400 when repo_identity is missing on project and body', async () => {
    const row = { ...APPROVED_PROJECT_ROW, repo_identity: null };
    const env = makeEnv({ DB: mintDb(row) });
    const res = await worker.fetch(req('POST', '/repos/p1/publish-token', { body: {} }), env, {} as ExecutionContext);
    expect(res.status).toBe(400);
  });

  it('accepts repo_identity from JSON body', async () => {
    const row = { ...APPROVED_PROJECT_ROW, repo_identity: null };
    const env = makeEnv({ DB: mintDb(row) });
    const res = await worker.fetch(
      req('POST', '/repos/p1/publish-token', { body: { repo_identity: 'github.com/acmer/beta' } }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(201);
  });

  it('UPDATE repos.repo_identity when minting with body and project row had null identity', async () => {
    const row = { ...APPROVED_PROJECT_ROW, repo_identity: null };
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('FROM repos') && sql.includes('WHERE id =')) {
        return mockStmt(row);
      }
      if (sql.includes('UPDATE repos SET repo_identity')) {
        return mockStmt();
      }
      if (sql.includes('INSERT INTO repo_publish_tokens')) {
        return mockStmt();
      }
      if (sql.includes('INSERT INTO operational_events')) {
        return mockStmt();
      }
      return mockStmt();
    });
    const env = makeEnv({
      DB: { prepare, batch: vi.fn().mockResolvedValue([]) } as unknown as D1Database,
    });
    const res = await worker.fetch(
      req('POST', '/repos/p1/publish-token', { body: { repo_identity: 'github.com/acmer/beta' } }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(201);
    expect(
      prepare.mock.calls.some((c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE repos SET repo_identity')),
    ).toBe(true);
  });

  it('returns 409 when backfilling repo_identity hits unique constraint', async () => {
    const row = { ...APPROVED_PROJECT_ROW, repo_identity: null };
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('FROM repos') && sql.includes('WHERE id =')) {
        return mockStmt(row);
      }
      if (sql.includes('UPDATE repos SET repo_identity')) {
        return {
          bind: vi.fn().mockReturnThis(),
          run: vi.fn().mockRejectedValue(new Error('UNIQUE constraint failed: idx_repos_repo_identity_unique')),
          first: vi.fn(),
          all: vi.fn(),
        };
      }
      return mockStmt();
    });
    const env = makeEnv({
      DB: { prepare, batch: vi.fn().mockResolvedValue([]) } as unknown as D1Database,
    });
    const res = await worker.fetch(
      req('POST', '/repos/p1/publish-token', { body: { repo_identity: 'github.com/acmer/beta' } }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('already bound');
  });
});

describe('POST /oidc/register-project', () => {
  const registerBody = {
    slug: 'oidc-site',
    title: 'OIDC Site',
    description: '',
    access_mode: 'public' as const,
    repo_url: 'https://github.com/acme/from-oidc',
  };

  beforeEach(() => {
    vi.spyOn(GitHubOidc, 'verifyGitHubActionsOidcToken').mockResolvedValue({
      issuer: 'https://token.actions.githubusercontent.com',
      audience: 'https://control.example.com',
      repository: 'acme/from-oidc',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function oidcRegisterRequest(body: Record<string, unknown>) {
    return new Request('https://control.example.com/oidc/register-project', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer fake-oidc',
      },
      body: JSON.stringify(body),
    });
  }

  it('returns 201 without admin API key', async () => {
    const db = mockDB();
    const env = makeEnv({ DB: db });
    const res = await worker.fetch(oidcRegisterRequest(registerBody), env, {} as ExecutionContext);
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.slug).toBe('oidc-site');
    expect(body.status).toBe('awaiting_approval');
    expect(body.repo_identity).toBe('github.com/acme/from-oidc');
  });

  it('matches OIDC register path under a URL prefix (skips API key auth)', async () => {
    const db = mockDB();
    const env = makeEnv({ DB: db });
    const req = new Request('https://control.example.com/api/v1/oidc/register-project', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer fake-oidc',
      },
      body: JSON.stringify(registerBody),
    });
    const res = await worker.fetch(req, env, {} as ExecutionContext);
    expect(res.status).toBe(201);
  });

  it('returns 200 when repo_identity already exists (idempotent)', async () => {
    const row = {
      id: 'proj-existing',
      slug: 'oidc-site',
      repo_url: 'https://github.com/acme/from-oidc',
      title: 'OIDC Site',
      description: '',
      status: 'approved',
      access_mode: 'public',
      active_publish_pointer: null,
      password_hash: null,
      password_version: 0,
      repo_identity: 'github.com/acme/from-oidc',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const db = mockDB({
      prepareImpl: (sql: string) => {
        if (sql.includes('WHERE repo_identity = ?')) {
          return mockStmt(row);
        }
        return mockStmt();
      },
    });
    const env = makeEnv({ DB: db });
    const res = await worker.fetch(oidcRegisterRequest(registerBody), env, {} as ExecutionContext);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBe('proj-existing');
  });
});
