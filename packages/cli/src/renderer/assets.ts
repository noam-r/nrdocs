/**
 * Static asset collection and validation.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ALLOWED_ASSET_EXTENSIONS, REJECTED_EXTENSIONS } from '@nrdocs/shared';
import type { RenderedFile } from './index.js';

/**
 * Collects allowed static assets from the docs directory.
 * Validates extensions against allowlist and rejects .js files.
 * Validates no path traversal.
 */
export function collectAssets(docsDir: string): RenderedFile[] {
  const resolvedDocsDir = path.resolve(docsDir);
  const files: RenderedFile[] = [];

  collectFromDir(resolvedDocsDir, resolvedDocsDir, files);

  return files;
}

function collectFromDir(dir: string, rootDir: string, results: RenderedFile[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Validate no path traversal
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(rootDir)) {
      continue;
    }

    if (entry.isDirectory()) {
      // Skip hidden directories
      if (entry.name.startsWith('.')) continue;
      collectFromDir(fullPath, rootDir, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();

      // Skip markdown files (handled separately)
      if (ext === '.md') continue;

      // Reject disallowed extensions
      if (REJECTED_EXTENSIONS.has(ext)) continue;

      // Only include allowed extensions
      if (!ALLOWED_ASSET_EXTENSIONS.has(ext)) continue;

      const relativePath = path.relative(rootDir, fullPath);

      // Additional path traversal check on relative path
      if (relativePath.includes('..')) continue;

      results.push({
        path: relativePath.replace(/\\/g, '/'),
        content: fs.readFileSync(fullPath),
      });
    }
  }
}
