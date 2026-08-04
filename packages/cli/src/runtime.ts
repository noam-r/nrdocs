import type { Stats } from 'node:fs';
import fsp from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExitCode } from '@nrdocs/contracts';
import { CliError } from './errors.js';

export type RuntimeIo = {
  writeStdout(text: string): void;
  writeStderr(text: string): void;
};

export type Runtime = {
  platform: NodeJS.Platform;
  cwd: string;
  homeDir: string;
  env: Record<string, string | undefined>;
  stdoutIsTTY: boolean;
  stderrIsTTY: boolean;
  stdinIsTTY: boolean;
  now(): Date;
  io: RuntimeIo;
  fs: {
    lstat(p: string): Promise<Stats>;
    stat(p: string): Promise<Stats>;
    readdir(p: string): Promise<string[]>;
    readFile(p: string, encoding: 'utf8'): Promise<string>;
    mkdir(p: string, options: { recursive: boolean; mode?: number }): Promise<void>;
    writeFile(p: string, data: string, options: { mode?: number }): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    unlink(p: string): Promise<void>;
    chmod(p: string, mode: number): Promise<void>;
    realpath(p: string): Promise<string>;
    open(p: string, flags: string, mode?: number): Promise<FileHandle>;
  };
};

export function createProcessRuntime(
  overrides: Partial<Omit<Runtime, 'fs' | 'io'>> & {
    io?: Partial<RuntimeIo>;
    env?: Record<string, string | undefined>;
  } = {},
): Runtime {
  const env = { ...process.env, ...overrides.env };
  return {
    platform: overrides.platform ?? process.platform,
    cwd: overrides.cwd ?? process.cwd(),
    homeDir: overrides.homeDir ?? os.homedir(),
    env,
    stdoutIsTTY: overrides.stdoutIsTTY ?? Boolean(process.stdout.isTTY),
    stderrIsTTY: overrides.stderrIsTTY ?? Boolean(process.stderr.isTTY),
    stdinIsTTY: overrides.stdinIsTTY ?? Boolean(process.stdin.isTTY),
    now: overrides.now ?? (() => new Date()),
    io: {
      writeStdout: overrides.io?.writeStdout ?? ((t) => process.stdout.write(t)),
      writeStderr: overrides.io?.writeStderr ?? ((t) => process.stderr.write(t)),
    },
    fs: {
      lstat: (p) => fsp.lstat(p),
      stat: (p) => fsp.stat(p),
      readdir: (p) => fsp.readdir(p),
      readFile: (p, encoding) => fsp.readFile(p, encoding),
      mkdir: async (p, options) => {
        await fsp.mkdir(p, options);
      },
      writeFile: (p, data, options) => fsp.writeFile(p, data, options),
      rename: (from, to) => fsp.rename(from, to),
      unlink: (p) => fsp.unlink(p),
      chmod: (p, mode) => fsp.chmod(p, mode),
      realpath: (p) => fsp.realpath(p),
      open: (p, flags, mode) => fsp.open(p, flags, mode),
    },
  };
}

export function assertSupportedPlatform(runtime: Runtime): void {
  if (runtime.platform === 'win32') {
    throw new CliError({
      code: 'unsupported_platform',
      phase: 'io',
      exit_code: ExitCode.LocalIoOrState,
      safe_message:
        'nrdocs 2.0 supports Linux and macOS only. Windows is outside the support contract.',
    });
  }
}

export function nrdocsHome(runtime: Runtime): string {
  return path.join(runtime.homeDir, '.nrdocs');
}

export function sitesDir(runtime: Runtime): string {
  return path.join(nrdocsHome(runtime), 'sites');
}

export function instancesDir(runtime: Runtime): string {
  return path.join(nrdocsHome(runtime), 'instances');
}

export function activeInstancePath(runtime: Runtime): string {
  return path.join(nrdocsHome(runtime), 'active-instance');
}

export function credentialPath(runtime: Runtime, siteId: string): string {
  return path.join(sitesDir(runtime), `${siteId}.json`);
}

export function instancePath(runtime: Runtime, instanceId: string): string {
  return path.join(instancesDir(runtime), `${instanceId}.json`);
}
