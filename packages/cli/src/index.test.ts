import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CLI_PACKAGE,
  CLI_VERSION,
  ExitCode,
  REMOVED_1X_COMMANDS,
  cliDependencies,
  createProcessRuntime,
  loadNrdocsConfig,
  main,
  modeBits,
  readEnvCredentialPair,
  resolvePublicationDirectory,
  writeInstanceDescriptor,
  writePublisherCredential,
  writeActiveInstanceId,
  atomicWriteFile,
  confirmOrDecline,
  createRejectingTerminal,
  type Runtime,
} from './index.js';
import type { InstanceDescriptor, SiteId } from '@nrdocs/contracts';

const SITE_ID = 'site_01ARZ3NDEKTSV4RRFFQ69G5FAV' as SiteId;
const INST_A = 'inst_01ARZ3NDEKTSV4RRFFQ69G5FAV' as const;
const INST_B = 'inst_01BX5ZZKBKACTAV9WEVGEMMVRZ' as const;
const TOKEN = 'nrd_pub_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrs'.slice(0, 43);

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

async function withTempHome(
  fn: (home: string, runtime: Runtime, cap: ReturnType<typeof captureIo>) => Promise<void>,
  opts: {
    tty?: boolean;
    env?: Record<string, string | undefined>;
    platform?: NodeJS.Platform;
  } = {},
) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-cli-'));
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-cwd-'));
  const cap = captureIo();
  const runtime = createProcessRuntime({
    homeDir: home,
    cwd,
    platform: opts.platform ?? 'linux',
    stdoutIsTTY: opts.tty ?? false,
    stderrIsTTY: opts.tty ?? false,
    stdinIsTTY: opts.tty ?? false,
    env: { HOME: home, ...opts.env },
    io: cap.io,
  });
  try {
    await fn(home, runtime, cap);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

function descriptor(id: string, name: string): InstanceDescriptor {
  return {
    instance_id: id as InstanceDescriptor['instance_id'],
    display_name: name,
    canonical_origin: 'https://docs.example.com',
    custom_hostname: null,
    account_id: 'acct',
    resource_suffix: '3f6m8p0q2r4s6t8v0w2x',
    database_id: 'db',
    bucket_name: 'bucket',
    worker_name: 'worker',
    status: 'active',
    deployed_version: '2.0.0',
    reconciliation: null,
  };
}

describe('nrdocs cli package', () => {
  it('is the only public package identity', () => {
    expect(CLI_PACKAGE).toBe('nrdocs');
    expect(CLI_VERSION).toBe('2.0.0');
    expect(cliDependencies().contracts).toBe('@nrdocs/contracts');
  });

  it('prints version', async () => {
    await withTempHome(async (_h, runtime, cap) => {
      expect(await main(['--version'], { runtime })).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('nrdocs 2.0.0');
    });
  });
});

describe('help and removed 1.x commands', () => {
  it('shows the 2.0 command tree and omits removed commands', async () => {
    await withTempHome(async (_h, runtime, cap) => {
      expect(await main(['--help'], { runtime })).toBe(ExitCode.Success);
      expect(cap.stdout).toContain('nrdocs connect');
      expect(cap.stdout).toContain('nrdocs generate nav');
      expect(cap.stdout).toContain('nrdocs credentials list');
      expect(cap.stdout).toContain('nrdocs instance use');
      for (const removed of REMOVED_1X_COMMANDS) {
        expect(cap.stdout.includes(removed)).toBe(false);
      }
      expect(cap.stdout).not.toContain('nav generate');
    });
  });

  it('rejects removed top-level commands', async () => {
    await withTempHome(async (_h, runtime) => {
      expect(await main(['init'], { runtime })).toBe(ExitCode.Usage);
      expect(await main(['repos'], { runtime })).toBe(ExitCode.Usage);
      expect(await main(['doctor'], { runtime })).toBe(ExitCode.Usage);
    });
  });
});

describe('platform', () => {
  it('fails on Windows at startup', async () => {
    await withTempHome(
      async (_h, runtime, cap) => {
        expect(await main(['--version'], { runtime })).toBe(ExitCode.LocalIoOrState);
        expect(cap.stderr).toMatch(/Windows/i);
      },
      { platform: 'win32' },
    );
  });
});

describe('directory and config', () => {
  it('resolves explicit directory and cwd without ancestor search', async () => {
    await withTempHome(async (_home, runtime) => {
      const nested = path.join(runtime.cwd, 'docs');
      await fs.mkdir(nested);
      await fs.writeFile(path.join(nested, 'nrdocs.yml'), 'title: Nested\nnavigation: auto\n');
      await fs.writeFile(path.join(runtime.cwd, 'nrdocs.yml'), 'title: Parent\nnavigation: auto\n');

      const root = await resolvePublicationDirectory(runtime, 'docs');
      expect(root).toBe(path.resolve(runtime.cwd, 'docs'));
      const loaded = await loadNrdocsConfig(runtime, root);
      expect(loaded.config.title).toBe('Nested');

      // cwd without nrdocs.yml does not walk up
      const empty = path.join(runtime.cwd, 'empty');
      await fs.mkdir(empty);
      const emptyRuntime = createProcessRuntime({
        ...runtime,
        cwd: empty,
        homeDir: runtime.homeDir,
        io: runtime.io,
      });
      await expect(loadNrdocsConfig(emptyRuntime, empty)).rejects.toThrow(
        /nrdocs\.yml was not found/,
      );
    });
  });

  it('rejects symbolic-link publication root and nrdocs.yml', async () => {
    await withTempHome(async (_home, runtime) => {
      const realDir = path.join(runtime.cwd, 'real');
      await fs.mkdir(realDir);
      await fs.writeFile(path.join(realDir, 'nrdocs.yml'), 'title: X\nnavigation: auto\n');
      const linkDir = path.join(runtime.cwd, 'link');
      await fs.symlink(realDir, linkDir);
      await expect(resolvePublicationDirectory(runtime, 'link')).rejects.toThrow(/symbolic link/);

      const docs = path.join(runtime.cwd, 'docs');
      await fs.mkdir(docs);
      const realCfg = path.join(runtime.cwd, 'real.yml');
      await fs.writeFile(realCfg, 'title: X\nnavigation: auto\n');
      await fs.symlink(realCfg, path.join(docs, 'nrdocs.yml'));
      await expect(loadNrdocsConfig(runtime, docs)).rejects.toThrow(/symbolic-link/);
    });
  });

  it('rejects unknown nrdocs.yml fields', async () => {
    await withTempHome(async (_home, runtime) => {
      const docs = path.join(runtime.cwd, 'docs');
      await fs.mkdir(docs);
      await fs.writeFile(
        path.join(docs, 'nrdocs.yml'),
        'title: X\nnavigation: auto\ntheme: dark\n',
      );
      await expect(loadNrdocsConfig(runtime, docs)).rejects.toThrow(/unknown/);
    });
  });
});

describe('credentials store', () => {
  it('enforces 0700/0600, atomic write, and symlink refusal', async () => {
    await withTempHome(async (home, runtime) => {
      const filePath = await writePublisherCredential(runtime, SITE_ID, {
        server: 'https://docs.example.com',
        token: TOKEN,
      });
      expect(filePath).toBe(path.join(home, '.nrdocs', 'sites', `${SITE_ID}.json`));
      const st = await fs.lstat(filePath);
      expect(modeBits(st.mode)).toBe(0o600);
      const dir = await fs.lstat(path.join(home, '.nrdocs', 'sites'));
      expect(modeBits(dir.mode)).toBe(0o700);

      const code = await main(['credentials', 'list', '--json'], { runtime });
      expect(code).toBe(ExitCode.Success);

      // symlink target refused
      const other = path.join(home, 'other.json');
      await fs.writeFile(other, '{"server":"https://docs.example.com","token":"' + TOKEN + '"}', {
        mode: 0o600,
      });
      await fs.rm(filePath);
      await fs.symlink(other, filePath);
      const cap = captureIo();
      const rt2 = createProcessRuntime({
        homeDir: home,
        cwd: runtime.cwd,
        env: { HOME: home },
        io: cap.io,
        stdoutIsTTY: false,
        stdinIsTTY: false,
        stderrIsTTY: false,
      });
      expect(await main(['credentials', 'list'], { runtime: rt2 })).toBe(ExitCode.LocalIoOrState);
      expect(cap.stderr).toMatch(/symbolic-link/);
      expect(cap.stdout + cap.stderr).not.toContain(TOKEN);
    });
  });

  it('lists and removes local credentials without printing tokens', async () => {
    await withTempHome(async (_home, runtime, cap) => {
      await writePublisherCredential(runtime, SITE_ID, {
        server: 'https://docs.example.com',
        token: TOKEN,
      });
      expect(await main(['credentials', 'list'], { runtime })).toBe(ExitCode.Success);
      expect(cap.stdout).toContain(SITE_ID);
      expect(cap.stdout).toContain('https://docs.example.com');
      expect(cap.stdout).not.toContain(TOKEN);

      expect(await main(['credentials', 'remove', SITE_ID], { runtime })).toBe(ExitCode.Success);
      expect(cap.stdout).toMatch(/did not revoke/);
      expect(await main(['credentials', 'list'], { runtime })).toBe(ExitCode.Success);
      expect(cap.stdout).toMatch(/No local publisher credentials/);
    });
  });

  it('requires a complete environment credential pair', async () => {
    await withTempHome(
      async (_h, runtime) => {
        expect(() => readEnvCredentialPair(runtime)).toThrow(/both be set/);
      },
      { env: { NRDOCS_URL: 'https://docs.example.com' } },
    );
    await withTempHome(
      async (_h, runtime) => {
        const pair = readEnvCredentialPair(runtime);
        expect(pair?.server).toBe('https://docs.example.com');
        expect(pair?.token).toBe(TOKEN);
      },
      { env: { NRDOCS_URL: 'https://docs.example.com', NRDOCS_TOKEN: TOKEN } },
    );
  });
});

describe('instance store', () => {
  it('lists, shows, and uses instances with opaque IDs only', async () => {
    await withTempHome(async (_home, runtime, cap) => {
      await writeInstanceDescriptor(runtime, descriptor(INST_A, 'company-docs'));
      await writeInstanceDescriptor(runtime, descriptor(INST_B, 'other-docs'));

      expect(await main(['instance', 'list', '--json'], { runtime })).toBe(ExitCode.Success);
      expect(cap.stdout).toContain(INST_A);
      expect(cap.stdout).toContain('company-docs');

      // use requires TTY
      expect(await main(['instance', 'use', INST_A], { runtime })).toBe(ExitCode.Usage);

      const ttyCap = captureIo();
      const ttyRuntime = createProcessRuntime({
        homeDir: runtime.homeDir,
        cwd: runtime.cwd,
        env: { HOME: runtime.homeDir },
        io: ttyCap.io,
        stdoutIsTTY: true,
        stdinIsTTY: true,
        stderrIsTTY: true,
      });
      expect(await main(['instance', 'use', INST_A], { runtime: ttyRuntime })).toBe(
        ExitCode.Success,
      );
      expect(ttyCap.stdout).toContain(INST_A);

      expect(await main(['instance', 'show', '--json'], { runtime: ttyRuntime })).toBe(
        ExitCode.Success,
      );
      expect(ttyCap.stdout).toContain('"active": true');

      // display name is not a targeting key
      expect(await main(['instance', 'use', 'company-docs'], { runtime: ttyRuntime })).toBe(
        ExitCode.Usage,
      );
    });
  });

  it('keeps publisher and admin destinations separate', async () => {
    await withTempHome(async (_home, runtime) => {
      await writeInstanceDescriptor(runtime, descriptor(INST_A, 'company-docs'));
      const ttyRuntime = createProcessRuntime({
        homeDir: runtime.homeDir,
        cwd: runtime.cwd,
        env: { HOME: runtime.homeDir },
        io: runtime.io,
        stdoutIsTTY: true,
        stdinIsTTY: true,
        stderrIsTTY: true,
      });
      await writeActiveInstanceId(ttyRuntime, INST_A as InstanceDescriptor['instance_id']);
      await writePublisherCredential(runtime, SITE_ID, {
        server: 'https://docs.example.com',
        token: TOKEN,
      });
      // active instance must not be required for credentials list
      expect(await main(['credentials', 'list'], { runtime })).toBe(ExitCode.Success);
      // --instance invalid on publisher commands
      expect(await main(['credentials', 'list', '--instance', INST_A], { runtime })).toBe(
        ExitCode.Usage,
      );
    });
  });
});

describe('admin interactive gate and confirmations', () => {
  it('rejects admin mutations without a TTY before side effects', async () => {
    await withTempHome(async (_home, runtime, cap) => {
      expect(await main(['site', 'create', 'x'], { runtime })).toBe(ExitCode.Usage);
      expect(cap.stderr).toMatch(/interactive terminal/i);
      expect(await main(['deploy'], { runtime })).toBe(ExitCode.Usage);
    });
  });

  it('treats declined confirmation as success', async () => {
    const terminal = {
      ...createRejectingTerminal(),
      confirm: async () => false,
      confirmPhrase: async () => false,
      promptMasked: async () => '',
      promptLine: async () => '',
    };
    expect(await confirmOrDecline(terminal, 'Sure?')).toBe('declined');
  });
});

describe('exit codes', () => {
  it('covers taxonomy fixtures', async () => {
    await withTempHome(async (_home, runtime) => {
      expect(await main(['--help'], { runtime })).toBe(ExitCode.Success);
      expect(await main(['nope'], { runtime })).toBe(ExitCode.Usage);
      expect(await main(['connect'], { runtime })).toBe(ExitCode.Usage);
    });
    await withTempHome(
      async (_h, runtime) => {
        expect(await main(['credentials', 'list'], { runtime })).toBe(ExitCode.LocalIoOrState);
      },
      { platform: 'win32' },
    );
  });

  it('emits stable JSON errors without secrets', async () => {
    await withTempHome(async (_home, runtime, cap) => {
      await writePublisherCredential(runtime, SITE_ID, {
        server: 'https://docs.example.com',
        token: TOKEN,
      });
      // Force validation-style JSON error
      expect(await main(['credentials', 'remove', '--json'], { runtime })).toBe(ExitCode.Usage);
      expect(cap.stdout).toContain('"ok": false');
      expect(cap.stdout).toContain('"exit_code"');
      expect(cap.stdout + cap.stderr).not.toContain(TOKEN);
    });
  });
});

describe('atomic write cleanup', () => {
  it('writes pointer files atomically', async () => {
    await withTempHome(async (home, runtime) => {
      const target = path.join(home, '.nrdocs', 'active-instance');
      await atomicWriteFile(runtime, target, `${INST_A}\n`, 0o600);
      const text = await fs.readFile(target, 'utf8');
      expect(text.trim()).toBe(INST_A);
      expect(modeBits((await fs.lstat(target)).mode)).toBe(0o600);
    });
  });
});
