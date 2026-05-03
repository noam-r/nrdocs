import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runStatus } from './status';

describe('runStatus', () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nrdocs-status-'));
    process.chdir(tempDir);
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('prints local status and remote publish details', async () => {
    mkdirSync(join(tempDir, 'docs'), { recursive: true });
    mkdirSync(join(tempDir, '.github', 'workflows'), { recursive: true });
    mkdirSync(join(tempDir, '.nrdocs'), { recursive: true });
    writeFileSync(join(tempDir, 'docs', 'project.yml'), [
      'slug: demo',
      'title: Demo Docs',
      'description: Test docs',
      'publish_enabled: true',
      'access_mode: public',
      '',
    ].join('\n'));
    writeFileSync(join(tempDir, '.github', 'workflows', 'publish-docs.yml'), 'name: Publish\n');
    writeFileSync(join(tempDir, '.nrdocs', 'status.json'), JSON.stringify({
      repo_id: 'proj-1',
      api_url: 'https://cp.example',
      publish_branch: 'docs',
      docs_dir: 'docs',
    }));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      repo_id: 'proj-1',
      slug: 'demo',
      title: 'Demo Docs',
      status: 'approved',
      access_mode: 'public',
      approved: true,
      published: true,
      active_publish_pointer: 'publishes/demo/pub-1/',
      delivery_url: 'https://docs.example',
      url: 'https://docs.example/demo/',
      updated_at: '2026-04-27T00:00:00.000Z',
    }), { status: 200 })));

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runStatus([]);

    const out = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(out).toContain('Initialized:    yes');
    expect(out).toContain('API URL:        https://cp.example');
    expect(out).toContain('Publish branch: docs');
    expect(out).toContain('Remote:         ok (repo exists on control plane)');
    expect(out).toContain('Lifecycle:      approved');
    expect(out).toContain('Published:      yes');
    expect(out).toContain('Docs URL:       https://docs.example/demo/');
  }, 20000);

  it('explains unknown remote status when repo metadata is missing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runStatus([]);

    const out = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(out).toContain('Initialized:    no');
    expect(out).toContain('Repo ID:        not linked');
    expect(out).toContain('nrdocs init');
  }, 20000);

  it('shows reader URL pattern when initialized but repo id not linked', async () => {
    mkdirSync(join(tempDir, 'docs'), { recursive: true });
    mkdirSync(join(tempDir, '.nrdocs'), { recursive: true });
    writeFileSync(join(tempDir, 'docs', 'project.yml'), [
      'slug: my-site',
      'title: My Site',
      'description: x',
      'publish_enabled: true',
      'access_mode: public',
      '',
    ].join('\n'));
    writeFileSync(join(tempDir, '.nrdocs', 'status.json'), JSON.stringify({
      api_url: 'https://cp.example',
      docs_dir: 'docs',
    }));

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runStatus([]);

    const out = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(out).toContain('Reader URL:');
    expect(out).toContain('my-site');
  }, 20000);

  it('prints API URL and hint when control plane returns repo 404', async () => {
    mkdirSync(join(tempDir, 'docs'), { recursive: true });
    mkdirSync(join(tempDir, '.nrdocs'), { recursive: true });
    writeFileSync(join(tempDir, 'docs', 'project.yml'), [
      'slug: demo',
      'title: Demo',
      'publish_enabled: true',
      'access_mode: public',
      '',
    ].join('\n'));
    writeFileSync(join(tempDir, '.nrdocs', 'status.json'), JSON.stringify({
      repo_id: 'deadbeef-dead-dead-dead-deadbeefdead',
      api_url: 'https://cp.example',
      docs_dir: 'docs',
    }));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Repo not found' }), { status: 404 })),
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runStatus([]);

    const out = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(out).toContain('API URL:        https://cp.example');
    expect(out).toContain('Repo not found');
    expect(out).toContain('What this means:');
    expect(out).toContain('What to do:');
    expect(out).toContain('nrdocs admin list --all');
  }, 20000);
});
