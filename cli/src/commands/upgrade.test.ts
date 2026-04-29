import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runUpgrade } from './upgrade';

describe('runUpgrade', () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nrdocs-upgrade-'));
    process.chdir(tempDir);
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.exitCode = undefined;
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('refreshes workflow from status metadata without a bootstrap token', async () => {
    mkdirSync(join(tempDir, 'docs'), { recursive: true });
    mkdirSync(join(tempDir, '.nrdocs'), { recursive: true });
    writeFileSync(join(tempDir, 'docs', 'project.yml'), [
      'slug: demo',
      'title: Demo',
      'description: Demo docs',
      'publish_enabled: true',
      'access_mode: public',
      '',
    ].join('\n'));
    writeFileSync(join(tempDir, '.nrdocs', 'status.json'), JSON.stringify({
      api_url: 'https://cp.example',
      docs_dir: 'docs',
      publish_branch: 'nrdocs',
      repo_identity: 'github.com/acme/demo',
    }));

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runUpgrade([]);

    const workflow = readFileSync(join(tempDir, '.github', 'workflows', 'publish-docs.yml'), 'utf8');
    expect(workflow).toContain('NRDOCS_API_URL: https://cp.example');
    expect(workflow).toContain('- nrdocs');
    expect(workflow).not.toContain('vars.NRDOCS_API_URL');
    expect(log.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('nrdocs upgrade complete');
  });
});

