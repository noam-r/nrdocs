import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProcessRuntime } from '../runtime.js';
import {
  parseCloudflareEnvText,
  readCloudflareEnvFile,
  resolveCloudflareAccountId,
  resolveCloudflareCredential,
} from './auth.js';

describe('cloudflare env file', () => {
  it('parses KEY=VALUE lines and ignores comments', () => {
    const parsed = parseCloudflareEnvText(`
# comment
CLOUDFLARE_API_TOKEN=tok_abc
export CLOUDFLARE_ACCOUNT_ID="acct123"
`);
    expect(parsed.apiToken).toBe('tok_abc');
    expect(parsed.accountId).toBe('acct123');
  });

  it('reads a mode-0600 ~/.nrdocs/cloudflare.env for token and account', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-cf-env-'));
    try {
      const dir = path.join(home, '.nrdocs');
      await fs.mkdir(dir, { mode: 0o700 });
      const file = path.join(dir, 'cloudflare.env');
      await fs.writeFile(
        file,
        'CLOUDFLARE_API_TOKEN=from_file\nCLOUDFLARE_ACCOUNT_ID=acct_from_file\n',
        { mode: 0o600 },
      );
      const runtime = createProcessRuntime({
        homeDir: home,
        env: { HOME: home, CLOUDFLARE_API_TOKEN: undefined, CLOUDFLARE_ACCOUNT_ID: undefined },
      });
      const loaded = await readCloudflareEnvFile(runtime);
      expect(loaded?.apiToken).toBe('from_file');
      expect(loaded?.accountId).toBe('acct_from_file');
      expect(await resolveCloudflareAccountId(runtime)).toBe('acct_from_file');

      const cred = await resolveCloudflareCredential(
        runtime,
        async () => ({ code: 1, stdout: '', stderr: 'no' }),
        home,
      );
      expect(cred).toEqual({ source: 'env_file', token: 'from_file' });
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it('prefers process env over the env file', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-cf-env-'));
    try {
      const dir = path.join(home, '.nrdocs');
      await fs.mkdir(dir, { mode: 0o700 });
      await fs.writeFile(path.join(dir, 'cloudflare.env'), 'CLOUDFLARE_API_TOKEN=from_file\n', {
        mode: 0o600,
      });
      const runtime = createProcessRuntime({
        homeDir: home,
        env: { HOME: home, CLOUDFLARE_API_TOKEN: 'from_env' },
      });
      const cred = await resolveCloudflareCredential(
        runtime,
        async () => ({ code: 1, stdout: '', stderr: 'no' }),
        home,
      );
      expect(cred).toEqual({ source: 'api_token', token: 'from_env' });
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it('rejects world-readable cloudflare.env', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-cf-env-'));
    try {
      const dir = path.join(home, '.nrdocs');
      await fs.mkdir(dir, { mode: 0o700 });
      const file = path.join(dir, 'cloudflare.env');
      await fs.writeFile(file, 'CLOUDFLARE_API_TOKEN=x\n', { mode: 0o644 });
      const runtime = createProcessRuntime({ homeDir: home, env: { HOME: home } });
      await expect(readCloudflareEnvFile(runtime)).rejects.toThrow(/0600/);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});
