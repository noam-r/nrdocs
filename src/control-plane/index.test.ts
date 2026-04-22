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

  it('POST /projects/:id/publish → 404 when project not found', async () => {
    const res = await worker.fetch(req('POST', '/projects/abc/publish'), env, {} as ExecutionContext);
    expect(res.status).toBe(404);
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

  it('returns 201 with created project on success', async () => {
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
