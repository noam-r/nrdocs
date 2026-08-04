import path from 'node:path';
import fsp from 'node:fs/promises';
import { RendererError } from './types.js';

/** Normalize to POSIX relative path with `/` separators. */
export function toPosix(rel: string): string {
  return rel.replaceAll('\\', '/');
}

export function joinPosix(...parts: string[]): string {
  return parts
    .filter((p) => p.length > 0)
    .join('/')
    .replace(/\/+/g, '/');
}

export async function lstatSafe(abs: string) {
  return fsp.lstat(abs);
}

export async function assertNotSymlinkEntry(
  abs: string,
  label: string,
  sourceFile?: string,
): Promise<void> {
  const st = await lstatSafe(abs);
  if (st.isSymbolicLink()) {
    throw new RendererError(
      'symlink',
      `${label} must not be a symbolic link:\n  ${toPosix(path.relative(process.cwd(), abs) || abs)}`,
      sourceFile ? { sourceFile } : undefined,
    );
  }
}

/**
 * Ensure every path component from root to target (inclusive) is a real
 * non-symlink entry, and that target stays under root.
 */
export async function assertContainedRealPath(
  rootDir: string,
  relativePosix: string,
  label: string,
): Promise<string> {
  if (relativePosix.startsWith('/') || relativePosix.includes('\0')) {
    throw new RendererError('path_escape', `${label} path is unsafe:\n  ${relativePosix}`);
  }
  const parts = relativePosix.split('/').filter((p) => p.length > 0);
  if (parts.some((p) => p === '.' || p === '..')) {
    throw new RendererError(
      'path_escape',
      `${label} path escapes the publication root:\n  ${relativePosix}`,
    );
  }
  let cur = rootDir;
  for (const part of parts) {
    cur = path.join(cur, part);
    let st;
    try {
      st = await fsp.lstat(cur);
    } catch {
      throw new RendererError('missing_path', `${label} was not found:\n  ${relativePosix}`);
    }
    if (st.isSymbolicLink()) {
      throw new RendererError(
        'symlink',
        `${label} path contains a symbolic link:\n  ${relativePosix}`,
      );
    }
  }
  const resolvedRoot = await fsp.realpath(rootDir);
  const resolvedTarget = await fsp.realpath(path.join(rootDir, ...parts));
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new RendererError(
      'path_escape',
      `${label} path escapes the publication root:\n  ${relativePosix}`,
    );
  }
  return resolvedTarget;
}

export async function pathExists(abs: string): Promise<boolean> {
  try {
    await fsp.lstat(abs);
    return true;
  } catch {
    return false;
  }
}

export async function isRealDirectory(abs: string): Promise<boolean> {
  try {
    const st = await fsp.lstat(abs);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function isRealFile(abs: string): Promise<boolean> {
  try {
    const st = await fsp.lstat(abs);
    return st.isFile() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function isSymlink(abs: string): Promise<boolean> {
  try {
    const st = await fsp.lstat(abs);
    return st.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Recursively determine whether a real directory tree contains any .md file. */
export async function directoryContainsMarkdown(absDir: string): Promise<boolean> {
  const entries = await fsp.readdir(absDir, { withFileTypes: true });
  // Sort for determinism
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const ent of entries) {
    const child = path.join(absDir, ent.name);
    if (ent.isSymbolicLink()) continue;
    if (ent.isFile() && ent.name.endsWith('.md')) return true;
    if (ent.isDirectory()) {
      if (await directoryContainsMarkdown(child)) return true;
    }
  }
  return false;
}
