import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { confirm } from '../prompts';
import { runPassword } from './password';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

vi.mock('../prompts', () => ({
  confirm: vi.fn(),
}));

describe('runPassword', () => {
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  function setupRepoMetadata(): string {
    const root = mkdtempSync(join(tmpdir(), 'nrdocs-password-'));
    process.chdir(root);
    mkdirSync('.nrdocs', { recursive: true });
    writeFileSync(
      join('.nrdocs', 'status.json'),
      JSON.stringify({
        repo_identity: 'github.com/acme/docs',
        publish_branch: 'nrdocs',
        api_url: 'https://control.example.com',
        repo_id: 'proj-1',
      }),
      'utf-8',
    );
    return root;
  }

  it('rejects unknown option', async () => {
    await runPassword(['set', '--bad-flag']);
    expect(process.exitCode).toBe(1);
  });

  it('accepts repo id from NRDOCS_REPO_ID when omitted from status.json', async () => {
    process.chdir(mkdtempSync(join(tmpdir(), 'nrdocs-password-')));
    mkdirSync('.nrdocs', { recursive: true });
    writeFileSync(
      join('.nrdocs', 'status.json'),
      JSON.stringify({
        repo_identity: 'github.com/acme/docs',
        publish_branch: 'nrdocs',
        api_url: 'https://control.example.com',
      }),
      'utf-8',
    );
    process.env.NRDOCS_REPO_ID = 'from-env-id';
    process.env.NRDOCS_NEW_PASSWORD = 'pw';

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify({
          challenge_id: 'ch-env',
          public_token: 'pub',
          private_token: 'priv',
          verify_file_path: '.nrdocs/challenges/ch-env.json',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      } as Response);

    await runPassword(['set', '--no-auto-push']);

    expect(globalThis.fetch).toHaveBeenCalled();
    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(body.repo_id).toBe('from-env-id');
    delete process.env.NRDOCS_REPO_ID;
    delete process.env.NRDOCS_NEW_PASSWORD;
  });

  it('default auto-push allows untracked files and exits cleanly on refusal', async () => {
    setupRepoMetadata();
    vi.mocked(confirm).mockResolvedValue(false);
    vi.mocked(spawnSync).mockImplementation((_cmd, args: string[]) => {
      const key = args.join(' ');
      if (key === 'rev-parse --is-inside-work-tree') return { status: 0, stdout: 'true\n', stderr: '' } as never;
      if (key === 'branch --show-current') return { status: 0, stdout: 'main\n', stderr: '' } as never;
      if (key === 'status --porcelain') return { status: 0, stdout: '?? .nrdocs/challenges/\n', stderr: '' } as never;
      if (key === 'rev-parse --abbrev-ref --symbolic-full-name @{u}') return { status: 0, stdout: 'origin/main\n', stderr: '' } as never;
      if (key === 'rev-list --count @{u}..HEAD') return { status: 0, stdout: '0\n', stderr: '' } as never;
      return { status: 1, stdout: '', stderr: `unexpected git call: ${key}` } as never;
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({
        challenge_id: 'ch-1',
        public_token: 'pub',
        private_token: 'priv',
        verify_file_path: '.nrdocs/challenges/ch-1.json',
      }),
    } as Response);

    await runPassword(['set']);

    expect(confirm).toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalledWith('git', ['push'], expect.anything());
    expect(process.exitCode).toBeUndefined();
  });

  it('--no-auto-push skips git preflight and can continue to consume', async () => {
    setupRepoMetadata();
    process.env.NRDOCS_NEW_PASSWORD = 'test-password';
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify({
          challenge_id: 'ch-2',
          public_token: 'pub',
          private_token: 'priv',
          verify_file_path: '.nrdocs/challenges/ch-2.json',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      } as Response);

    await runPassword(['set', '--no-auto-push']);

    expect(spawnSync).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    delete process.env.NRDOCS_NEW_PASSWORD;
  });
});

