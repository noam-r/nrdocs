import { describe, it, expect, vi } from 'vitest';

// Import the worker default export
import worker, { type Env, buildEvent } from './index';

/** Create a mock D1PreparedStatement. */
function mockStmt(result?: unknown) {
  return {
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue({ success: true }),
    first: vi.fn().mockResolvedValue(result ?? null),
    all: vi.fn().mockResolvedValue({ results: [] }),
  };
}

/** Default organization record returned by mock DB. */
const DEFAULT_ORG = {
  id: '00000000-0000-0000-0000-000000000001',
  slug: 'default',
  name: 'Default Organization',
  status: 'active',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

/** Create a mock D1Database. */
function mockDB(overrides: { prepareImpl?: (sql: string) => ReturnType<typeof mockStmt> } = {}) {
  const defaultStmt = mockStmt();
  return {
    prepare: vi.fn((sql: string) => {
      // Return default org for organization slug lookups
      if (sql.includes('FROM organizations') && sql.includes('slug')) {
        return mockStmt(DEFAULT_ORG);
      }
      return overrides.prepareImpl?.(sql) ?? defaultStmt;
    }),
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
    const res = await worker.fetch(req('POST', '/projects', { noAuth: true }), env, {} as ExecutionContext);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Missing');
  });

  it('rejects requests with wrong API key (401)', async () => {
    const env = makeEnv();
    const res = await worker.fetch(req('POST', '/projects', { apiKey: 'wrong-key' }), env, {} as ExecutionContext);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Invalid');
  });

  it('rejects requests with malformed Authorization header (401)', async () => {
    const env = makeEnv();
    const request = new Request('https://control.example.com/projects', {
      method: 'POST',
      headers: { Authorization: 'Basic abc123' },
    });
    const res = await worker.fetch(request, env, {} as ExecutionContext);
    expect(res.status).toBe(401);
  });

  it('accepts requests with valid API key', async () => {
    const env = makeEnv();
    const res = await worker.fetch(req('POST', '/projects'), env, {} as ExecutionContext);
    // Should pass auth — now hits the real handler which returns 400 for missing body
    expect(res.status).not.toBe(401);
  });

  it('does not expose API key in error responses', async () => {
    const env = makeEnv();
    const res = await worker.fetch(req('POST', '/projects', { apiKey: 'wrong' }), env, {} as ExecutionContext);
    const text = await res.text();
    expect(text).not.toContain('test-secret-key-12345');
    expect(text).not.toContain('wrong');
  });
});

describe('Control Plane Worker — routing', () => {
  const env = makeEnv();

  it('POST /projects → handler (no longer stub)', async () => {
    const res = await worker.fetch(req('POST', '/projects'), env, {} as ExecutionContext);
    // Route is now implemented — returns 400 for missing body, not 501
    expect(res.status).toBe(400);
  });

  it('POST /projects/:id/approve → 404 when project not found', async () => {
    const res = await worker.fetch(req('POST', '/projects/abc/approve'), env, {} as ExecutionContext);
    expect(res.status).toBe(404);
  });

  it('POST /projects/:id/disable → 404 when project not found', async () => {
    const res = await worker.fetch(req('POST', '/projects/abc/disable'), env, {} as ExecutionContext);
    expect(res.status).toBe(404);
  });

  it('DELETE /projects/:id → 404 when project not found', async () => {
    const res = await worker.fetch(req('DELETE', '/projects/abc'), env, {} as ExecutionContext);
    expect(res.status).toBe(404);
  });

  it('POST /projects/:id/publish → 401 when no auth header', async () => {
    const res = await worker.fetch(req('POST', '/projects/abc/publish', { noAuth: true }), env, {} as ExecutionContext);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Missing authentication credentials');
  });

  it('POST /projects/:id/publish-token → 404 when project not found', async () => {
    const res = await worker.fetch(req('POST', '/projects/abc/publish-token', { body: {} }), env, {} as ExecutionContext);
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
    const project = {
      id: 'proj-1',
      slug: 'demo',
      org_id: DEFAULT_ORG.id,
      repo_url: 'https://github.com/acme/demo',
      title: 'Demo Docs',
      description: '',
      status: 'approved',
      access_mode: 'public',
      active_publish_pointer: 'publishes/default/demo/pub-1/',
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
          if (sql.includes('FROM projects') && sql.includes('id = ?')) return mockStmt(project);
          if (sql.includes('FROM organizations') && sql.includes('id = ?')) return mockStmt(DEFAULT_ORG);
          return mockStmt();
        },
      }),
    });

    const res = await worker.fetch(req('GET', '/status/proj-1', { noAuth: true }), statusEnv, {} as ExecutionContext);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      project_id: 'proj-1',
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

  it('GET /projects → lists approved projects by default', async () => {
    const res = await worker.fetch(req('GET', '/projects'), env, {} as ExecutionContext);
    expect(res.status).toBe(200);
    const body = await res.json() as { projects: unknown[]; count: number };
    expect(body.projects).toEqual([]);
    expect(body.count).toBe(0);
  });
});


describe('Control Plane Worker — POST /projects (registration)', () => {
  const validBody = {
    slug: 'my-project',
    repo_url: 'https://github.com/org/my-project',
    title: 'My Project',
    description: 'A test project',
    access_mode: 'public',
  };

  it('returns 201 with created project on success, including org_id', async () => {
    const db = mockDB();
    const env = makeEnv({ DB: db });
    const res = await worker.fetch(
      req('POST', '/projects', { body: validBody }),
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
    expect(body.org_id).toBe(DEFAULT_ORG.id);
  });

  it('calls D1 to insert project and record event', async () => {
    const db = mockDB();
    const env = makeEnv({ DB: db });
    await worker.fetch(
      req('POST', '/projects', { body: validBody }),
      env,
      {} as ExecutionContext,
    );
    // createProject INSERT + recordEvent INSERT = 2 prepare calls
    expect(db.prepare).toHaveBeenCalled();
  });

  it('returns 409 when slug already exists', async () => {
    const db = mockDB({
      prepareImpl: (sql: string) => {
        if (sql.includes('FROM organizations') && sql.includes('slug')) {
          return mockStmt(DEFAULT_ORG);
        }
        const stmt = mockStmt();
        if (sql.startsWith('INSERT INTO projects')) {
          stmt.run.mockRejectedValue(
            new Error('UNIQUE constraint failed: projects.org_id, projects.slug'),
          );
        }
        return stmt;
      },
    });
    const env = makeEnv({ DB: db });
    const res = await worker.fetch(
      req('POST', '/projects', { body: validBody }),
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
      req('POST', '/projects', { body: noSlug }),
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
      req('POST', '/projects', { body: noRepo }),
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
      req('POST', '/projects', { body: noTitle }),
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
      req('POST', '/projects', { body: { ...validBody, access_mode: 'invite_list' } }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('access_mode');
  });

  it('returns 400 for invalid JSON body', async () => {
    const env = makeEnv();
    const request = new Request('https://control.example.com/projects', {
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
      req('POST', '/projects', { body: noDesc }),
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
      req('POST', '/projects', {
        body: { ...validBody, repo_identity: 'github.com/acme/docs' },
      }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.repo_identity).toBe('github.com/acme/docs');
    expect(body.org_id).toBe(DEFAULT_ORG.id);
  });

  it('returns 400 for invalid repo_identity format', async () => {
    const db = mockDB({
      prepareImpl: (sql: string) => {
        if (sql.includes('FROM organizations') && sql.includes('slug')) {
          return mockStmt(DEFAULT_ORG);
        }
        const stmt = mockStmt();
        if (sql.startsWith('INSERT INTO projects')) {
          stmt.run.mockRejectedValue(
            new Error('Invalid repo_identity format. Expected: github.com/<owner>/<repo>'),
          );
        }
        return stmt;
      },
    });
    const env = makeEnv({ DB: db });
    const res = await worker.fetch(
      req('POST', '/projects', {
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

describe('Control Plane Worker — GET /projects (list)', () => {
  const projectRow = {
    id: 'p1',
    slug: 'alpha',
    org_id: DEFAULT_ORG.id,
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
        if (sql.includes('FROM projects')) {
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
    const env = makeEnv({ DB: db });
    const res = await worker.fetch(req('GET', '/projects'), env, {} as ExecutionContext);
    expect(res.status).toBe(200);
    expect(bindValues).toEqual(['approved']);
    const body = await res.json() as { projects: Array<Record<string, unknown>>; count: number };
    expect(body.count).toBe(1);
    expect(body.projects[0].slug).toBe('alpha');
  });

  it('accepts filters and all=1 without default status', async () => {
    let capturedSql = '';
    let bindValues: unknown[] = [];
    const db = mockDB({
      prepareImpl: (sql: string) => {
        if (sql.includes('FROM projects')) {
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
      req('GET', '/projects?all=1&name=alpha&access_mode=public'),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    expect(capturedSql).toContain('LOWER(slug)');
    expect(bindValues).toEqual(['public', '%alpha%', '%alpha%']);
  });

  it('rejects invalid status', async () => {
    const env = makeEnv();
    const res = await worker.fetch(req('GET', '/projects?status=archived'), env, {} as ExecutionContext);
    expect(res.status).toBe(400);
  });
});

describe('buildEvent helper', () => {
  it('creates an event with UUID, timestamp, and correct fields', () => {
    const event = buildEvent('proj-123', 'registration', '{"slug":"test"}');
    expect(event.id).toBeDefined();
    expect(event.project_id).toBe('proj-123');
    expect(event.event_type).toBe('registration');
    expect(event.detail).toBe('{"slug":"test"}');
    expect(event.created_at).toBeDefined();
  });

  it('sets detail to null when omitted', () => {
    const event = buildEvent(null, 'approval');
    expect(event.project_id).toBeNull();
    expect(event.detail).toBeNull();
  });
});

import { signNrdocsToken } from '../auth/jwt-utils';
import type { NrdocsTokenPayload } from '../auth/jwt-utils';

const TEST_SIGNING_KEY = 'test-token-signing-key-for-bootstrap';
const TEST_ISSUER = 'https://control.example.com';
const TEST_JTI = 'bootstrap-jti-001';

const TEST_ORG = {
  id: 'org-001',
  slug: 'acme',
  name: 'Acme Corp',
  status: 'active',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

const TEST_BOOTSTRAP_TOKEN_RECORD = {
  id: 'bt-001',
  jti: TEST_JTI,
  org_id: TEST_ORG.id,
  status: 'active',
  created_by: 'admin',
  created_at: '2024-01-01T00:00:00.000Z',
  expires_at: '2025-12-31T00:00:00.000Z',
  max_repos: 10,
  repos_issued_count: 2,
  last_used_at: null,
};

/** Sign a valid bootstrap token JWT for testing. */
async function signBootstrapToken(overrides: Partial<NrdocsTokenPayload> = {}): Promise<string> {
  const payload: NrdocsTokenPayload = {
    v: 1,
    typ: 'org_bootstrap',
    iss: TEST_ISSUER,
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    jti: TEST_JTI,
    ...overrides,
  };
  return signNrdocsToken(payload, TEST_SIGNING_KEY);
}

/** Create a mock DB that returns bootstrap token and org records for handleBootstrapInit. */
function mockBootstrapDB(opts: {
  bootstrapToken?: typeof TEST_BOOTSTRAP_TOKEN_RECORD | null;
  org?: typeof TEST_ORG | null;
} = {}) {
  const bootstrapToken = opts.bootstrapToken !== undefined ? opts.bootstrapToken : TEST_BOOTSTRAP_TOKEN_RECORD;
  const org = opts.org !== undefined ? opts.org : TEST_ORG;

  return {
    prepare: vi.fn((sql: string) => {
      // bootstrap_tokens lookup by jti
      if (sql.includes('FROM bootstrap_tokens')) {
        return mockStmt(bootstrapToken);
      }
      // organizations lookup by id
      if (sql.includes('FROM organizations') && sql.includes('id')) {
        return mockStmt(org);
      }
      // Fallback for any other queries
      return mockStmt();
    }),
    batch: vi.fn().mockResolvedValue([]),
  } as unknown as D1Database;
}

/** Build a bootstrap init request. */
function bootstrapReq(token: string, body?: unknown): Request {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  const init: RequestInit = { method: 'POST', headers };
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(body);
  }
  return new Request(`${TEST_ISSUER}/bootstrap/init`, init);
}

describe('Control Plane Worker — POST /bootstrap/init (validation-only)', () => {
  it('returns 200 with org_name, org_slug, remaining_quota, expires_at for valid token', async () => {
    const token = await signBootstrapToken();
    const db = mockBootstrapDB();
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const res = await worker.fetch(bootstrapReq(token), env, {} as ExecutionContext);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.org_name).toBe(TEST_ORG.name);
    expect(body.org_slug).toBe(TEST_ORG.slug);
    expect(body.delivery_url).toBeUndefined();
    expect(body.remaining_quota).toBe(
      TEST_BOOTSTRAP_TOKEN_RECORD.max_repos - TEST_BOOTSTRAP_TOKEN_RECORD.repos_issued_count,
    );
    expect(body.expires_at).toBe(TEST_BOOTSTRAP_TOKEN_RECORD.expires_at);
  });

  it('accepts empty request body', async () => {
    const token = await signBootstrapToken();
    const db = mockBootstrapDB();
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    // Send with empty JSON body
    const res = await worker.fetch(bootstrapReq(token, {}), env, {} as ExecutionContext);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.org_name).toBe(TEST_ORG.name);
    expect(body.org_slug).toBe(TEST_ORG.slug);
  });

  it('accepts request with no body at all', async () => {
    const token = await signBootstrapToken();
    const db = mockBootstrapDB();
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    // Send with no body (no Content-Type header either)
    const res = await worker.fetch(bootstrapReq(token), env, {} as ExecutionContext);
    expect(res.status).toBe(200);
  });

  it('returns 403 when org is disabled', async () => {
    const token = await signBootstrapToken();
    const disabledOrg = { ...TEST_ORG, status: 'disabled' };
    const db = mockBootstrapDB({ org: disabledOrg });
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const res = await worker.fetch(bootstrapReq(token), env, {} as ExecutionContext);
    expect(res.status).toBe(403);

    const body = await res.json() as { error: string };
    expect(body.error).toBe('Organization is disabled');
  });

  it('returns 401 when no Authorization header is provided', async () => {
    const env = makeEnv({ TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });
    const request = new Request(`${TEST_ISSUER}/bootstrap/init`, { method: 'POST' });

    const res = await worker.fetch(request, env, {} as ExecutionContext);
    expect(res.status).toBe(401);

    const body = await res.json() as { error: string };
    expect(body.error).toBe('Missing or invalid bootstrap token');
  });

  it('returns 401 for invalid token signature', async () => {
    const token = await signNrdocsToken(
      { v: 1, typ: 'org_bootstrap', iss: TEST_ISSUER, exp: Math.floor(Date.now() / 1000) + 3600, jti: TEST_JTI },
      'wrong-signing-key',
    );
    const db = mockBootstrapDB();
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const res = await worker.fetch(bootstrapReq(token), env, {} as ExecutionContext);
    expect(res.status).toBe(401);
  });

  it('bypasses API key auth (no API key needed)', async () => {
    const token = await signBootstrapToken();
    const db = mockBootstrapDB();
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    // The request uses Bearer bootstrap token, not the API key
    const res = await worker.fetch(bootstrapReq(token), env, {} as ExecutionContext);
    expect(res.status).toBe(200);
  });

  it('returns 403 when org is not found', async () => {
    const token = await signBootstrapToken();
    const db = mockBootstrapDB({ org: null });
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const res = await worker.fetch(bootstrapReq(token), env, {} as ExecutionContext);
    expect(res.status).toBe(403);

    const body = await res.json() as { error: string };
    expect(body.error).toBe('Organization is disabled');
  });
});

function mockCreateBootstrapTokenDB(opts: { org?: typeof TEST_ORG | null } = {}) {
  const org = opts.org !== undefined ? opts.org : TEST_ORG;
  return {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('FROM organizations') && sql.includes('slug')) {
        return mockStmt(org);
      }
      if (sql.includes('INSERT INTO bootstrap_tokens')) {
        return mockStmt();
      }
      return mockStmt();
    }),
    batch: vi.fn().mockResolvedValue([]),
  } as unknown as D1Database;
}

describe('Control Plane Worker — POST /bootstrap-tokens (operator issuance)', () => {
  it('creates a bootstrap token with defaults', async () => {
    const db = mockCreateBootstrapTokenDB();
    const env = makeEnv({
      DB: db,
      TOKEN_SIGNING_KEY: TEST_SIGNING_KEY,
      DELIVERY_URL: 'https://docs.example.com/',
    });

    const res = await worker.fetch(req('POST', '/bootstrap-tokens', { body: {} }), env, {} as ExecutionContext);

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.bootstrap_token).toBe('string');
    expect((body.bootstrap_token as string).split('.')).toHaveLength(3);
    expect(body.org_slug).toBe('acme');
    expect(body.max_repos).toBe(1);
    expect(body.delivery_url).toBe('https://docs.example.com');
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO bootstrap_tokens'));
  });

  it('returns 404 for an unknown organization', async () => {
    const env = makeEnv({ DB: mockCreateBootstrapTokenDB({ org: null }), TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });
    const res = await worker.fetch(
      req('POST', '/bootstrap-tokens', { body: { org_slug: 'missing' } }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid max_repos', async () => {
    const env = makeEnv({ DB: mockCreateBootstrapTokenDB(), TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });
    const res = await worker.fetch(
      req('POST', '/bootstrap-tokens', { body: { max_repos: 0 } }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('requires API-key auth', async () => {
    const env = makeEnv({ DB: mockCreateBootstrapTokenDB(), TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });
    const res = await worker.fetch(
      req('POST', '/bootstrap-tokens', { noAuth: true, body: {} }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });
});


/** Build a bootstrap onboard request. */
function onboardReq(token: string, body?: unknown): Request {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  const init: RequestInit = { method: 'POST', headers };
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(body);
  }
  return new Request(`${TEST_ISSUER}/bootstrap/onboard`, init);
}

const VALID_ONBOARD_BODY = {
  slug: 'my-docs',
  title: 'My Docs',
  description: 'A documentation project',
  repo_identity: 'github.com/acme/my-docs',
};

const EXISTING_ONBOARD_PROJECT = {
  id: 'existing-project-1',
  slug: 'my-docs',
  org_id: TEST_ORG.id,
  repo_url: '',
  title: 'My Docs',
  description: 'A documentation project',
  status: 'approved',
  access_mode: 'public',
  active_publish_pointer: null,
  password_hash: null,
  password_version: 0,
  repo_identity: 'github.com/acme/my-docs',
  created_at: '2026-04-27T00:00:00.000Z',
  updated_at: '2026-04-27T00:00:00.000Z',
};

const EXISTING_BOOTSTRAP_PUBLISH_TOKEN = {
  id: 'repo-token-1',
  jti: 'repo-token-jti-1',
  org_id: TEST_ORG.id,
  project_id: 'existing-project-1',
  repo_identity: 'github.com/acme/my-docs',
  status: 'active',
  created_from_bootstrap_jti: TEST_BOOTSTRAP_TOKEN_RECORD.jti,
  created_at: '2026-04-27T00:00:00.000Z',
  expires_at: '2027-04-27T00:00:00.000Z',
  last_used_at: null,
};

/**
 * Create a mock DB for the onboard handler.
 * Handles: bootstrap_tokens lookup, organizations lookup, guarded quota UPDATE,
 * D1 batch (INSERT project + token + event), optional release UPDATE.
 */
function mockOnboardDB(opts: {
  bootstrapToken?: typeof TEST_BOOTSTRAP_TOKEN_RECORD | null;
  org?: typeof TEST_ORG | null;
  slugConflict?: boolean;
  existingProject?: Record<string, unknown> | null;
  existingRepoPublishToken?: Record<string, unknown> | null;
  /** Rows changed for tryReserveBootstrapRepoSlot (0 = quota exhausted). Default 1. */
  quotaReserveChanges?: number;
} = {}) {
  const bootstrapToken = opts.bootstrapToken !== undefined ? opts.bootstrapToken : TEST_BOOTSTRAP_TOKEN_RECORD;
  const org = opts.org !== undefined ? opts.org : TEST_ORG;
  const existingProject = opts.existingProject !== undefined ? opts.existingProject : null;
  const existingRepoPublishToken = opts.existingRepoPublishToken !== undefined ? opts.existingRepoPublishToken : null;
  const quotaReserveChanges = opts.quotaReserveChanges ?? 1;

  const calls: string[] = [];

  const db = {
    prepare: vi.fn((sql: string) => {
      calls.push(sql);

      if (sql.includes('FROM bootstrap_tokens')) {
        return mockStmt(bootstrapToken);
      }
      if (sql.includes('FROM organizations')) {
        return mockStmt(org);
      }
      if (sql.includes('FROM projects p') && sql.includes('p.slug')) {
        return mockStmt(existingProject);
      }
      if (sql.includes('FROM repo_publish_tokens') && sql.includes('created_from_bootstrap_jti')) {
        return mockStmt(existingRepoPublishToken);
      }
      if (sql.includes('UPDATE bootstrap_tokens') && sql.includes('repos_issued_count + 1')) {
        const stmt = mockStmt();
        stmt.run.mockResolvedValue({ success: true, meta: { changes: quotaReserveChanges } });
        return stmt;
      }
      if (sql.includes('UPDATE bootstrap_tokens') && sql.includes('repos_issued_count - 1')) {
        return mockStmt();
      }
      if (sql.includes('INSERT INTO projects')) {
        const stmt = mockStmt();
        if (opts.slugConflict) {
          stmt.run.mockRejectedValue(
            new Error('UNIQUE constraint failed: projects.org_id, projects.slug'),
          );
        }
        return stmt;
      }
      if (sql.includes('INSERT INTO operational_events')) {
        return mockStmt();
      }
      if (sql.includes('INSERT INTO repo_publish_tokens')) {
        return mockStmt();
      }
      return mockStmt();
    }),
    batch: vi.fn(async (stmts: { run: () => Promise<unknown> }[]) => {
      for (const s of stmts) {
        await s.run();
      }
      return [];
    }),
    _calls: calls,
  } as unknown as D1Database & { _calls: string[] };

  return db;
}

describe('Control Plane Worker — POST /bootstrap/onboard', () => {
  it('returns 201 with project_id and repo_publish_token on happy path', async () => {
    const token = await signBootstrapToken();
    const db = mockOnboardDB();
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const res = await worker.fetch(onboardReq(token, VALID_ONBOARD_BODY), env, {} as ExecutionContext);
    expect(res.status).toBe(201);

    const body = await res.json() as Record<string, unknown>;
    expect(body.project_id).toBeDefined();
    expect(typeof body.project_id).toBe('string');
    expect(body.repo_publish_token).toBeDefined();
    expect(typeof body.repo_publish_token).toBe('string');
    // The repo_publish_token should be a JWT (3 dot-separated segments)
    expect((body.repo_publish_token as string).split('.').length).toBe(3);
  });

  it('recovers an unpublished project created by the same bootstrap token without consuming another slot', async () => {
    const token = await signBootstrapToken();
    const db = mockOnboardDB({
      existingProject: EXISTING_ONBOARD_PROJECT,
      existingRepoPublishToken: EXISTING_BOOTSTRAP_PUBLISH_TOKEN,
      quotaReserveChanges: 0,
    });
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const res = await worker.fetch(onboardReq(token, VALID_ONBOARD_BODY), env, {} as ExecutionContext);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.project_id).toBe('existing-project-1');
    expect(body.recovered).toBe(true);
    expect(typeof body.repo_publish_token).toBe('string');

    const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(prepareCalls.some((sql: string) => sql.includes('repos_issued_count + 1'))).toBe(false);
    expect(prepareCalls.some((sql: string) => sql.includes('INSERT INTO repo_publish_tokens'))).toBe(true);
  });

  it('does not recover an existing project created by a different bootstrap token', async () => {
    const token = await signBootstrapToken();
    const db = mockOnboardDB({
      existingProject: EXISTING_ONBOARD_PROJECT,
      existingRepoPublishToken: null,
    });
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const res = await worker.fetch(onboardReq(token, VALID_ONBOARD_BODY), env, {} as ExecutionContext);
    expect(res.status).toBe(409);

    const body = await res.json() as { error: string };
    expect(body.error).toContain('was not created by this bootstrap token');
  });

  it('does not recover an already published project', async () => {
    const token = await signBootstrapToken();
    const db = mockOnboardDB({
      existingProject: {
        ...EXISTING_ONBOARD_PROJECT,
        active_publish_pointer: 'publishes/default/my-docs/pub-1/',
      },
      existingRepoPublishToken: EXISTING_BOOTSTRAP_PUBLISH_TOKEN,
    });
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const res = await worker.fetch(onboardReq(token, VALID_ONBOARD_BODY), env, {} as ExecutionContext);
    expect(res.status).toBe(409);

    const body = await res.json() as { error: string };
    expect(body.error).toContain('already exists and has been published');
  });

  it('returns 400 for missing slug', async () => {
    const token = await signBootstrapToken();
    const db = mockOnboardDB();
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const { slug, ...noSlug } = VALID_ONBOARD_BODY;
    const res = await worker.fetch(onboardReq(token, noSlug), env, {} as ExecutionContext);
    expect(res.status).toBe(400);

    const body = await res.json() as { error: string };
    expect(body.error).toContain('slug');
  });

  it('returns 400 for missing title', async () => {
    const token = await signBootstrapToken();
    const db = mockOnboardDB();
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const { title, ...noTitle } = VALID_ONBOARD_BODY;
    const res = await worker.fetch(onboardReq(token, noTitle), env, {} as ExecutionContext);
    expect(res.status).toBe(400);

    const body = await res.json() as { error: string };
    expect(body.error).toContain('title');
  });

  it('returns 400 for missing repo_identity', async () => {
    const token = await signBootstrapToken();
    const db = mockOnboardDB();
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const { repo_identity, ...noRepoIdentity } = VALID_ONBOARD_BODY;
    const res = await worker.fetch(onboardReq(token, noRepoIdentity), env, {} as ExecutionContext);
    expect(res.status).toBe(400);

    const body = await res.json() as { error: string };
    expect(body.error).toContain('repo_identity');
  });

  it('returns 400 for invalid repo_identity format', async () => {
    const token = await signBootstrapToken();
    const db = mockOnboardDB();
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const res = await worker.fetch(
      onboardReq(token, { ...VALID_ONBOARD_BODY, repo_identity: 'not-valid' }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);

    const body = await res.json() as { error: string };
    expect(body.error).toContain('Invalid repo_identity format');
  });

  it('returns 409 for slug conflict', async () => {
    const token = await signBootstrapToken();
    const db = mockOnboardDB({ slugConflict: true });
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const res = await worker.fetch(onboardReq(token, VALID_ONBOARD_BODY), env, {} as ExecutionContext);
    expect(res.status).toBe(409);

    const body = await res.json() as { error: string };
    expect(body.error).toContain('already exists');
  });

  it('returns 403 when quota is exceeded', async () => {
    const token = await signBootstrapToken();
    const db = mockOnboardDB({ quotaReserveChanges: 0 });
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const res = await worker.fetch(onboardReq(token, VALID_ONBOARD_BODY), env, {} as ExecutionContext);
    expect(res.status).toBe(403);

    const body = await res.json() as { error: string };
    expect(body.error).toContain('repo limit');
  });

  it('returns 403 when org is disabled', async () => {
    const token = await signBootstrapToken();
    const disabledOrg = { ...TEST_ORG, status: 'disabled' };
    const db = mockOnboardDB({ org: disabledOrg });
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const res = await worker.fetch(onboardReq(token, VALID_ONBOARD_BODY), env, {} as ExecutionContext);
    expect(res.status).toBe(403);

    const body = await res.json() as { error: string };
    expect(body.error).toBe('Organization is disabled');
  });

  it('creates project with status approved and default access_mode public', async () => {
    const token = await signBootstrapToken();
    const db = mockOnboardDB();
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const res = await worker.fetch(onboardReq(token, VALID_ONBOARD_BODY), env, {} as ExecutionContext);
    expect(res.status).toBe(201);

    const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    const insertProject = prepareCalls.some((sql: string) => sql.includes('INSERT INTO projects'));
    expect(insertProject).toBe(true);

    expect((db.batch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('reserves bootstrap quota via guarded UPDATE before batch insert', async () => {
    const token = await signBootstrapToken();
    const db = mockOnboardDB();
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const res = await worker.fetch(onboardReq(token, VALID_ONBOARD_BODY), env, {} as ExecutionContext);
    expect(res.status).toBe(201);

    const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    const reserveCall = prepareCalls.some(
      (sql: string) =>
        sql.includes('UPDATE bootstrap_tokens')
        && sql.includes('repos_issued_count + 1')
        && sql.includes('repos_issued_count <'),
    );
    expect(reserveCall).toBe(true);
  });

  it('records project_created operational event', async () => {
    const token = await signBootstrapToken();
    const db = mockOnboardDB();
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const res = await worker.fetch(onboardReq(token, VALID_ONBOARD_BODY), env, {} as ExecutionContext);
    expect(res.status).toBe(201);

    // Verify recordEvent was called (INSERT INTO operational_events)
    const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    const eventInsert = prepareCalls.some((sql: string) => sql.includes('INSERT INTO operational_events'));
    expect(eventInsert).toBe(true);
  });

  it('bypasses API key auth (uses bootstrap token auth)', async () => {
    const token = await signBootstrapToken();
    const db = mockOnboardDB();
    // Use a different API key to prove it's not checked
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY, API_KEY: 'some-other-api-key' });

    const res = await worker.fetch(onboardReq(token, VALID_ONBOARD_BODY), env, {} as ExecutionContext);
    // Should succeed with 201, not 401 — proving API key auth was bypassed
    expect(res.status).toBe(201);
  });

  it('returns 401 when no Authorization header is provided', async () => {
    const db = mockOnboardDB();
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const request = new Request(`${TEST_ISSUER}/bootstrap/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_ONBOARD_BODY),
    });
    const res = await worker.fetch(request, env, {} as ExecutionContext);
    expect(res.status).toBe(401);

    const body = await res.json() as { error: string };
    expect(body.error).toBe('Missing or invalid bootstrap token');
  });

  it('returns 403 when org is not found', async () => {
    const token = await signBootstrapToken();
    const db = mockOnboardDB({ org: null });
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const res = await worker.fetch(onboardReq(token, VALID_ONBOARD_BODY), env, {} as ExecutionContext);
    expect(res.status).toBe(403);

    const body = await res.json() as { error: string };
    expect(body.error).toBe('Organization is disabled');
  });

  it('allows description to be omitted', async () => {
    const token = await signBootstrapToken();
    const db = mockOnboardDB();
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const { description, ...noDesc } = VALID_ONBOARD_BODY;
    const res = await worker.fetch(onboardReq(token, noDesc), env, {} as ExecutionContext);
    expect(res.status).toBe(201);

    const body = await res.json() as Record<string, unknown>;
    expect(body.project_id).toBeDefined();
    expect(body.repo_publish_token).toBeDefined();
  });
});

describe('Control Plane Worker — repo-proof challenges', () => {
  it('issues a challenge (201) when enabled and repo matches', async () => {
    const project = {
      id: 'proj-1',
      slug: 'demo',
      org_id: DEFAULT_ORG.id,
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
        if (sql.includes('SELECT * FROM projects WHERE id = ?')) {
          return { bind: () => ({ first: async () => project }) };
        }
        if (sql.includes('SELECT * FROM repo_proof_challenges')) {
          return { bind: () => ({ first: async () => null }) };
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
      TOKEN_SIGNING_KEY: TEST_SIGNING_KEY,
    });

    const res = await worker.fetch(
      req('POST', '/repo-proof/challenges', {
        noAuth: true,
        body: { project_id: 'proj-1', repo_identity: 'github.com/acme/demo', action: 'set_password' },
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

describe('Control Plane Worker — POST /projects/:id/publish-token (operator mint)', () => {
  const APPROVED_PROJECT_ROW = {
    id: 'p1',
    slug: 's',
    org_id: DEFAULT_ORG.id,
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
        if (sql.includes('FROM projects') && sql.includes('WHERE id =')) {
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
    const env = makeEnv({ DB: mintDb(APPROVED_PROJECT_ROW), TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });
    const res = await worker.fetch(req('POST', '/projects/p1/publish-token', { body: {} }), env, {} as ExecutionContext);
    expect(res.status).toBe(201);
    const body = await res.json() as { repo_publish_token: string };
    expect(body.repo_publish_token.split('.').length).toBe(3);
  });

  it('returns 409 when project is awaiting_approval', async () => {
    const row = { ...APPROVED_PROJECT_ROW, status: 'awaiting_approval' as const };
    const env = makeEnv({ DB: mintDb(row), TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });
    const res = await worker.fetch(req('POST', '/projects/p1/publish-token', { body: {} }), env, {} as ExecutionContext);
    expect(res.status).toBe(409);
  });

  it('returns 400 when repo_identity is missing on project and body', async () => {
    const row = { ...APPROVED_PROJECT_ROW, repo_identity: null };
    const env = makeEnv({ DB: mintDb(row), TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });
    const res = await worker.fetch(req('POST', '/projects/p1/publish-token', { body: {} }), env, {} as ExecutionContext);
    expect(res.status).toBe(400);
  });

  it('accepts repo_identity from JSON body', async () => {
    const row = { ...APPROVED_PROJECT_ROW, repo_identity: null };
    const env = makeEnv({ DB: mintDb(row), TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });
    const res = await worker.fetch(
      req('POST', '/projects/p1/publish-token', { body: { repo_identity: 'github.com/acmer/beta' } }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(201);
  });
});
