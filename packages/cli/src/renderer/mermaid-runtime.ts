/**
 * Loads the pre-bundled Mermaid browser runtime (built by scripts/bundle-mermaid.mjs).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MERMAID_RUNTIME_REL = 'runtime/mermaid.min.js';
export const MERMAID_ARTIFACT_PATH = '_nrdocs/mermaid.min.js';

/**
 * Resolves paths to try for the bundled mermaid runtime (dev + published layouts).
 */
function mermaidRuntimeCandidates(): string[] {
  return [
    path.join(__dirname, MERMAID_RUNTIME_REL),
    path.join(__dirname, '../../dist/runtime/mermaid.min.js'),
  ];
}

/**
 * Reads the bundled Mermaid JS for inclusion in published artifacts.
 */
export function loadMermaidRuntime(): Buffer {
  for (const candidate of mermaidRuntimeCandidates()) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate);
    }
  }
  throw new Error(
    'Mermaid runtime not found. Run: pnpm --filter nrdocs bundle (or pnpm bundle in packages/cli)',
  );
}

/**
 * Relative URL from an HTML output path to the shared mermaid runtime.
 */
export function mermaidScriptSrcForOutput(outputPath: string): string {
  const depth = outputPath.split('/').length - 1;
  const prefix = depth > 0 ? '../'.repeat(depth) : '';
  return `${prefix}${MERMAID_ARTIFACT_PATH}`;
}
