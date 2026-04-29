import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { CliUsageError } from '../cli-usage-error';

export interface SafeWrite {
  path: string;
  content: string;
}

export interface DirectorySnapshotFile {
  relativePath: string;
  content: Buffer;
}

export function parseFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

export function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

export function writeFilesSafely(files: SafeWrite[], force: boolean): string[] {
  const conflicts = files.filter((file) => (
    existsSync(file.path) && readFileSync(file.path, 'utf8') !== file.content
  ));

  if (conflicts.length > 0 && !force) {
    throw new CliUsageError(
      'Import would overwrite existing files. Re-run with --force to replace:\n' +
        conflicts.map((f) => `  - ${f.path}`).join('\n'),
    );
  }

  const written: string[] = [];
  for (const file of files) {
    mkdirSync(dirname(file.path), { recursive: true });
    if (!existsSync(file.path) || readFileSync(file.path, 'utf8') !== file.content) {
      writeFileSync(file.path, file.content, 'utf8');
    }
    written.push(file.path);
  }
  return written;
}

export function snapshotDirectoryContents(sourceDir: string): DirectorySnapshotFile[] {
  const files: DirectorySnapshotFile[] = [];
  const sourceAbs = statSync(sourceDir).isDirectory() ? sourceDir : '';
  if (!sourceAbs) {
    throw new CliUsageError(`Source directory not found: ${sourceDir}`);
  }

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const src = join(dir, entry);
      const rel = relative(sourceDir, src);
      const st = statSync(src);
      if (st.isDirectory()) {
        walk(src);
        continue;
      }
      if (!st.isFile()) continue;
      files.push({ relativePath: rel.replace(/\\/g, '/'), content: readFileSync(src) });
    }
  }

  walk(sourceDir);
  return files;
}

export function writeDirectorySnapshot(
  files: DirectorySnapshotFile[],
  targetDir: string,
  force: boolean,
): string[] {
  const conflicts = files
    .map((file) => ({ ...file, path: join(targetDir, file.relativePath) }))
    .filter((file) => existsSync(file.path) && !readFileSync(file.path).equals(file.content));

  if (conflicts.length > 0 && !force) {
    throw new CliUsageError(
      'Import would overwrite existing files. Re-run with --force to replace:\n' +
        conflicts.map((f) => `  - ${f.path}`).join('\n'),
    );
  }

  const written: string[] = [];
  for (const file of files) {
    const path = join(targetDir, file.relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content);
    written.push(path);
  }
  return written;
}

export function removePathSafely(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
}

export function isSafeRelativePath(path: string): boolean {
  if (!path || path === '.' || path.startsWith('/') || path.includes('\0')) return false;
  const normalized = path.replace(/\\/g, '/');
  return !normalized.split('/').includes('..');
}

export function isValidPublishBranch(branch: string): boolean {
  if (!branch || branch.length > 255) return false;
  if (branch.startsWith('/') || branch.endsWith('/')) return false;
  if (branch.startsWith('.') || branch.endsWith('.')) return false;
  if (
    branch.includes('..') ||
    branch.includes('@{') ||
    branch.includes('\\') ||
    branch.includes('//')
  ) {
    return false;
  }
  return /^[A-Za-z0-9._/-]+$/.test(branch);
}

export function stripMarkdownExtension(path: string): string {
  return path.replace(/\\/g, '/').replace(/\.md$/i, '');
}
