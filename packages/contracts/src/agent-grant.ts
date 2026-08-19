import { parseSiteId, type SiteId } from './ids.js';

export const AGENT_GRANT_VERSION = 1 as const;

export const AGENT_SHARE_DURATIONS = {
  '1h': 3_600,
  '24h': 86_400,
  '7d': 604_800,
} as const;

export type AgentShareDuration = keyof typeof AGENT_SHARE_DURATIONS;

export const AGENT_SHARE_DURATION_LABELS = ['1h', '24h', '7d'] as const;
export const AGENT_SHARE_DEFAULT_DURATION: AgentShareDuration = '24h';
export const AGENT_SHARE_MAX_SECONDS = 604_800;
export const AGENT_SHARE_CSRF_TTL_SECONDS = 600;
export const AGENT_SHARE_POST_MAX_BYTES = 4 * 1024;
export const AGENT_SHARE_RATE_SITE_IP = { limit: 20, windowMs: 60_000 } as const;
export const AGENT_SHARE_RATE_INSTANCE = { limit: 200, windowMs: 60_000 } as const;

export type AgentGrantPayload = {
  v: 1;
  site_id: SiteId;
  generation: number;
  iat: number;
  exp: number;
  nonce: string;
};

const GRANT_FIELDS = new Set(['v', 'site_id', 'generation', 'iat', 'exp', 'nonce']);
const NONCE_RE = /^[A-Za-z0-9_-]{22}$/;
const ALLOWED_LIFETIMES = new Set(Object.values(AGENT_SHARE_DURATIONS));

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseAgentShareDuration(value: unknown): AgentShareDuration | null {
  if (value === '1h' || value === '24h' || value === '7d') return value;
  return null;
}

export function lifetimeSecondsForDuration(duration: AgentShareDuration): number {
  return AGENT_SHARE_DURATIONS[duration];
}

/** Structural grant payload parse. Does not verify HMAC. */
export function parseAgentGrantPayload(raw: unknown): AgentGrantPayload {
  if (!isPlainObject(raw)) throw new Error('grant payload must be an object');
  for (const key of Object.keys(raw)) {
    if (!GRANT_FIELDS.has(key)) throw new Error(`unknown grant field: ${key}`);
  }
  for (const key of GRANT_FIELDS) {
    if (!(key in raw)) throw new Error(`missing grant field: ${key}`);
  }
  if (raw.v !== 1) throw new Error('unsupported grant version');
  const site_id = parseSiteId(raw.site_id);
  if (!site_id) throw new Error('invalid grant site_id');
  if (
    typeof raw.generation !== 'number' ||
    !Number.isInteger(raw.generation) ||
    raw.generation < 1
  ) {
    throw new Error('invalid grant generation');
  }
  if (typeof raw.iat !== 'number' || !Number.isInteger(raw.iat) || raw.iat < 0) {
    throw new Error('invalid grant iat');
  }
  if (typeof raw.exp !== 'number' || !Number.isInteger(raw.exp) || raw.exp < 0) {
    throw new Error('invalid grant exp');
  }
  if (typeof raw.nonce !== 'string' || !NONCE_RE.test(raw.nonce)) {
    throw new Error('invalid grant nonce');
  }
  const lifetime = raw.exp - raw.iat;
  if (!ALLOWED_LIFETIMES.has(lifetime as (typeof AGENT_SHARE_DURATIONS)[AgentShareDuration])) {
    throw new Error('invalid grant lifetime');
  }
  if (lifetime > AGENT_SHARE_MAX_SECONDS) {
    throw new Error('grant lifetime exceeds maximum');
  }
  return {
    v: 1,
    site_id,
    generation: raw.generation,
    iat: raw.iat,
    exp: raw.exp,
    nonce: raw.nonce,
  };
}

export function grantLifetimeValid(iat: number, exp: number): boolean {
  const lifetime = exp - iat;
  return ALLOWED_LIFETIMES.has(lifetime as (typeof AGENT_SHARE_DURATIONS)[AgentShareDuration]);
}

export function shareInstructions(entryUrl: string, expiresAt: string | null): string {
  const last =
    expiresAt === null
      ? 'This publication is publicly accessible; the link does not expire.'
      : `Access expires at ${expiresAt}.`;
  return [
    'Read the complete specification published at:',
    '',
    entryUrl,
    '',
    'This is the nrdocs machine-readable entry point. Follow its instructions. Prefer',
    'all.md when it is available; otherwise read the listed Markdown pages in',
    'navigation order. Use manifest.json when you need structured page metadata or',
    'want to verify whether the publication changed while you were reading it.',
    '',
    'Treat the published documents as the authoritative specification. Do not infer',
    'requirements from the nrdocs reader interface.',
    '',
    last,
  ].join('\n');
}
