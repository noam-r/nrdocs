import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseRulesAddArgs } from '../commands/rules.js';

describe('parseRulesAddArgs --self-set-password', () => {
  it('omitted → selfSetPassword is undefined', () => {
    const opts = parseRulesAddArgs(['myorg/*', '--access', 'public']);
    expect(opts.selfSetPassword).toBeUndefined();
  });

  it('--self-set-password allow → "allow"', () => {
    const opts = parseRulesAddArgs(['myorg/*', '--access', 'public', '--self-set-password', 'allow']);
    expect(opts.selfSetPassword).toBe('allow');
  });

  it('--self-set-password deny → "deny"', () => {
    const opts = parseRulesAddArgs(['myorg/*', '--access', 'password', '--self-set-password', 'deny']);
    expect(opts.selfSetPassword).toBe('deny');
  });

  it('--self-set-password garbage → "__invalid__"', () => {
    const opts = parseRulesAddArgs(['myorg/*', '--access', 'public', '--self-set-password', 'garbage']);
    expect(opts.selfSetPassword).toBe('__invalid__');
  });
});

describe('handleRulesAdd end-to-end with stubbed ApiClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;
  let exitSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: { rule: {} } }),
      text: () => Promise.resolve(JSON.stringify({ ok: true, data: { rule: {} } })),
      status: 200,
      headers: { get: () => 'application/json' },
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    // Mock resolveCredentials via env vars
    process.env['NRDOCS_API_URL'] = 'https://api.test.com';
    process.env['NRDOCS_OPERATOR_TOKEN'] = 'test-token';

    // Spy on process.exit to prevent actual exit
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env['NRDOCS_API_URL'];
    delete process.env['NRDOCS_OPERATOR_TOKEN'];
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('omitted --self-set-password → body has default_allow_repo_owner_password: true', async () => {
    const { handleRulesAdd } = await import('../commands/rules.js');
    await handleRulesAdd(['myorg/*', '--access', 'public']);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body['default_allow_repo_owner_password']).toBe(true);
  });

  it('--self-set-password allow → body has default_allow_repo_owner_password: true', async () => {
    const { handleRulesAdd } = await import('../commands/rules.js');
    await handleRulesAdd(['myorg/*', '--access', 'public', '--self-set-password', 'allow']);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body['default_allow_repo_owner_password']).toBe(true);
  });

  it('--self-set-password deny → body has default_allow_repo_owner_password: false', async () => {
    const { handleRulesAdd } = await import('../commands/rules.js');
    await handleRulesAdd(['myorg/*', '--access', 'password', '--self-set-password', 'deny']);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body['default_allow_repo_owner_password']).toBe(false);
  });

  it('--self-set-password garbage → process.exit(2) and no HTTP request', async () => {
    const { handleRulesAdd } = await import('../commands/rules.js');

    await expect(
      handleRulesAdd(['myorg/*', '--access', 'public', '--self-set-password', 'garbage'])
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('formatRulesTable SELF-PWD column', () => {
  it('rule with default_allow_repo_owner_password=true shows "allow"', async () => {
    // formatRulesTable is not exported, so we test it via handleRulesList output
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.fn().mockResolvedValue({
      text: () =>
        Promise.resolve(
          JSON.stringify({
            ok: true,
            data: {
              rules: [
                {
                  id: 'rule_abc12345',
                  pattern: 'myorg/*',
                  access_mode: 'public',
                  default_allow_repo_owner_password: true,
                  enabled: true,
                  priority: 0,
                },
              ],
            },
          }),
        ),
      status: 200,
      headers: { get: () => 'application/json' },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    process.env['NRDOCS_API_URL'] = 'https://api.test.com';
    process.env['NRDOCS_OPERATOR_TOKEN'] = 'test-token';

    try {
      const { handleRulesList } = await import('../commands/rules.js');
      await handleRulesList([]);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('SELF-PWD');
      expect(output).toContain('allow');
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env['NRDOCS_API_URL'];
      delete process.env['NRDOCS_OPERATOR_TOKEN'];
      logSpy.mockRestore();
    }
  });

  it('rule with default_allow_repo_owner_password=false shows "deny"', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.fn().mockResolvedValue({
      text: () =>
        Promise.resolve(
          JSON.stringify({
            ok: true,
            data: {
              rules: [
                {
                  id: 'rule_xyz98765',
                  pattern: 'other/*',
                  access_mode: 'password',
                  default_allow_repo_owner_password: false,
                  enabled: true,
                  priority: 1,
                },
              ],
            },
          }),
        ),
      status: 200,
      headers: { get: () => 'application/json' },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    process.env['NRDOCS_API_URL'] = 'https://api.test.com';
    process.env['NRDOCS_OPERATOR_TOKEN'] = 'test-token';

    try {
      const { handleRulesList } = await import('../commands/rules.js');
      await handleRulesList([]);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('SELF-PWD');
      expect(output).toContain('deny');
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env['NRDOCS_API_URL'];
      delete process.env['NRDOCS_OPERATOR_TOKEN'];
      logSpy.mockRestore();
    }
  });

  it('column header is "SELF-PWD"', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.fn().mockResolvedValue({
      text: () =>
        Promise.resolve(
          JSON.stringify({
            ok: true,
            data: {
              rules: [
                {
                  id: 'rule_hdr12345',
                  pattern: 'test/*',
                  access_mode: 'public',
                  default_allow_repo_owner_password: true,
                  enabled: true,
                  priority: 0,
                },
              ],
            },
          }),
        ),
      status: 200,
      headers: { get: () => 'application/json' },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    process.env['NRDOCS_API_URL'] = 'https://api.test.com';
    process.env['NRDOCS_OPERATOR_TOKEN'] = 'test-token';

    try {
      const { handleRulesList } = await import('../commands/rules.js');
      await handleRulesList([]);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      // The header line should contain SELF-PWD
      const headerLine = output.split('\n')[0]!;
      expect(headerLine).toContain('SELF-PWD');
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env['NRDOCS_API_URL'];
      delete process.env['NRDOCS_OPERATOR_TOKEN'];
      logSpy.mockRestore();
    }
  });
});
