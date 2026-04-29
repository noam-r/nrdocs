import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../api-client', () => ({
  bootstrapValidate: vi.fn(),
  bootstrapOnboard: vi.fn(),
  setProjectPasswordWithPublishToken: vi.fn(),
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

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function bootstrapToken(): string {
  return [
    base64url({ alg: 'HS256', typ: 'JWT' }),
    base64url({
      v: 1,
      typ: 'org_bootstrap',
      iss: 'https://cp.example',
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'bootstrap-1',
    }),
    'signature',
  ].join('.');
}

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
    vi.mocked(api.bootstrapValidate).mockResolvedValue({
      org_name: 'Acme',
      org_slug: 'acme',
      remaining_quota: 1,
      expires_at: '2026-01-01T00:00:00.000Z',
      delivery_url: 'https://docs.example.com',
    });
    vi.mocked(api.bootstrapOnboard).mockResolvedValue({
      project_id: 'project-1',
      repo_publish_token: 'repo-publish-token',
      delivery_url: 'https://docs.example.com',
    });
    vi.mocked(api.setProjectPasswordWithPublishToken).mockResolvedValue();

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

  it('stops when the user declines conflicting scaffolding', async () => {
    const { runInit } = await import('./init');
    const gh = await import('../gh-integration');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runInit([
      '--token', bootstrapToken(),
      '--repo-identity', 'github.com/acme/docs',
      '--slug', 'docs',
      '--title', 'Docs',
      '--docs-dir', 'docs',
      '--description', '',
      '--publish-branch', 'main',
    ]);

    const output = [
      ...log.mock.calls.map((c) => c.join(' ')),
      ...err.mock.calls.map((c) => c.join(' ')),
    ].join('\n');

    expect(process.exitCode).toBe(1);
    expect(output).toContain('Init cancelled. No local files or GitHub secrets were changed.');
    expect(output).toContain('Project ID: project-1');
    expect(output).not.toContain('Project onboarded successfully');
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

    await runInit([
      '--token', bootstrapToken(),
      '--repo-identity', 'github.com/acme/docs',
      '--slug', 'docs',
      '--title', 'Docs',
      '--docs-dir', 'docs',
      '--description', '',
      '--publish-branch', 'main',
    ]);

    const output = [
      ...log.mock.calls.map((c) => c.join(' ')),
      ...err.mock.calls.map((c) => c.join(' ')),
    ].join('\n');

    expect(process.exitCode).toBeUndefined();
    expect(output).toContain('Docs URL:       https://docs.example.com/acme/docs/');
    expect(output).toContain('After the workflow succeeds, visit: https://docs.example.com/acme/docs/');

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

    await runInit([
      '--token', bootstrapToken(),
      '--repo-identity', 'github.com/acme/docs',
      '--slug', 'docs',
      '--title', 'Docs',
      '--docs-dir', 'docs',
      '--description', '',
      '--publish-branch', 'main',
    ]);

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
      '--token', bootstrapToken(),
      '--repo-identity', 'github.com/acme/docs',
      '--slug', 'docs',
      '--title', 'Docs',
      '--docs-dir', 'docs',
      '--description', '',
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

    log.mockRestore();
    err.mockRestore();
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
