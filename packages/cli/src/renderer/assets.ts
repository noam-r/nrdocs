/**
 * Static asset collection and validation.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateAssetFilePath, findUnlistedAssetPaths } from '@nrdocs/shared';
import type { RenderedFile } from './index.js';

export interface CollectAssetsOptions {
  /** When true, include files whose extensions are not on the platform whitelist. */
  allowUnlisted?: boolean;
}

export interface CollectAssetsResult {
  files: RenderedFile[];
  rejected: Array<{ path: string; message: string }>;
}

/**
 * Collects allowed static assets from the docs directory.
 */
export function collectAssets(
  docsDir: string,
  options?: CollectAssetsOptions,
): CollectAssetsResult {
  const resolvedDocsDir = path.resolve(docsDir);
  const files: RenderedFile[] = [];
  const rejected: Array<{ path: string; message: string }> = [];
  const allowUnlisted = options?.allowUnlisted ?? false;

  collectFromDir(resolvedDocsDir, resolvedDocsDir, files, rejected, allowUnlisted);

  return { files, rejected };
}

/**
 * Scans docs tree for paths that need allow_unlisted_assets on a matching rule.
 */
export function scanDocsForUnlistedAssets(docsDir: string): string[] {
  const { files, rejected } = collectAssets(docsDir, { allowUnlisted: true });
  const paths = [
    ...files.map((f) => f.path),
    ...rejected.map((r) => r.path),
  ];
  return findUnlistedAssetPaths(paths);
}

function collectFromDir(
  dir: string,
  rootDir: string,
  results: RenderedFile[],
  rejected: Array<{ path: string; message: string }>,
  allowUnlisted: boolean,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(rootDir)) {
      continue;
    }

    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      collectFromDir(fullPath, rootDir, results, rejected, allowUnlisted);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();

      if (ext === '.md') continue;
      if (ext === '.html') continue;

      const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      if (relativePath.includes('..')) continue;

      const check = validateAssetFilePath(relativePath, { allowUnlisted });
      if (!check.ok) {
        rejected.push({
          path: relativePath,
          message: check.message ?? 'Not allowed',
        });
        continue;
      }

      results.push({
        path: relativePath,
        content: fs.readFileSync(fullPath),
      });
    }
  }
}

/**
 * @deprecated Use collectAssets return value; kept for tests migrating gradually.
 */
export function collectAssetsLegacy(docsDir: string): RenderedFile[] {
  return collectAssets(docsDir).files;
}
