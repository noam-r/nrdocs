/**
 * Local Markdown discovery, validation, rendering, and packaging.
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
export { routeRelativeHref, pageObjectPath, mediaObjectPath } from './relative-href.js';
export { highlightCode, normalizeHighlightLanguage } from './highlight.js';
export {
  assemblePageDocument,
  assemblePageDocumentV2,
  assemblePageDocumentV3,
  flattenNavigablePages,
} from './shell.js';
export {
  renderPublication,
  type InMemoryArtifact,
  type RenderedFile,
  type RenderProgress,
} from './render-publication.js';
export { packArtifact, buildDeterministicTar, gzipDeterministic } from './pack-artifact.js';
export {
  buildArtifactFromConfig,
  buildArtifactFromGraph,
  FIXED_PAGE_VALIDATOR_GAP,
  type BuiltArtifact,
} from './artifact.js';
