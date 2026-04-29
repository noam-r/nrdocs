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
      project_id: 'proj-1',
      api_url: 'https://cp.example',
      publish_branch: 'docs',
      docs_dir: 'docs',
    }));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      project_id: 'proj-1',
      slug: 'demo',
      title: 'Demo Docs',
      org_slug: 'default',
      status: 'approved',
      access_mode: 'public',
      approved: true,
      published: true,
      active_publish_pointer: 'publishes/default/demo/pub-1/',
      delivery_url: 'https://docs.example',
      url: 'https://docs.example/demo/',
      updated_at: '2026-04-27T00:00:00.000Z',
    }), { status: 200 })));

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runStatus([]);

    const out = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(out).toContain('Initialized:    yes');
    expect(out).toContain('Publish branch: docs');
    expect(out).toContain('Status:         approved');
    expect(out).toContain('Published:      yes');
    expect(out).toContain('Docs URL:       https://docs.example/demo/');
  }, 20000);

  it('explains unknown remote status when project metadata is missing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runStatus([]);

    const out = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(out).toContain('Initialized:    no');
    expect(out).toContain('Project ID:     unavailable');
    expect(out).toContain('run nrdocs init');
  }, 20000);
});
