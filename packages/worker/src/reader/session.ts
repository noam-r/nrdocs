import type { SiteId } from '@nrdocs/contracts';
import { signV1Token, unixSeconds, verifyV1Token } from './crypto.js';

export const SESSION_MAX_AGE_SECONDS = 43_200;

export function sessionCookieName(siteId: SiteId | string): string {
  return `__Host-nrdocs-s-${siteId}`;
}

export type SessionClaims = {
  v: 1;
  site_id: string;
  generation: number;
  iat: number;
  exp: number;
};

export async function mintSessionToken(
  key: Uint8Array,
  input: { siteId: SiteId; generation: number; now?: Date },
): Promise<string> {
  const iat = unixSeconds(input.now);
  return signV1Token(key, {
    v: 1,
    site_id: input.siteId,
    generation: input.generation,
    iat,
    exp: iat + SESSION_MAX_AGE_SECONDS,
  });
}

export async function parseSessionToken(
  key: Uint8Array,
  token: string,
  expected: { siteId: SiteId; generation: number; now?: Date },
): Promise<SessionClaims | null> {
  const payload = await verifyV1Token(key, token);
  if (!payload) return null;
  if (payload.v !== 1) return null;
  if (payload.site_id !== expected.siteId) return null;
  if (typeof payload.generation !== 'number' || payload.generation !== expected.generation) {
    return null;
  }
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
  const now = unixSeconds(expected.now);
  if (!(now < payload.exp)) return null;
  if (!(payload.iat <= now + 60)) return null;
  return {
    v: 1,
    site_id: String(payload.site_id),
    generation: payload.generation,
    iat: payload.iat,
    exp: payload.exp,
  };
}

export function sessionSetCookie(siteId: SiteId, token: string): string {
  return `${sessionCookieName(siteId)}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function sessionClearCookie(siteId: SiteId): string {
  return `${sessionCookieName(siteId)}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}
