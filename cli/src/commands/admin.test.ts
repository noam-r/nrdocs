import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDotEnvFromAncestors, runAdmin } from './admin';

describe('loadDotEnvFromAncestors', () => {
  const orig = { ...process.env };

  afterEach(() => {
    process.env = { ...orig };
    vi.restoreAllMocks();
  });

  it('does not override an existing variable', () => {
    process.env.NRDOCS_API_URL = 'https://from-shell';
    vi.spyOn(process, 'cwd').mockReturnValue('/home/hgx/stuff/nrdocs');
    loadDotEnvFromAncestors('/home/hgx/stuff/nrdocs');
    expect(process.env.NRDOCS_API_URL).toBe('https://from-shell');
  });
});

describe('runAdmin', () => {
  const origEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...origEnv };
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    process.env.NRDOCS_API_URL = 'https://cp.example';
    process.env.NRDOCS_API_KEY = 'admin-key';
    process.env.NRDOCS_PROJECT_ID = 'proj-1';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...origEnv };
  });

  it('status GETs /projects/:id with Bearer API key', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'proj-1', slug: 'x' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runAdmin(['status']);
    log.mockRestore();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('https://cp.example/projects/proj-1');
    expect(call[1].method).toBe('GET');
    const headers = call[1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer admin-key');
  });

  it('admin init creates a bootstrap token and prints repo-owner command', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        bootstrap_token: 'bootstrap.jwt.token',
        org_slug: 'default',
        max_repos: 2,
        expires_at: '2026-05-01T00:00:00.000Z',
      }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runAdmin(['init', '--org', 'default', '--max-repos', '2', '--expires-in-days', '14', '--created-by', 'alice']);
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n');
    log.mockRestore();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('https://cp.example/bootstrap-tokens');
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body as string)).toEqual({
      org_slug: 'default',
      max_repos: 2,
      expires_in_days: 14,
      created_by: 'alice',
    });
    expect(out).toContain('Bootstrap token created.');
    expect(out).toContain("nrdocs init --token 'bootstrap.jwt.token'");
  });

  it('admin init --json prints raw response', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ bootstrap_token: 'bootstrap.jwt.token' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runAdmin(['init', '--json']);
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n');
    log.mockRestore();

    expect(out).toContain('"bootstrap_token": "bootstrap.jwt.token"');
  });

  it('missing admin env explains operator workspace separation', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/nrdocs-admin-test-no-env');
    delete process.env.NRDOCS_API_URL;
    let message = '';
    try {
      await runAdmin(['init']);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('operator workspace');
    expect(message).toContain('nrdocs init --token');
  });

  it('list defaults to GET /projects and prints table', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        projects: [{
          id: 'proj-1',
          slug: 'docs',
          title: 'Docs',
          status: 'approved',
          access_mode: 'public',
          repo_identity: 'github.com/org/docs',
        }],
        count: 1,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runAdmin(['list']);
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n');
    log.mockRestore();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('https://cp.example/projects');
    expect(call[1].method).toBe('GET');
    expect(out).toContain('docs');
    expect(out).toContain('Default is status=approved');
  });

  it('list passes filters as query parameters', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ projects: [], count: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runAdmin(['list', '--all', '--name', 'docs', '--status', 'disabled', '--repo-identity', 'github.com/org/repo']);
    log.mockRestore();

    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('https://cp.example/projects?all=1&status=disabled&name=docs&repo_identity=github.com%2Forg%2Frepo');
  });

  it('list explains stale control plane without dumping JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let message = '';
    try {
      await runAdmin(['list']);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain('./scripts/deploy.sh');
    expect(message).toContain('wrangler deploy --env control-plane');
    expect(err.mock.calls.map((c) => c.join(' ')).join('\n')).not.toContain('"error"');
    err.mockRestore();
  });

  it('approve accepts project id and mints publish token by default', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Project approved', id: 'proj-arg' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ repo_publish_token: 'token' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runAdmin(['approve', 'proj-arg', '--repo-identity', 'github.com/org/repo']);
    log.mockRestore();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const approveCall = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(approveCall[0]).toBe('https://cp.example/projects/proj-arg/approve');
    expect(approveCall[1].method).toBe('POST');
    const mintCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(mintCall[0]).toBe('https://cp.example/projects/proj-arg/publish-token');
    expect(JSON.parse(mintCall[1].body as string)).toEqual({ repo_identity: 'github.com/org/repo' });
  });

  it('approve can skip publish token minting', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Project approved', id: 'proj-arg' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runAdmin(['approve', 'proj-arg', '--no-mint-publish-token']);
    log.mockRestore();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('https://cp.example/projects/proj-arg/approve');
  });

  it('mint-publish-token does not treat repo identity flag value as project id', async () => {
    process.env.NRDOCS_PROJECT_ID = 'proj-env';
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ repo_publish_token: 'token' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runAdmin(['mint-publish-token', '--repo-identity', 'github.com/org/repo']);
    log.mockRestore();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('https://cp.example/projects/proj-env/publish-token');
    expect(JSON.parse(call[1].body as string)).toEqual({ repo_identity: 'github.com/org/repo' });
  });

  it('refuses non-help commands in CI without override', async () => {
    process.env.CI = 'true';
    await expect(runAdmin(['status'])).rejects.toThrow(/Refusing admin CLI in CI/);
  });

  it('quick-guide prints common workflows without env or network', async () => {
    delete process.env.NRDOCS_API_URL;
    delete process.env.NRDOCS_API_KEY;
    process.env.CI = 'true';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runAdmin(['quick-guide']);

    const out = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('nrdocs admin quick guide');
    expect(out).toContain('Recommended onboarding flow');
    expect(out).toContain('Manual/operator-managed project flow');
    expect(out).toContain('nrdocs admin approve <project-id> --repo-identity');
    expect(out).not.toContain('export NRDOCS_PROJECT_ID');
    expect(fetchMock).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
