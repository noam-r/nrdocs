import type { SiteId } from '@nrdocs/contracts';
import { bytesToBase64Url, signV1Token, unixSeconds, verifyV1Token } from './crypto.js';

export const CSRF_TTL_SECONDS = 600;

export type CsrfAction = 'access' | 'logout' | 'agent-share';

export async function mintCsrfToken(
  key: Uint8Array,
  input: {
    action: CsrfAction;
    siteId: SiteId;
    returnPath?: string;
    generation?: number;
    now?: Date;
    nonce16?: Uint8Array;
  },
): Promise<string> {
  const nonce = input.nonce16 ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
  if (nonce.byteLength !== 16) throw new Error('csrf nonce must be 16 bytes');
  if (input.action === 'agent-share') {
    if (input.generation === undefined) throw new Error('agent-share csrf requires generation');
    return signV1Token(key, {
      v: 1,
      action: input.action,
      site_id: input.siteId,
      generation: input.generation,
      iat: unixSeconds(input.now),
      nonce: bytesToBase64Url(nonce),
    });
  }
  return signV1Token(key, {
    v: 1,
    action: input.action,
    site_id: input.siteId,
    return_path: input.returnPath ?? '',
    iat: unixSeconds(input.now),
    nonce: bytesToBase64Url(nonce),
  });
}

export async function verifyCsrfToken(
  key: Uint8Array,
  token: string,
  expected: {
    action: CsrfAction;
    siteId: SiteId;
    returnPath?: string;
    generation?: number;
    now?: Date;
  },
): Promise<boolean> {
  const payload = await verifyV1Token(key, token);
  if (!payload) return false;
  if (payload.v !== 1) return false;
  if (payload.action !== expected.action) return false;
  if (payload.site_id !== expected.siteId) return false;
  if (typeof payload.iat !== 'number' || typeof payload.nonce !== 'string') return false;
  const now = unixSeconds(expected.now);
  if (now > payload.iat + CSRF_TTL_SECONDS) return false;
  if (payload.iat > now + 60) return false;
  if (expected.action === 'agent-share') {
    if (typeof payload.generation !== 'number') return false;
    if (payload.generation !== expected.generation) return false;
    if (payload.return_path !== undefined) return false;
    return true;
  }
  if (payload.return_path !== (expected.returnPath ?? '')) return false;
  return true;
}
