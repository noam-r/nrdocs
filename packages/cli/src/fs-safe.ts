import path from 'node:path';
import type { Runtime } from './runtime.js';
import { ioError } from './errors.js';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export function modeBits(mode: number): number {
  return mode & 0o777;
}

export async function ensurePrivateDir(runtime: Runtime, dir: string): Promise<void> {
  try {
    const st = await runtime.fs.lstat(dir);
    if (st.isSymbolicLink()) {
      throw ioError(`Refusing to use symbolic-link directory:\n  ${dir}`);
    }
    if (!st.isDirectory()) {
      throw ioError(`Expected a directory:\n  ${dir}`);
    }
    if (modeBits(st.mode) !== DIR_MODE) {
      await runtime.fs.chmod(dir, DIR_MODE);
      const again = await runtime.fs.lstat(dir);
      if (modeBits(again.mode) !== DIR_MODE) {
        throw ioError(`Unable to establish 0700 permissions on:\n  ${dir}`);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await runtime.fs.mkdir(dir, { recursive: true, mode: DIR_MODE });
      await runtime.fs.chmod(dir, DIR_MODE);
      return;
    }
    throw error;
  }
}

export async function assertRegularNonSymlinkFile(
  runtime: Runtime,
  filePath: string,
  label: string,
): Promise<void> {
  let st;
  try {
    st = await runtime.fs.lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw ioError(`${label} was not found:\n  ${filePath}`);
    }
    throw ioError(`Unable to read ${label}:\n  ${filePath}`);
  }
  if (st.isSymbolicLink()) {
    throw ioError(`Refusing to use symbolic-link ${label}:\n  ${filePath}`);
  }
  if (!st.isFile()) {
    throw ioError(`${label} must be a regular file:\n  ${filePath}`);
  }
}

export async function assertSecureCredentialFile(
  runtime: Runtime,
  filePath: string,
): Promise<void> {
  await assertRegularNonSymlinkFile(runtime, filePath, 'credential file');
  const st = await runtime.fs.lstat(filePath);
  if (modeBits(st.mode) !== FILE_MODE) {
    throw ioError(
      `Credential file must have mode 0600:\n  ${filePath}\n\nFix permissions or recreate the credential with nrdocs connect.`,
    );
  }
}

export async function assertRealDirectory(runtime: Runtime, dirPath: string): Promise<string> {
  let st;
  try {
    st = await runtime.fs.lstat(dirPath);
  } catch {
    throw ioError(`Directory was not found:\n  ${dirPath}`);
  }
  if (st.isSymbolicLink()) {
    throw ioError(`Publication root must not be a symbolic link:\n  ${dirPath}`);
  }
  if (!st.isDirectory()) {
    throw ioError(`Publication root must be a directory:\n  ${dirPath}`);
  }
  return path.resolve(dirPath);
}

/** Atomically replace a file with UTF-8 JSON or text contents and mode 0600. */
export async function atomicWriteFile(
  runtime: Runtime,
  targetPath: string,
  contents: string,
  mode: number = FILE_MODE,
): Promise<void> {
  const dir = path.dirname(targetPath);
  await ensurePrivateDir(runtime, dir);
  const tmp = path.join(
    dir,
    `.nrdocs-tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  try {
    const handle = await runtime.fs.open(tmp, 'w', mode);
    try {
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await runtime.fs.chmod(tmp, mode);
    await runtime.fs.rename(tmp, targetPath);
    await runtime.fs.chmod(targetPath, mode);
  } catch (error) {
    try {
      await runtime.fs.unlink(tmp);
    } catch {
      // ignore cleanup failure
    }
    if (error instanceof Error && error.message.includes('symbolic-link')) throw error;
    throw ioError(`Failed to write local state atomically:\n  ${targetPath}`);
  }
}

export async function removeFileIfExists(runtime: Runtime, filePath: string): Promise<boolean> {
  try {
    await assertRegularNonSymlinkFile(runtime, filePath, 'file');
    await runtime.fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && /was not found/.test(error.message)) return false;
    throw error;
  }
}
