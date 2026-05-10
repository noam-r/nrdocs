import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  getConfigDir,
  getConfigPath,
  loadConfig,
  saveConfig,
  getProfile,
  setProfile,
  removeProfile,
  listProfiles,
  createProfile,
  redactToken,
  resolveCredentials,
  createDefaultConfig,
} from '../config/index.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nrdocs-test-'));
}

function cleanTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('config/paths', () => {
  it('getConfigDir uses override when provided', () => {
    const dir = getConfigDir('/tmp/custom');
    expect(dir).toBe('/tmp/custom');
  });

  it('getConfigDir uses XDG_CONFIG_HOME if set', () => {
    const original = process.env['XDG_CONFIG_HOME'];
    process.env['XDG_CONFIG_HOME'] = '/tmp/xdg';
    try {
      const dir = getConfigDir();
      expect(dir).toBe('/tmp/xdg/nrdocs');
    } finally {
      if (original === undefined) {
        delete process.env['XDG_CONFIG_HOME'];
      } else {
        process.env['XDG_CONFIG_HOME'] = original;
      }
    }
  });

  it('getConfigDir falls back to ~/.config/nrdocs', () => {
    const original = process.env['XDG_CONFIG_HOME'];
    delete process.env['XDG_CONFIG_HOME'];
    try {
      const dir = getConfigDir();
      expect(dir).toBe(path.join(os.homedir(), '.config', 'nrdocs'));
    } finally {
      if (original !== undefined) {
        process.env['XDG_CONFIG_HOME'] = original;
      }
    }
  });

  it('getConfigPath returns path ending in config.json', () => {
    const p = getConfigPath('/tmp/test');
    expect(p).toBe('/tmp/test/config.json');
  });
});

describe('config/store', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('loadConfig returns default config when file does not exist', () => {
    const config = loadConfig(tmpDir);
    expect(config.version).toBe(1);
    expect(config.default_profile).toBe('default');
    expect(config.profiles).toEqual({});
  });

  it('saveConfig creates file and loadConfig reads it back', () => {
    const config = createDefaultConfig();
    config.profiles['test'] = createProfile('https://api.example.com', 'nrdocs_op_abc123');

    saveConfig(config, tmpDir);

    const loaded = loadConfig(tmpDir);
    expect(loaded.version).toBe(1);
    expect(loaded.profiles['test']?.api_url).toBe('https://api.example.com');
    expect(loaded.profiles['test']?.operator_token).toBe('nrdocs_op_abc123');
  });

  it('saveConfig creates directory if it does not exist', () => {
    const nested = path.join(tmpDir, 'nested', 'dir');
    const config = createDefaultConfig();
    saveConfig(config, nested);

    expect(fs.existsSync(path.join(nested, 'config.json'))).toBe(true);
  });

  it('loadConfig throws on invalid JSON', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'config.json'), 'not json');

    expect(() => loadConfig(tmpDir)).toThrow();
  });

  it('loadConfig throws on unsupported version', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'config.json'),
      JSON.stringify({ version: 99, default_profile: 'x', profiles: {} })
    );

    expect(() => loadConfig(tmpDir)).toThrow(/Unsupported config version/);
  });
});

describe('config/profiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('setProfile and getProfile round-trip', () => {
    const profile = createProfile('https://api.test.com', 'nrdocs_op_token123');
    setProfile('myprofile', profile, tmpDir);

    const loaded = getProfile('myprofile', tmpDir);
    expect(loaded).toBeDefined();
    expect(loaded!.api_url).toBe('https://api.test.com');
    expect(loaded!.operator_token).toBe('nrdocs_op_token123');
  });

  it('getProfile returns undefined for non-existent profile', () => {
    const profile = getProfile('nonexistent', tmpDir);
    expect(profile).toBeUndefined();
  });

  it('removeProfile removes existing profile', () => {
    const profile = createProfile('https://api.test.com', 'nrdocs_op_token123');
    setProfile('todelete', profile, tmpDir);

    const removed = removeProfile('todelete', tmpDir);
    expect(removed).toBe(true);
    expect(getProfile('todelete', tmpDir)).toBeUndefined();
  });

  it('removeProfile returns false for non-existent profile', () => {
    const removed = removeProfile('nonexistent', tmpDir);
    expect(removed).toBe(false);
  });

  it('listProfiles returns all profile names', () => {
    setProfile('alpha', createProfile('https://a.com', 'nrdocs_op_a'), tmpDir);
    setProfile('beta', createProfile('https://b.com', 'nrdocs_op_b'), tmpDir);

    const profiles = listProfiles(tmpDir);
    expect(profiles).toContain('alpha');
    expect(profiles).toContain('beta');
    expect(profiles).toHaveLength(2);
  });

  it('redactToken redacts long tokens', () => {
    const redacted = redactToken('nrdocs_op_abcdefghijklmnop');
    expect(redacted).toBe('nrdocs_op_...');
    expect(redacted).not.toContain('abcdefghijklmnop');
  });

  it('redactToken redacts short tokens', () => {
    const redacted = redactToken('short');
    expect(redacted).toBe('****');
  });
});

describe('config/resolve', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    // Clear env vars
    delete process.env['NRDOCS_API_URL'];
    delete process.env['NRDOCS_OPERATOR_TOKEN'];
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
    delete process.env['NRDOCS_API_URL'];
    delete process.env['NRDOCS_OPERATOR_TOKEN'];
  });

  it('resolves from CLI flags (highest priority)', () => {
    // Set up config with different values
    setProfile('default', createProfile('https://config.com', 'nrdocs_op_config'), tmpDir);
    process.env['NRDOCS_API_URL'] = 'https://env.com';
    process.env['NRDOCS_OPERATOR_TOKEN'] = 'nrdocs_op_env';

    const creds = resolveCredentials({
      apiUrl: 'https://flag.com',
      token: 'nrdocs_op_flag',
      configDir: tmpDir,
    });

    expect(creds.api_url).toBe('https://flag.com');
    expect(creds.operator_token).toBe('nrdocs_op_flag');
  });

  it('resolves from env vars when no flags', () => {
    setProfile('default', createProfile('https://config.com', 'nrdocs_op_config'), tmpDir);
    process.env['NRDOCS_API_URL'] = 'https://env.com';
    process.env['NRDOCS_OPERATOR_TOKEN'] = 'nrdocs_op_env';

    const creds = resolveCredentials({ configDir: tmpDir });

    expect(creds.api_url).toBe('https://env.com');
    expect(creds.operator_token).toBe('nrdocs_op_env');
  });

  it('resolves from config when no flags or env', () => {
    setProfile('default', createProfile('https://config.com', 'nrdocs_op_config'), tmpDir);

    const creds = resolveCredentials({ configDir: tmpDir });

    expect(creds.api_url).toBe('https://config.com');
    expect(creds.operator_token).toBe('nrdocs_op_config');
  });

  it('throws helpful error when no API URL available', () => {
    expect(() => resolveCredentials({ configDir: tmpDir })).toThrow(
      /No API URL configured.*nrdocs auth login/
    );
  });

  it('throws helpful error when no token available', () => {
    process.env['NRDOCS_API_URL'] = 'https://env.com';

    expect(() => resolveCredentials({ configDir: tmpDir })).toThrow(
      /No operator token configured.*nrdocs auth login/
    );
  });

  it('resolves from named profile', () => {
    setProfile('staging', createProfile('https://staging.com', 'nrdocs_op_staging'), tmpDir);

    const creds = resolveCredentials({ profile: 'staging', configDir: tmpDir });

    expect(creds.api_url).toBe('https://staging.com');
    expect(creds.operator_token).toBe('nrdocs_op_staging');
  });

  it('flags override env which overrides config (mixed)', () => {
    setProfile('default', createProfile('https://config.com', 'nrdocs_op_config'), tmpDir);
    process.env['NRDOCS_OPERATOR_TOKEN'] = 'nrdocs_op_env';

    const creds = resolveCredentials({
      apiUrl: 'https://flag.com',
      configDir: tmpDir,
    });

    // apiUrl from flag, token from env (not config)
    expect(creds.api_url).toBe('https://flag.com');
    expect(creds.operator_token).toBe('nrdocs_op_env');
  });
});

describe('auth/status - token never printed', () => {
  let tmpDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
    consoleSpy.mockRestore();
  });

  it('status output never contains the full token', async () => {
    const token = 'nrdocs_op_supersecrettoken123456';
    setProfile('default', createProfile('https://api.test.com', token), tmpDir);

    // Import and call authStatus
    const { authStatus } = await import('../commands/auth/status.js');
    authStatus({ configDir: tmpDir });

    const allOutput = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOutput).not.toContain(token);
    expect(allOutput).toContain('nrdocs_op_...');
  });
});
