import type { SiteId } from '@nrdocs/contracts';
import { buildPublicationGraph } from './build-graph.js';
import type { NrdocsConfig } from '@nrdocs/contracts';
import { renderPublication, type InMemoryArtifact } from './render-publication.js';
import { packArtifact } from './pack-artifact.js';

/** Fixed-page Worker validator lives in @nrdocs/worker (Phase 9). */
export const FIXED_PAGE_VALIDATOR_GAP =
  'Fixed-page Worker validator is implemented in @nrdocs/worker; renderer output must remain schema-conformant.';

export async function buildArtifactFromGraph(
  graph: Awaited<ReturnType<typeof buildPublicationGraph>>,
  options: { siteId: SiteId; generatorVersion?: string },
): Promise<{ artifact: InMemoryArtifact; gzipBytes: Uint8Array; digest: string }> {
  const artifact = await renderPublication(graph, {
    siteId: options.siteId,
    generatorVersion: options.generatorVersion ?? '2.0.0',
  });
  const packed = packArtifact(artifact);
  return { artifact, gzipBytes: packed.gzipBytes, digest: packed.digest };
}

export async function buildArtifactFromConfig(
  rootDir: string,
  config: NrdocsConfig,
  options: { siteId: SiteId; generatorVersion?: string },
): Promise<{ artifact: InMemoryArtifact; gzipBytes: Uint8Array; digest: string }> {
  const graph = await buildPublicationGraph(rootDir, config);
  return buildArtifactFromGraph(graph, options);
}
