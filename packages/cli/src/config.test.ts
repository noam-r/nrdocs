import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProcessRuntime } from './runtime.js';
import { resolveGenerateNavDirectory } from './config.js';

describe('resolveGenerateNavDirectory', () => {
  it('uses the only child directory that contains nrdocs.yml when cwd has none', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-resnav-'));
    const cwd = path.join(home, 'repo');
    const docs = path.join(cwd, 'docs');
    await fs.mkdir(docs, { recursive: true });
    await fs.writeFile(path.join(docs, 'nrdocs.yml'), 'title: Site\nnavigation: auto\n');
    await fs.writeFile(path.join(docs, 'index.md'), '# Home\n');

    const runtime = createProcessRuntime({
      homeDir: home,
      cwd,
      platform: 'linux',
      stdoutIsTTY: false,
      stderrIsTTY: false,
      stdinIsTTY: false,
      env: { HOME: home },
    });

    await expect(resolveGenerateNavDirectory(runtime, undefined)).resolves.toBe(docs);
    await fs.rm(home, { recursive: true, force: true });
  });
});
