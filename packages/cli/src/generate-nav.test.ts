import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExitCode, createProcessRuntime, main, type Runtime } from './index.js';

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    io: {
      writeStdout: (t: string) => {
        stdout += t;
      },
      writeStderr: (t: string) => {
        stderr += t;
      },
    },
  };
}

async function withTemp(
  fn: (runtime: Runtime, cap: ReturnType<typeof captureIo>, docs: string) => Promise<void>,
) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-cli-'));
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-cwd-'));
  const docs = path.join(cwd, 'docs');
  await fs.mkdir(docs);
  const cap = captureIo();
  const runtime = createProcessRuntime({
    homeDir: home,
    cwd,
    platform: 'linux',
    stdoutIsTTY: false,
    stderrIsTTY: false,
    stdinIsTTY: false,
    env: { HOME: home },
    io: cap.io,
  });
  try {
    await fn(runtime, cap, docs);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

describe('generate nav', () => {
  it('creates nrdocs.yml with --title', async () => {
    await withTemp(async (runtime, cap, docs) => {
      await fs.writeFile(path.join(docs, 'index.md'), '# Home\n');
      await fs.writeFile(path.join(docs, '01-intro.md'), '# Introduction\n');
      const code = await main(['generate', 'nav', 'docs', '--title', 'Product Handbook'], {
        runtime,
      });
      expect(code).toBe(ExitCode.Success);
      const yml = await fs.readFile(path.join(docs, 'nrdocs.yml'), 'utf8');
      expect(yml).toContain('title: Product Handbook');
      expect(yml).toContain('file: index.md');
      expect(yml).toContain('file: 01-intro.md');
      expect(yml).not.toContain('publish:');
      expect(cap.stdout).toContain('Created');
    });
  });

  it('refuses to overwrite explicit navigation without --force', async () => {
    await withTemp(async (runtime, cap, docs) => {
      await fs.writeFile(path.join(docs, 'index.md'), '# Home\n');
      await fs.writeFile(
        path.join(docs, 'nrdocs.yml'),
        'title: Site\nnavigation:\n  - title: Home\n    file: index.md\n',
      );
      expect(await main(['generate', 'nav', 'docs'], { runtime })).toBe(ExitCode.LocalValidation);
      expect(cap.stderr).toMatch(/--force/);
      expect(await main(['generate', 'nav', 'docs', '--force'], { runtime })).toBe(
        ExitCode.Success,
      );
    });
  });

  it('supports --dry-run without writing', async () => {
    await withTemp(async (runtime, cap, docs) => {
      await fs.writeFile(path.join(docs, 'index.md'), '# Home\n');
      expect(
        await main(['generate', 'nav', 'docs', '--title', 'X', '--dry-run'], { runtime }),
      ).toBe(ExitCode.Success);
      await expect(fs.readFile(path.join(docs, 'nrdocs.yml'), 'utf8')).rejects.toThrow();
      expect(cap.stdout).toMatch(/dry run/);
    });
  });

  it('preserves publish and replaces navigation: auto', async () => {
    await withTemp(async (runtime, _cap, docs) => {
      await fs.writeFile(path.join(docs, 'index.md'), '# Home\n');
      await fs.writeFile(
        path.join(docs, 'nrdocs.yml'),
        'publish:\n  credential: site_01ARZ3NDEKTSV4RRFFQ69G5FAV\ntitle: Site\nlanguage: en\ndirection: ltr\nnavigation: auto\n',
      );
      expect(await main(['generate', 'nav', 'docs'], { runtime })).toBe(ExitCode.Success);
      const yml = await fs.readFile(path.join(docs, 'nrdocs.yml'), 'utf8');
      expect(yml).toContain('credential: site_01ARZ3NDEKTSV4RRFFQ69G5FAV');
      expect(yml).toContain('language: en');
      expect(yml).toContain('direction: ltr');
      expect(yml).toContain('file: index.md');
      expect(yml).not.toContain('navigation: auto');
    });
  });
});
