/**
 * Local Markdown discovery, validation, and publication-graph construction.
 * HTML rendering and artifact packaging arrive in Phase 4.
 */
import { CONTRACTS_PACKAGE } from '@nrdocs/contracts';

export const RENDERER_PACKAGE = '@nrdocs/renderer' as const;

export function rendererDependsOnContracts(): string {
  return CONTRACTS_PACKAGE;
}

export * from './types.js';
export * from './utf8.js';
export * from './titles.js';
export * from './routes.js';
export * from './discover.js';
export * from './build-graph.js';
export * from './serialize-nav.js';
export { decodeMarkdownSource } from './utf8.js';
export { extractFirstH1, loadAndNormalizeMarkdown, collectLinks } from './markdown-scan.js';
