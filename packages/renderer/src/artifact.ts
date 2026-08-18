import type { SiteId } from '@nrdocs/contracts';
import { buildPublicationGraph } from './build-graph.js';
import type { NrdocsConfig } from '@nrdocs/contracts';
import {
  renderPublication,
  type InMemoryArtifact,
  type RenderProgress,
} from './render-publication.js';
import { packArtifact } from './pack-artifact.js';
import type { PublicationDiagnostic } from './types.js';

/** Fixed-page Worker validator lives in @nrdocs/worker (Phase 9). */
export const FIXED_PAGE_VALIDATOR_GAP =
  'Fixed-page Worker validator is implemented in @nrdocs/worker; renderer output must remain schema-conformant.';

export type BuildArtifactOptions = {
  siteId: SiteId;
  generatorVersion?: string;
  onProgress?: (progress: RenderProgress) => void;
};

export type BuiltArtifact = {
  artifact: InMemoryArtifact;
  gzipBytes: Uint8Array;
  digest: string;
  diagnostics: PublicationDiagnostic[];
};

export async function buildArtifactFromGraph(
  graph: Awaited<ReturnType<typeof buildPublicationGraph>>,
  options: BuildArtifactOptions,
): Promise<BuiltArtifact> {
  const artifact = await renderPublication(graph, {
    siteId: options.siteId,
    generatorVersion: options.generatorVersion ?? '2.0.0',
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
  const packed = packArtifact(artifact);
  return {
    artifact,
    gzipBytes: packed.gzipBytes,
    digest: packed.digest,
    diagnostics: graph.diagnostics,
  };
}

export async function buildArtifactFromConfig(
  rootDir: string,
  config: NrdocsConfig,
  options: BuildArtifactOptions,
): Promise<BuiltArtifact> {
  const graph = await buildPublicationGraph(rootDir, config);
  return buildArtifactFromGraph(graph, options);
}
