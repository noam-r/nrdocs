import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../api-client', () => ({
  setRepoPasswordWithPublishToken: vi.fn(),
  getRepoStatus: vi.fn(),
}));

vi.mock('../prompts', () => ({
  isInteractive: vi.fn(() => true),
  prompt: vi.fn((_message: string, defaultValue?: string) => defaultValue ?? ''),
  confirm: vi.fn(),
}));

vi.mock('../gh-integration', () => ({
  isGhInstalled: vi.fn(),
  isGhAuthenticated: vi.fn(),
  ghCheckActionsConfigWriteAccess: vi.fn(),
  buildManualGhCommands: vi.fn(() => 'manual secret commands'),
  SECRET_WARNING: 'secret warning',
}));

const TMP = join(process.cwd(), 'cli', 'src', '__test_init_tmp__');
const originalCwd = process.cwd();

describe('runInit', () => {
  beforeEach(async () => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(TMP, '.git'), { recursive: true });
    mkdirSync(join(TMP, 'docs'), { recursive: true });
    mkdirSync(join(TMP, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(TMP, 'docs', 'project.yml'), 'slug: existing\ntitle: Existing\n', 'utf8');
    writeFileSync(join(TMP, 'docs', 'nav.yml'), 'nav:\n  - label: Existing\n    path: existing\n', 'utf8');
    writeFileSync(join(TMP, '.github', 'workflows', 'publish-docs.yml'), 'name: Existing\n', 'utf8');
    process.chdir(TMP);
    process.exitCode = undefined;

    const api = await import('../api-client');
    vi.mocked(api.setRepoPasswordWithPublishToken).mockResolvedValue();
    vi.mocked(api.getRepoStatus).mockResolvedValue({
      repo_id: 'project-1',
      slug: 'docs',
      title: 'Docs',
      status: 'approved',
      access_mode: 'public',
      repo_identity: 'github.com/acme/docs',
      approved: true,
      published: false,
      active_publish_pointer: null,
      delivery_url: 'https://docs.example.com',
      url: 'https://docs.example.com/docs/',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const prompts = await import('../prompts');
    vi.mocked(prompts.confirm).mockResolvedValue(false);

    const gh = await import('../gh-integration');
    vi.mocked(gh.isGhInstalled).mockResolvedValue(false);
    vi.mocked(gh.isGhAuthenticated).mockResolvedValue(false);
    vi.mocked(gh.ghCheckActionsConfigWriteAccess).mockResolvedValue({ ok: true, repo: 'acme/docs' });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = undefined;
    rmSync(TMP, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  /** Minimal non-interactive args (no Control Plane project id — default owner flow). */
  const initBaseArgs = [
    '--api-url',
    'https://cp.example',
    '--repo-identity',
    'github.com/acme/docs',
    '--slug',
    'docs',
    '--title',
    'Docs',
    '--docs-dir',
    'docs',
    '--description',
    '',
    '--publish-branch',
    'main',
  ];

  const linkProjectArgs = ['--repo-id', 'project-1'] as const;

  it('stops when the user declines conflicting scaffolding', async () => {
    const { runInit } = await import('./init');
    const gh = await import('../gh-integration');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runInit([...initBaseArgs, ...linkProjectArgs]);

    const output = [
      ...log.mock.calls.map((c) => c.join(' ')),
      ...err.mock.calls.map((c) => c.join(' ')),
    ].join('\n');

    expect(process.exitCode).toBe(1);
    expect(output).toContain('Init cancelled. No local files or GitHub secrets were changed.');
    expect(output).toContain('Repo ID: project-1');
    expect(output).not.toContain('scaffolded successfully');
    expect(gh.isGhInstalled).toHaveBeenCalled();
    expect(readFileSync(join(TMP, 'docs', 'project.yml'), 'utf8')).toBe('slug: existing\ntitle: Existing\n');

    log.mockRestore();
    err.mockRestore();
  });

  it('prints the final docs URL after successful onboarding', async () => {
    rmSync(join(TMP, 'docs', 'project.yml'), { force: true });
    rmSync(join(TMP, 'docs', 'nav.yml'), { force: true });
    rmSync(join(TMP, '.github', 'workflows', 'publish-docs.yml'), { force: true });

    const prompts = await import('../prompts');
    vi.mocked(prompts.confirm).mockResolvedValue(true);

    const { runInit } = await import('./init');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runInit([...initBaseArgs, ...linkProjectArgs]);

    const output = [
      ...log.mock.calls.map((c) => c.join(' ')),
      ...err.mock.calls.map((c) => c.join(' ')),
    ].join('\n');

    expect(process.exitCode).toBeUndefined();
    expect(output).toContain('Docs URL:       https://docs.example.com/docs/');
    expect(output).toContain('5. Open: https://docs.example.com/docs/');

    log.mockRestore();
    err.mockRestore();
  });

  it('does not require gh Actions secret/variable permissions (OIDC default)', async () => {
    rmSync(join(TMP, 'docs', 'project.yml'), { force: true });
    rmSync(join(TMP, 'docs', 'nav.yml'), { force: true });
    rmSync(join(TMP, '.github', 'workflows', 'publish-docs.yml'), { force: true });

    const prompts = await import('../prompts');
    vi.mocked(prompts.confirm).mockResolvedValue(true);

    const gh = await import('../gh-integration');
    vi.mocked(gh.isGhInstalled).mockResolvedValue(true);
    vi.mocked(gh.isGhAuthenticated).mockResolvedValue(true);
    vi.mocked(gh.ghCheckActionsConfigWriteAccess).mockResolvedValue({
      ok: false,
      repo: 'acme/docs',
      secretApiError: 'HTTP 403',
      variableApiError: 'HTTP 403',
    });

    const { runInit } = await import('./init');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runInit([...initBaseArgs, ...linkProjectArgs]);

    const output = [
      ...log.mock.calls.map((c) => c.join(' ')),
      ...err.mock.calls.map((c) => c.join(' ')),
    ].join('\n');
    expect(process.exitCode).toBeUndefined();
    expect(output).not.toContain('GitHub Actions preflight failed');
    expect(output).not.toContain('secrets API check failed');
    expect(output).not.toContain('variables API check failed');

    err.mockRestore();
    log.mockRestore();
  });

  it('defaults publish branch to the current branch during interactive onboarding', async () => {
    rmSync(join(TMP, 'docs', 'project.yml'), { force: true });
    rmSync(join(TMP, 'docs', 'nav.yml'), { force: true });
    rmSync(join(TMP, '.github', 'workflows', 'publish-docs.yml'), { force: true });
    writeFileSync(join(TMP, '.git', 'HEAD'), 'ref: refs/heads/nrdocs\n', 'utf8');

    const prompts = await import('../prompts');
    vi.mocked(prompts.confirm).mockResolvedValue(true);

    const { runInit } = await import('./init');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runInit([
      '--api-url',
      'https://cp.example',
      '--repo-identity',
      'github.com/acme/docs',
      '--slug',
      'docs',
      '--title',
      'Docs',
      '--docs-dir',
      'docs',
      '--description',
      '',
    ]);

    const output = [
      ...log.mock.calls.map((c) => c.join(' ')),
      ...err.mock.calls.map((c) => c.join(' ')),
    ].join('\n');
    const metadata = JSON.parse(readFileSync(join(TMP, '.nrdocs', 'status.json'), 'utf8')) as Record<string, unknown>;

    expect(process.exitCode).toBeUndefined();
    expect(output).toContain('Publish branch is the Git branch whose pushes trigger publishing');
    expect(output).toContain('Publish branch: nrdocs');
    expect(metadata.publish_branch).toBe('nrdocs');
    expect(metadata).not.toHaveProperty('repo_id');

    log.mockRestore();
    err.mockRestore();
  });

  it('tokenless init can use global default api url and validates repo binding', async () => {
    rmSync(join(TMP, 'docs', 'project.yml'), { force: true });
    rmSync(join(TMP, 'docs', 'nav.yml'), { force: true });
    rmSync(join(TMP, '.github', 'workflows', 'publish-docs.yml'), { force: true });

    const globalDir = join(TMP, '__global_state__');
    process.env.NRDOCS_GLOBAL_STATE_DIR = globalDir;
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, 'config.json'), JSON.stringify({
      version: 1,
      default_api_url: 'https://cp.example',
    }), 'utf8');

    const prompts = await import('../prompts');
    vi.mocked(prompts.confirm).mockResolvedValue(true);

    const { runInit } = await import('./init');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runInit([
      '--repo-id',
      'project-1',
      '--repo-identity',
      'github.com/acme/docs',
      '--slug',
      'docs',
      '--title',
      'Docs',
      '--docs-dir',
      'docs',
      '--description',
      '',
      '--publish-branch',
      'main',
    ]);

    expect(process.exitCode).toBeUndefined();
    const output = [
      ...log.mock.calls.map((c) => c.join(' ')),
      ...err.mock.calls.map((c) => c.join(' ')),
    ].join('\n');
    expect(output).toContain('scaffolded successfully');

    log.mockRestore();
    err.mockRestore();
    delete process.env.NRDOCS_GLOBAL_STATE_DIR;
  });
});

describe('inferRepoIdentity', () => {
  it('normalizes GitHub HTTPS remotes', async () => {
    const { inferRepoIdentity } = await import('./init');
    expect(inferRepoIdentity('https://github.com/noam-r/reflexio.git')).toBe('github.com/noam-r/reflexio');
  });

  it('normalizes GitHub SSH remotes', async () => {
    const { inferRepoIdentity } = await import('./init');
    expect(inferRepoIdentity('git@github.com:noam-r/reflexio.git')).toBe('github.com/noam-r/reflexio');
  });

  it('normalizes local SSH host aliases to GitHub repo identity', async () => {
    const { inferRepoIdentity } = await import('./init');
    expect(inferRepoIdentity('git@noam-r:noam-r/reflexio.git')).toBe('github.com/noam-r/reflexio');
  });
});

describe('inferPublishBranchDefault', () => {
  it('uses the explicit flag when provided', async () => {
    const { inferPublishBranchDefault } = await import('./init');
    expect(inferPublishBranchDefault('docs')).toBe('docs');
  });
});
