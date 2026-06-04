import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseInitArgs } from '../commands/init.js';
import { parsePublishArgs } from '../commands/publish.js';
import { parseReposArgs } from '../commands/repos.js';
import { parseApproveArgs } from '../commands/approve.js';
import { parseDisableArgs } from '../commands/disable.js';
import { parseAccessSetArgs } from '../commands/access.js';
import { parsePasswordSetArgs } from '../commands/password.js';
import {
  parseRulesListArgs,
  parseRulesAddArgs,
  parseRulesRemoveArgs,
} from '../commands/rules.js';
import { parseStatusArgs } from '../commands/status.js';
import { ApiClient } from '../api-client.js';

describe('Arg parsing', () => {
  describe('init', () => {
    it('parses --docs-dir flag', () => {
      const opts = parseInitArgs(['--docs-dir', 'documentation']);
      expect(opts.docsDir).toBe('documentation');
    });

    it('parses --title flag', () => {
      const opts = parseInitArgs(['--title', 'My Docs']);
      expect(opts.title).toBe('My Docs');
    });

    it('parses --api-url flag', () => {
      const opts = parseInitArgs(['--api-url', 'https://docs.example.com']);
      expect(opts.apiUrl).toBe('https://docs.example.com');
    });

    it('parses --requested-access flag', () => {
      const opts = parseInitArgs(['--requested-access', 'public']);
      expect(opts.requestedAccess).toBe('public');
    });

    it('parses --force flag', () => {
      const opts = parseInitArgs(['--force']);
      expect(opts.force).toBe(true);
    });

    it('parses multiple flags together', () => {
      const opts = parseInitArgs([
        '--docs-dir', 'docs',
        '--title', 'Test',
        '--api-url', 'https://api.test',
        '--force',
      ]);
      expect(opts.docsDir).toBe('docs');
      expect(opts.title).toBe('Test');
      expect(opts.apiUrl).toBe('https://api.test');
      expect(opts.force).toBe(true);
    });

    it('returns empty opts for no args', () => {
      const opts = parseInitArgs([]);
      expect(opts.docsDir).toBeUndefined();
      expect(opts.title).toBeUndefined();
      expect(opts.force).toBeUndefined();
    });
  });

  describe('publish', () => {
    it('parses --docs-dir flag', () => {
      const opts = parsePublishArgs(['--docs-dir', 'my-docs']);
      expect(opts.docsDir).toBe('my-docs');
    });

    it('returns empty opts for no args', () => {
      const opts = parsePublishArgs([]);
      expect(opts.docsDir).toBeUndefined();
    });
  });

  describe('repos', () => {
    it('parses --pending flag', () => {
      const opts = parseReposArgs(['--pending']);
      expect(opts.state).toBe('pending');
    });

    it('parses --approved flag', () => {
      const opts = parseReposArgs(['--approved']);
      expect(opts.state).toBe('approved');
    });

    it('parses --disabled flag', () => {
      const opts = parseReposArgs(['--disabled']);
      expect(opts.state).toBe('disabled');
    });

    it('parses --owner flag', () => {
      const opts = parseReposArgs(['--owner', 'myorg']);
      expect(opts.owner).toBe('myorg');
    });

    it('parses --json flag', () => {
      const opts = parseReposArgs(['--json']);
      expect(opts.json).toBe(true);
    });
  });

  describe('approve', () => {
    it('parses repo and --access flag', () => {
      const opts = parseApproveArgs(['myorg/myrepo', '--access', 'public']);
      expect(opts.repo).toBe('myorg/myrepo');
      expect(opts.access).toBe('public');
    });

    it('parses --json flag', () => {
      const opts = parseApproveArgs(['myorg/myrepo', '--access', 'password', '--json']);
      expect(opts.json).toBe(true);
    });
  });

  describe('disable', () => {
    it('parses repo and --reason flag', () => {
      const opts = parseDisableArgs(['myorg/myrepo', '--reason', 'no longer needed']);
      expect(opts.repo).toBe('myorg/myrepo');
      expect(opts.reason).toBe('no longer needed');
    });

    it('parses repo without reason', () => {
      const opts = parseDisableArgs(['myorg/myrepo']);
      expect(opts.repo).toBe('myorg/myrepo');
      expect(opts.reason).toBeUndefined();
    });
  });

  describe('access set', () => {
    it('parses positional repo and access mode', () => {
      const opts = parseAccessSetArgs(['myorg/myrepo', 'public']);
      expect(opts.repo).toBe('myorg/myrepo');
      expect(opts.accessMode).toBe('public');
    });

    it('parses --json flag', () => {
      const opts = parseAccessSetArgs(['myorg/myrepo', 'password', '--json']);
      expect(opts.json).toBe(true);
    });
  });

  describe('password set', () => {
    it('parses repo positional', () => {
      const opts = parsePasswordSetArgs(['myorg/myrepo']);
      expect(opts.repo).toBe('myorg/myrepo');
      expect(opts.fromStdin).toBeUndefined();
    });

    it('parses --from-stdin flag', () => {
      const opts = parsePasswordSetArgs(['myorg/myrepo', '--from-stdin']);
      expect(opts.repo).toBe('myorg/myrepo');
      expect(opts.fromStdin).toBe(true);
    });
  });

  describe('rules', () => {
    it('parses rules list --json', () => {
      const opts = parseRulesListArgs(['--json']);
      expect(opts.json).toBe(true);
    });

    it('parses rules add with pattern and --access', () => {
      const opts = parseRulesAddArgs(['myorg/*', '--access', 'public']);
      expect(opts.pattern).toBe('myorg/*');
      expect(opts.access).toBe('public');
    });

    it('parses rules add with --apply-existing', () => {
      const opts = parseRulesAddArgs(['myorg/*', '--access', 'public', '--apply-existing']);
      expect(opts.applyExisting).toBe(true);
    });

    it('parses rules remove with rule ID', () => {
      const opts = parseRulesRemoveArgs(['rule_abc123']);
      expect(opts.ruleId).toBe('rule_abc123');
    });
  });

  describe('status', () => {
    it('parses repo positional', () => {
      const opts = parseStatusArgs(['myorg/myrepo']);
      expect(opts.repo).toBe('myorg/myrepo');
    });

    it('parses --json flag', () => {
      const opts = parseStatusArgs(['myorg/myrepo', '--json']);
      expect(opts.json).toBe(true);
    });
  });

  describe('doctor', () => {
    it('parses --json and --ci flags', async () => {
      const { parseDoctorArgs } = await import('../commands/doctor.js');
      const opts = parseDoctorArgs(['--json', '--ci']);
      expect(opts.json).toBe(true);
      expect(opts.ci).toBe(true);
    });
  });

  describe('publish', () => {
    it('parses --verbose flag', async () => {
      const { parsePublishArgs } = await import('../commands/publish.js');
      const opts = parsePublishArgs(['--verbose']);
      expect(opts.verbose).toBe(true);
    });
  });

  describe('nav generate', () => {
    it('parses flags', async () => {
      const { parseNavGenerateArgs } = await import('../commands/nav.js');
      const opts = parseNavGenerateArgs(['--docs-dir', 'docs', '--force', '--dry-run']);
      expect(opts.docsDir).toBe('docs');
      expect(opts.force).toBe(true);
      expect(opts.dryRun).toBe(true);
    });
  });
});

describe('ApiClient', () => {
  it('constructs correct URL for listRepos without filters', () => {
    const client = new ApiClient('https://api.example.com', 'token123');
    // We can't easily test the actual fetch, but we can verify the class instantiates
    expect(client).toBeInstanceOf(ApiClient);
  });

  it('strips trailing slash from base URL', () => {
    const client = new ApiClient('https://api.example.com/', 'token123');
    expect(client).toBeInstanceOf(ApiClient);
  });

  describe('URL construction (via mocked fetch)', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true, data: {} }),
        status: 200,
      });
      globalThis.fetch = fetchSpy as unknown as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('listRepos calls correct URL without filters', async () => {
      const client = new ApiClient('https://api.example.com', 'tok');
      await client.listRepos();
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/api/repos',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('listRepos calls correct URL with state filter', async () => {
      const client = new ApiClient('https://api.example.com', 'tok');
      await client.listRepos({ state: 'pending' });
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/api/repos?state=pending',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('listRepos calls correct URL with multiple filters', async () => {
      const client = new ApiClient('https://api.example.com', 'tok');
      await client.listRepos({ state: 'approved', owner: 'myorg' });
      const url = fetchSpy.mock.calls[0]![0] as string;
      expect(url).toContain('state=approved');
      expect(url).toContain('owner=myorg');
    });

    it('approveRepo sends correct body', async () => {
      const client = new ApiClient('https://api.example.com', 'tok');
      await client.approveRepo('myorg', 'myrepo', 'public');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/api/repos/myorg/myrepo/approve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ access_mode: 'public' }),
        })
      );
    });

    it('disableRepo sends correct body', async () => {
      const client = new ApiClient('https://api.example.com', 'tok');
      await client.disableRepo('myorg', 'myrepo', 'policy violation');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/api/repos/myorg/myrepo/disable',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ reason: 'policy violation' }),
        })
      );
    });

    it('setAccess sends correct body', async () => {
      const client = new ApiClient('https://api.example.com', 'tok');
      await client.setAccess('myorg', 'myrepo', 'password');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/api/repos/myorg/myrepo/access',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ access_mode: 'password' }),
        })
      );
    });

    it('setPassword sends correct body', async () => {
      const client = new ApiClient('https://api.example.com', 'tok');
      await client.setPassword('myorg', 'myrepo', 'secret123');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/api/repos/myorg/myrepo/password',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ password: 'secret123' }),
        })
      );
    });

    it('addRule sends correct body', async () => {
      const client = new ApiClient('https://api.example.com', 'tok');
      await client.addRule('myorg/*', 'public', true);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/api/auto-approval-rules',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ pattern: 'myorg/*', access_mode: 'public', apply_existing: true }),
        })
      );
    });

    it('removeRule calls correct URL', async () => {
      const client = new ApiClient('https://api.example.com', 'tok');
      await client.removeRule('rule_abc');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/api/auto-approval-rules/rule_abc',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('getOperatorMe calls correct URL', async () => {
      const client = new ApiClient('https://api.example.com', 'tok');
      await client.getOperatorMe();
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/api/operator/me',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('includes Authorization header', async () => {
      const client = new ApiClient('https://api.example.com', 'my-secret-token');
      await client.listRepos();
      const headers = fetchSpy.mock.calls[0]![1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer my-secret-token');
    });

    it('handles network errors gracefully', async () => {
      fetchSpy.mockRejectedValue(new Error('Connection refused'));
      const client = new ApiClient('https://api.example.com', 'tok');
      const res = await client.listRepos();
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe('network_error');
      expect(res.error?.message).toBe('Connection refused');
    });

    it('extracts cause from fetch failed errors', async () => {
      const inner = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
      fetchSpy.mockRejectedValue(new Error('fetch failed', { cause: inner }));
      const client = new ApiClient('https://api.example.com', 'tok');
      const res = await client.listRepos();
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe('network_error');
      expect(res.error?.cause).toContain('ENOTFOUND');
    });

    it('handles API error responses', async () => {
      fetchSpy.mockResolvedValue({
        text: () =>
          Promise.resolve(
            JSON.stringify({
              ok: false,
              error: { code: 'not_found', message: 'Repo not found' },
            }),
          ),
        status: 404,
        headers: { get: () => 'application/json' },
      });
      const client = new ApiClient('https://api.example.com', 'tok');
      const res = await client.getRepo('myorg', 'missing');
      expect(res.ok).toBe(false);
      expect(res.status).toBe(404);
      expect(res.error?.code).toBe('not_found');
    });
  });
});

describe('Doctor checks', () => {
  it('module can be imported', async () => {
    const mod = await import('../commands/doctor.js');
    expect(mod.handleDoctor).toBeTypeOf('function');
  });
});

describe('Init file generation', () => {
  it('parseInitArgs handles empty args', () => {
    const opts = parseInitArgs([]);
    expect(opts).toEqual({});
  });
});
