import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDotEnvFromAncestors, runAdmin } from './admin';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
  const TMP = join(process.cwd(), 'cli', 'src', '__test_admin_tmp__');
  const originalCwd = process.cwd();

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...origEnv };
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    process.env.NRDOCS_API_URL = 'https://cp.example';
    process.env.NRDOCS_API_KEY = 'admin-key';
    process.env.NRDOCS_REPO_ID = 'proj-1';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(TMP, '.git'), { recursive: true });
    mkdirSync(join(TMP, 'docs'), { recursive: true });
    process.chdir(TMP);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...origEnv };
    process.chdir(originalCwd);
    rmSync(TMP, { recursive: true, force: true });
  });

  it('status GETs /repos/:id with Bearer API key', async () => {
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
    expect(call[0]).toBe('https://cp.example/repos/proj-1');
    expect(call[1].method).toBe('GET');
    const headers = call[1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer admin-key');
  });

  it('admin init points to operator flow', async () => {
    await expect(runAdmin(['init'])).rejects.toThrow(/operator flow/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('missing admin env explains operator workspace separation', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/nrdocs-admin-test-no-env');
    delete process.env.NRDOCS_API_URL;
    let message = '';
    try {
      await runAdmin(['status']);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('operator workspace');
    expect(message).toContain('nrdocs init');
  });

  it('list defaults to GET /repos and prints table', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        repos: [{
          id: 'proj-1',
          slug: 'docs',
          title: 'Docs',
          status: 'approved',
          access_mode: 'public',
          repo_identity: 'github.com/org/docs',
          url: 'https://delivery.example.com/docs/',
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
    expect(call[0]).toBe('https://cp.example/repos');
    expect(call[1].method).toBe('GET');
    expect(out).toContain('docs');
    expect(out).toContain('https://delivery.example.com/docs/');
    expect(out).toContain('READER_URL');
    expect(out).toContain('Default is status=approved');
    expect(out).toMatch(/repo\(s\)/);
  });

  it('list passes filters as query parameters', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ repos: [], count: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runAdmin(['list', '--all', '--name', 'docs', '--status', 'disabled', '--repo-identity', 'github.com/org/repo']);
    log.mockRestore();

    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('https://cp.example/repos?all=1&status=disabled&name=docs&repo_identity=github.com%2Forg%2Frepo');
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

  it('approve with --mint-publish-token mints a repo publish JWT', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Repo approved', id: 'proj-arg' }), {
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
    await runAdmin(['approve', 'proj-arg', '--mint-publish-token', '--repo-identity', 'github.com/org/repo']);
    log.mockRestore();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const approveCall = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(approveCall[0]).toBe('https://cp.example/repos/proj-arg/approve');
    expect(approveCall[1].method).toBe('POST');
    const mintCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(mintCall[0]).toBe('https://cp.example/repos/proj-arg/publish-token');
    expect(JSON.parse(mintCall[1].body as string)).toEqual({ repo_identity: 'github.com/org/repo' });
  });

  it('approve without --mint-publish-token only calls approve', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Repo approved', id: 'proj-arg' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runAdmin(['approve', 'proj-arg']);
    log.mockRestore();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('https://cp.example/repos/proj-arg/approve');
  });

  it('mint-publish-token does not treat repo identity flag value as project id', async () => {
    process.env.NRDOCS_REPO_ID = 'proj-env';
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
    expect(call[0]).toBe('https://cp.example/repos/proj-env/publish-token');
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
    expect(out).toContain('Manual/operator-managed flow');
    expect(out).toContain('nrdocs admin approve <repo-id>');
    expect(out).not.toContain('export NRDOCS_REPO_ID');
    expect(fetchMock).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('register infers repo_url and repo_identity from .git/config origin', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'proj-new', slug: 'nrdocs' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    writeFileSync(
      join(TMP, '.git', 'config'),
      `[remote "origin"]\n  url = git@noam-r:noam-r/nrdocs.git\n`,
      'utf8',
    );
    writeFileSync(
      join(TMP, 'docs', 'project.yml'),
      `slug: nrdocs\ntitle: "nrdocs"\ndescription: "x"\npublish_enabled: true\naccess_mode: public\n`,
      'utf8',
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runAdmin(['register']);
    log.mockRestore();

    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('https://cp.example/repos');
    expect(call[1].method).toBe('POST');
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body.repo_url).toBe('https://github.com/noam-r/nrdocs');
    expect(body.repo_identity).toBe('github.com/noam-r/nrdocs');
  });

  it('register flags override inferred values', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'proj-new', slug: 'nrdocs' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    writeFileSync(
      join(TMP, '.git', 'config'),
      `[remote "origin"]\n  url = git@noam-r:noam-r/nrdocs.git\n`,
      'utf8',
    );
    writeFileSync(
      join(TMP, 'docs', 'project.yml'),
      `slug: nrdocs\ntitle: "nrdocs"\ndescription: "x"\npublish_enabled: true\naccess_mode: public\n`,
      'utf8',
    );

    await runAdmin([
      'register',
      '--repo-url',
      'https://github.com/override/override',
      '--repo-identity',
      'github.com/override/override',
    ]);

    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body.repo_url).toBe('https://github.com/override/override');
    expect(body.repo_identity).toBe('github.com/override/override');
  });

  it('register fails early when repo_identity cannot be resolved', async () => {
    writeFileSync(
      join(TMP, '.git', 'config'),
      `[remote "origin"]\n  url = https://example.com/not-github/repo.git\n`,
      'utf8',
    );
    writeFileSync(
      join(TMP, 'docs', 'project.yml'),
      `slug: nrdocs\ntitle: "nrdocs"\ndescription: "x"\npublish_enabled: true\naccess_mode: public\n`,
      'utf8',
    );

    await expect(runAdmin(['register'])).rejects.toThrow(/repo_identity could not be resolved/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('approve --mint-publish-token preflights GET repo and uses repo_identity for mint', async () => {
    delete process.env.NRDOCS_REPO_IDENTITY;

    fetchMock
      // preflight GET /repos/:id
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'proj-arg', repo_identity: 'github.com/org/repo' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      // approve
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Repo approved', id: 'proj-arg' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      // mint
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ repo_publish_token: 'token' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await runAdmin(['approve', 'proj-arg', '--mint-publish-token']);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const mintCall = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(mintCall[0]).toBe('https://cp.example/repos/proj-arg/publish-token');
    expect(JSON.parse(mintCall[1].body as string)).toEqual({ repo_identity: 'github.com/org/repo' });
  });

  it('approve prints partial-success remediation if mint fails after approval', async () => {
    delete process.env.NRDOCS_REPO_IDENTITY;

    fetchMock
      // preflight GET /repos/:id
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'proj-arg', repo_identity: 'github.com/org/repo' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      // approve
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Repo approved', id: 'proj-arg' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      // mint failure
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Missing repo_identity' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(runAdmin(['approve', 'proj-arg', '--mint-publish-token'])).rejects.toThrow(/Mint publish token failed/i);
    const out = err.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('Token mint failed after approval');
    expect(out).toContain('nrdocs admin mint-publish-token proj-arg --repo-identity github.com/org/repo');
    err.mockRestore();
  });
});
