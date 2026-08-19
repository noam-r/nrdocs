import { describe, expect, it } from 'vitest';
import { formatId, type SiteId } from '@nrdocs/contracts';
import { mintAgentGrant, verifyAgentGrantToken } from './grant.js';

const KEY = new Uint8Array(32).fill(11);
const SITE = formatId('site', new Uint8Array(16).fill(4)) as SiteId;
const NOW = new Date('2026-01-15T12:00:00Z');

describe('agent grants', () => {
  it('round-trips a 24h grant and rejects tampering and expiry', async () => {
    const minted = await mintAgentGrant(KEY, {
      siteId: SITE,
      generation: 3,
      duration: '24h',
      now: NOW,
      nonce16: new Uint8Array(16).fill(2),
    });
    expect(minted.payload.exp - minted.payload.iat).toBe(86400);
    const ok = await verifyAgentGrantToken(KEY, minted.token, NOW);
    expect(ok?.site_id).toBe(SITE);
    expect(ok?.generation).toBe(3);

    const [version, payload, hmac] = minted.token.split('.');
    const flipped = `${hmac!.slice(0, -1)}${hmac!.endsWith('a') ? 'b' : 'a'}`;
    expect(await verifyAgentGrantToken(KEY, `${version}.${payload}.${flipped}`, NOW)).toBeNull();
    expect(
      await verifyAgentGrantToken(KEY, minted.token, new Date('2026-01-16T13:00:00Z')),
    ).toBeNull();
  });
});
