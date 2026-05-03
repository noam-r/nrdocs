import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TMP = join(process.cwd(), 'cli', 'src', '__test_config_tmp__');

describe('runConfig', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    process.env.NRDOCS_GLOBAL_STATE_DIR = TMP;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    rmSync(TMP, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('get prints <unset> when not configured', async () => {
    const { runConfig } = await import('./config');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runConfig(['get', 'api-url']);
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('<unset>');
    log.mockRestore();
  });

  it('set writes config and get prints value', async () => {
    const { runConfig } = await import('./config');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runConfig(['set', 'api-url', 'https://cp.example/']);
    await runConfig(['get', 'api-url']);

    const out = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('Set default api-url.');
    expect(out).toContain('https://cp.example');

    const cfg = JSON.parse(readFileSync(join(TMP, 'config.json'), 'utf8')) as { default_api_url?: string };
    expect(cfg.default_api_url).toBe('https://cp.example');

    log.mockRestore();
  });

  it('clear removes api-url', async () => {
    const { runConfig } = await import('./config');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runConfig(['set', 'api-url', 'https://cp.example']);
    await runConfig(['clear', 'api-url']);
    await runConfig(['get', 'api-url']);

    const out = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('Cleared default api-url.');
    expect(out).toContain('<unset>');

    log.mockRestore();
  });
});

