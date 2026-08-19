import { parseHttpsServerUrl } from '@nrdocs/contracts';

/** HTTPS origin only: scheme + authority, no path/query/fragment/credentials/slash. */
export function parseCanonicalOriginBinding(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.endsWith('/')) return null;
  const origin = parseHttpsServerUrl(value);
  if (!origin) return null;
  if (origin !== value) return null;
  return origin;
}

export function resolveCanonicalOrigin(env: { NRDOCS_CANONICAL_ORIGIN?: string }): string | null {
  return parseCanonicalOriginBinding(env.NRDOCS_CANONICAL_ORIGIN);
}
