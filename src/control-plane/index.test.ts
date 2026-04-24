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

  it('wrong method on known path → 404', async () => {
    const res = await worker.fetch(req('GET', '/projects'), env, {} as ExecutionContext);
    expect(res.status).toBe(404);
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
          stmt.run.mockRejectedValue(new Error('UNIQUE constraint failed: projects.slug'));
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

/**
 * Create a mock DB for the onboard handler.
 * Handles: bootstrap_tokens lookup, organizations lookup, INSERT INTO projects,
 * UPDATE projects, INSERT INTO operational_events, INSERT INTO repo_publish_tokens,
 * UPDATE bootstrap_tokens.
 */
function mockOnboardDB(opts: {
  bootstrapToken?: typeof TEST_BOOTSTRAP_TOKEN_RECORD | null;
  org?: typeof TEST_ORG | null;
  slugConflict?: boolean;
  invalidRepoIdentity?: boolean;
} = {}) {
  const bootstrapToken = opts.bootstrapToken !== undefined ? opts.bootstrapToken : TEST_BOOTSTRAP_TOKEN_RECORD;
  const org = opts.org !== undefined ? opts.org : TEST_ORG;

  const calls: string[] = [];

  const db = {
    prepare: vi.fn((sql: string) => {
      calls.push(sql);

      // bootstrap_tokens lookup by jti
      if (sql.includes('FROM bootstrap_tokens')) {
        return mockStmt(bootstrapToken);
      }
      // organizations lookup by id
      if (sql.includes('FROM organizations')) {
        return mockStmt(org);
      }
      // INSERT INTO projects — may throw for slug conflict or invalid repo_identity
      if (sql.includes('INSERT INTO projects')) {
        const stmt = mockStmt();
        if (opts.slugConflict) {
          stmt.run.mockRejectedValue(new Error('UNIQUE constraint failed: projects.slug'));
        }
        if (opts.invalidRepoIdentity) {
          stmt.run.mockRejectedValue(
            new Error('Invalid repo_identity format. Expected: github.com/<owner>/<repo>'),
          );
        }
        return stmt;
      }
      // UPDATE projects (updateProjectStatus)
      if (sql.includes('UPDATE projects')) {
        return mockStmt();
      }
      // INSERT INTO operational_events
      if (sql.includes('INSERT INTO operational_events')) {
        return mockStmt();
      }
      // INSERT INTO repo_publish_tokens
      if (sql.includes('INSERT INTO repo_publish_tokens')) {
        return mockStmt();
      }
      // UPDATE bootstrap_tokens (incrementBootstrapTokenUsage)
      if (sql.includes('UPDATE bootstrap_tokens')) {
        return mockStmt();
      }
      // Fallback
      return mockStmt();
    }),
    batch: vi.fn().mockResolvedValue([]),
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
    const db = mockOnboardDB({ invalidRepoIdentity: true });
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
    const exhaustedToken = { ...TEST_BOOTSTRAP_TOKEN_RECORD, repos_issued_count: 10 };
    const db = mockOnboardDB({ bootstrapToken: exhaustedToken });
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

    // Verify createProject was called (INSERT INTO projects)
    const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    const insertProject = prepareCalls.some((sql: string) => sql.includes('INSERT INTO projects'));
    expect(insertProject).toBe(true);

    // Verify updateProjectStatus was called to approve (UPDATE projects SET status)
    const updateProject = prepareCalls.some((sql: string) => sql.includes('UPDATE projects SET status'));
    expect(updateProject).toBe(true);
  });

  it('increments bootstrap token repos_issued_count after success', async () => {
    const token = await signBootstrapToken();
    const db = mockOnboardDB();
    const env = makeEnv({ DB: db, TOKEN_SIGNING_KEY: TEST_SIGNING_KEY });

    const res = await worker.fetch(onboardReq(token, VALID_ONBOARD_BODY), env, {} as ExecutionContext);
    expect(res.status).toBe(201);

    // Verify incrementBootstrapTokenUsage was called (UPDATE bootstrap_tokens SET repos_issued_count)
    const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    const incrementCall = prepareCalls.some(
      (sql: string) => sql.includes('UPDATE bootstrap_tokens') && sql.includes('repos_issued_count'),
    );
    expect(incrementCall).toBe(true);
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
