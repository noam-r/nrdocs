import { findPathCollisions, portablePathCollisionKey } from '@nrdocs/contracts';
import { joinPosix, toPosix } from './paths.js';
import { stripOrderPrefix } from './titles.js';
import { RendererError, type SiteRoute } from './types.js';

/** Convert a source-relative Markdown path to a canonical site route. */
export function routeForSourceFile(sourceFile: string): SiteRoute {
  const posix = toPosix(sourceFile);
  if (!posix.endsWith('.md')) {
    throw new RendererError('invalid_source', `Not a Markdown source path:\n  ${posix}`);
  }
  const withoutExt = posix.slice(0, -'.md'.length);
  const segments = withoutExt.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return '/';

  const last = segments[segments.length - 1]!;
  const dirSegments = segments.slice(0, -1).map((s) => stripOrderPrefix(s));
  if (last === 'index') {
    if (dirSegments.length === 0) return '/';
    return `/${dirSegments.join('/')}/`;
  }
  const pageSeg = stripOrderPrefix(last);
  return `/${[...dirSegments, pageSeg].join('/')}/`;
}

export function assertUniqueRoutes(routes: readonly { route: string; sourceFile: string }[]): void {
  const entries = routes.map((r) => ({
    collection: 'pages' as const,
    path: r.route,
  }));
  // Exact duplicates
  const seenExact = new Map<string, string>();
  for (const r of routes) {
    const prior = seenExact.get(r.route);
    if (prior) {
      throw new RendererError(
        'route_collision',
        `Generated routes collide:\n  ${prior}\n  ${r.sourceFile}\nBoth produce:\n  ${r.route}`,
      );
    }
    seenExact.set(r.route, r.sourceFile);
  }
  const collisions = findPathCollisions(entries);
  if (collisions.length > 0) {
    const c = collisions[0]!;
    throw new RendererError(
      'route_collision',
      `Generated routes collide by portable key (${c.key}):\n  ${c.left.path}\n  ${c.right.path}`,
    );
  }
}

export function publicPathForAsset(sourceFile: string): string {
  return `/${toPosix(sourceFile)}`;
}

export { portablePathCollisionKey, joinPosix };
