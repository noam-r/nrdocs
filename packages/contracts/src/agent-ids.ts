import { sha256Hex } from './digest.js';
import { findPathCollisions, type PathEntry } from './path-collision.js';
import { AGENT_ID_HEX_LENGTH } from './agent-limits.js';

const ID_RE = new RegExp(`^[0-9a-f]{${AGENT_ID_HEX_LENGTH}}$`);

export function isAgentHexId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}

/** SHA-256 of NFC UTF-8, truncated to 32 lowercase hex characters. */
export async function agentIdFromCanonicalPath(canonicalPath: string): Promise<string> {
  const nfc = canonicalPath.normalize('NFC');
  const bytes = new TextEncoder().encode(nfc);
  const hex = await sha256Hex(bytes);
  return hex.slice(0, AGENT_ID_HEX_LENGTH);
}

/** Final path segment with a lowercase extension, from a validated public path. */
export function agentSafeBasename(publicPath: string): string {
  const nfc = publicPath.normalize('NFC');
  const parts = nfc.split('/').filter((p) => p.length > 0);
  const last = parts[parts.length - 1];
  if (!last) throw new Error('public path has no basename');
  const i = last.lastIndexOf('.');
  if (i <= 0) throw new Error('basename must include an extension');
  return `${last.slice(0, i)}${last.slice(i).toLowerCase()}`;
}

export function agentAssetRoute(id: string, publicPath: string): string {
  return `assets/${id}/${agentSafeBasename(publicPath)}`;
}

export function agentAttachmentRoute(id: string, publicPath: string): string {
  return `attachments/${id}/${agentSafeBasename(publicPath)}`;
}

export function agentPageMarkdownObject(pageId: string): string {
  return `agent/pages/${pageId}.md`;
}

export function assertAgentRelativeRoute(route: string, prefix: 'assets' | 'attachments'): void {
  if (!route.startsWith(`${prefix}/`)) {
    throw new Error(`agent route must start with ${prefix}/`);
  }
  if (route.includes('\\') || route.includes('\0') || route.includes('//')) {
    throw new Error('unsafe agent route');
  }
  const parts = route.split('/');
  if (parts.length !== 3 || parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new Error('unsafe agent route segments');
  }
  if (!isAgentHexId(parts[1])) throw new Error('agent route id is invalid');
}

export function findAgentIdCollisions(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) dupes.push(id);
    else seen.add(id);
  }
  return dupes;
}

export function findAgentRouteCollisions(
  routes: readonly string[],
): ReturnType<typeof findPathCollisions> {
  const entries: PathEntry[] = routes.map((path) => ({ collection: 'public', path }));
  return findPathCollisions(entries);
}
