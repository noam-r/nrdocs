/**
 * Portable path collision key (artifact schema version 1).
 * Spec: `/` separators, Unicode NFC, locale-independent Unicode lowercase.
 */

export function portablePathCollisionKey(path: string): string {
  const withSlash = path.replaceAll('\\', '/');
  const nfc = withSlash.normalize('NFC');
  return nfc.toLocaleLowerCase('en-US');
}

export type PathCollection = 'pages' | 'assets' | 'attachments' | 'source' | 'public';

export type PathEntry = {
  collection: PathCollection;
  path: string;
};

export type PathCollision = {
  key: string;
  left: PathEntry;
  right: PathEntry;
};

export function findPathCollisions(entries: readonly PathEntry[]): PathCollision[] {
  const seen = new Map<string, PathEntry>();
  const collisions: PathCollision[] = [];
  for (const entry of entries) {
    const key = portablePathCollisionKey(entry.path);
    const prior = seen.get(key);
    if (prior && prior.path !== entry.path) {
      collisions.push({ key, left: prior, right: entry });
    } else if (prior && prior.collection !== entry.collection) {
      collisions.push({ key, left: prior, right: entry });
    } else if (!prior) {
      seen.set(key, entry);
    } else if (prior.path === entry.path && prior.collection === entry.collection) {
      collisions.push({ key, left: prior, right: entry });
    }
  }
  return collisions;
}
