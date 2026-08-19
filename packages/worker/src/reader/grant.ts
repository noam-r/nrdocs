import {
  formatRfc3339,
  lifetimeSecondsForDuration,
  parseAgentGrantPayload,
  shareInstructions,
  type AgentGrantPayload,
  type AgentShareDuration,
  type SiteId,
} from '@nrdocs/contracts';
import { bytesToBase64Url, signV1Token, unixSeconds, verifyV1Token } from './crypto.js';

export { shareInstructions };

export async function mintAgentGrant(
  key: Uint8Array,
  input: {
    siteId: SiteId;
    generation: number;
    duration: AgentShareDuration;
    now?: Date;
    nonce16?: Uint8Array;
  },
): Promise<{ token: string; payload: AgentGrantPayload; expiresAt: string }> {
  const nonce = input.nonce16 ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
  if (nonce.byteLength !== 16) throw new Error('grant nonce must be 16 bytes');
  const iat = unixSeconds(input.now);
  const exp = iat + lifetimeSecondsForDuration(input.duration);
  const payload: AgentGrantPayload = {
    v: 1,
    site_id: input.siteId,
    generation: input.generation,
    iat,
    exp,
    nonce: bytesToBase64Url(nonce),
  };
  const token = await signV1Token(key, payload);
  return {
    token,
    payload,
    expiresAt: formatRfc3339(new Date(exp * 1000)),
  };
}

export async function verifyAgentGrantToken(
  key: Uint8Array,
  token: string,
  now?: Date,
): Promise<AgentGrantPayload | null> {
  const raw = await verifyV1Token(key, token);
  if (!raw) return null;
  try {
    const payload = parseAgentGrantPayload(raw);
    const t = unixSeconds(now);
    if (payload.iat > t + 60) return null;
    if (!(t < payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}
