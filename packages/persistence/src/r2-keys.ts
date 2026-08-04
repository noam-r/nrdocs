import { parseArtifactId, parseSiteId, type ArtifactId, type SiteId } from '@nrdocs/contracts';

/** Deterministic private R2 object keys — never include slug, hostname, or secrets. */

export function sitePrefix(siteId: SiteId | string): string {
  const id = parseSiteId(siteId);
  if (!id) throw new Error('invalid site id for R2 key');
  return `sites/${id}/`;
}

export function artifactPrefix(siteId: SiteId | string, artifactId: ArtifactId | string): string {
  const site = parseSiteId(siteId);
  const artifact = parseArtifactId(artifactId);
  if (!site || !artifact) throw new Error('invalid ids for R2 artifact prefix');
  return `sites/${site}/artifacts/${artifact}/`;
}

export function artifactObjectKey(
  siteId: SiteId | string,
  artifactId: ArtifactId | string,
  objectPath: string,
): string {
  if (!objectPath || objectPath.startsWith('/') || objectPath.includes('..')) {
    throw new Error('invalid artifact object path');
  }
  return `${artifactPrefix(siteId, artifactId)}${objectPath}`;
}

export function instanceMarkerKey(): string {
  return '_nrdocs/instance.json';
}
