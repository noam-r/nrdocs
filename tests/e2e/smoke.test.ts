import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExitCode, createProcessRuntime, main } from '../../packages/cli/src/index.js';
import { createRejectingTerminal } from '../../packages/cli/src/terminal.js';

/**
 * Local deterministic e2e smoke (no Cloudflare account).
 * Disposable Cloudflare journeys are opt-in via test:e2e:cloudflare.
 */
describe('local e2e smoke', () => {
  it('starts the packed-style CLI entrypoints for help and windows rejection', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-e2e-'));
    try {
      const runtime = createProcessRuntime({
        homeDir: home,
        cwd: home,
        platform: 'linux',
        stdoutIsTTY: false,
        stderrIsTTY: false,
        stdinIsTTY: false,
        env: { HOME: home },
        io: {
          writeStdout: () => {},
          writeStderr: () => {},
        },
      });
      const code = await main(['--help'], {
        runtime,
        terminal: createRejectingTerminal(),
      });
      expect(code).toBe(ExitCode.Success);

      const winRuntime = createProcessRuntime({
        homeDir: home,
        cwd: home,
        platform: 'win32',
        stdoutIsTTY: false,
        stderrIsTTY: false,
        stdinIsTTY: false,
        env: { HOME: home },
        io: {
          writeStdout: () => {},
          writeStderr: () => {},
        },
      });
      const winCode = await main(['--version'], {
        runtime: winRuntime,
        terminal: createRejectingTerminal(),
      });
      expect(winCode).not.toBe(ExitCode.Success);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it('rejects generate/publish without a directory config using real FS temp roots', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-e2e-home-'));
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-e2e-cwd-'));
    try {
      let stderr = '';
      const runtime = createProcessRuntime({
        homeDir: home,
        cwd,
        platform: 'linux',
        stdoutIsTTY: false,
        stderrIsTTY: false,
        stdinIsTTY: false,
        env: { HOME: home },
        io: {
          writeStdout: () => {},
          writeStderr: (t) => {
            stderr += t;
          },
        },
      });
      const code = await main(['publish'], {
        runtime,
        terminal: createRejectingTerminal(),
      });
      expect(code).not.toBe(ExitCode.Success);
      expect(stderr.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
