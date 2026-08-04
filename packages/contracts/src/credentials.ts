import { parseSiteId, type SiteId } from './ids.js';

export type PublisherCredentialFile = {
  server: string;
  token: string;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseHttpsServerUrl(value: unknown, allowHttpLocal = false): string | null {
  if (typeof value !== 'string') return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === 'https:') {
    return `${url.origin}`;
  }
  if (
    allowHttpLocal &&
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  ) {
    return `${url.origin}`;
  }
  return null;
}

export function parsePublisherCredentialFile(raw: unknown): PublisherCredentialFile {
  if (!isPlainObject(raw)) throw new Error('credential file must be a JSON object');
  for (const key of Object.keys(raw)) {
    if (key !== 'server' && key !== 'token') {
      throw new Error(`unknown credential field: ${key}`);
    }
  }
  const server = parseHttpsServerUrl(raw.server);
  if (!server) throw new Error('credential server must be an https origin');
  if (typeof raw.token !== 'string' || !raw.token.startsWith('nrd_pub_')) {
    throw new Error('credential token is malformed');
  }
  if (!/^nrd_pub_[A-Za-z0-9_-]{43}$/.test(raw.token)) {
    throw new Error('credential token is malformed');
  }
  return { server, token: raw.token };
}

export function credentialFilenameForSite(siteId: SiteId): string {
  return `${siteId}.json`;
}

export function parseCredentialFilename(name: string): SiteId | null {
  if (!name.endsWith('.json')) return null;
  return parseSiteId(name.slice(0, -'.json'.length));
}
