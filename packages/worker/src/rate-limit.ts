import { RATE_LIMITS } from './limits.js';
import { ApiError } from './http.js';
import { PublisherApiErrorCode, sha256Hex } from '@nrdocs/contracts';

export type RateLimiter = {
  take(key: string, limit: number, windowMs: number, operation?: string): Promise<boolean>;
};

/** Cloudflare Workers Rate Limit binding shape. */
export type CfRateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

/** Process-local sliding window for tests and single-isolate abuse control. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  async take(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const cutoff = now - windowMs;
    const prev = this.hits.get(key) ?? [];
    const kept = prev.filter((t) => t > cutoff);
    if (kept.length >= limit) {
      this.hits.set(key, kept);
      return false;
    }
    kept.push(now);
    this.hits.set(key, kept);
    return true;
  }
}

/** Prefer a Cloudflare Rate Limit binding when present. */
export class CloudflareBindingRateLimiter implements RateLimiter {
  constructor(private readonly binding: CfRateLimitBinding) {}

  async take(key: string, _limit?: number, _windowMs?: number): Promise<boolean> {
    const result = await this.binding.limit({ key });
    return result.success;
  }
}

/**
 * Routes by operation key-part (`pwd-ip`, `api`, …) to a CF binding limiter when
 * configured; otherwise falls back to the shared memory limiter.
 */
export class CompositeRateLimiter implements RateLimiter {
  constructor(
    private readonly byOperation: Readonly<Record<string, RateLimiter | undefined>>,
    private readonly fallback: RateLimiter,
  ) {}

  async take(key: string, limit: number, windowMs: number, operation?: string): Promise<boolean> {
    const routed = operation ? this.byOperation[operation] : undefined;
    if (routed) {
      try {
        return await routed.take(key, limit, windowMs);
      } catch {
        // Bindings may be absent/misconfigured at runtime; degrade to memory
        // limiter so auth/publish paths do not fail closed with 503.
        return this.fallback.take(key, limit, windowMs);
      }
    }
    return this.fallback.take(key, limit, windowMs);
  }
}

export type RateLimitBindingEnv = {
  PASSWORD_IP_LIMIT?: CfRateLimitBinding;
  PASSWORD_SITE_LIMIT?: CfRateLimitBinding;
  INVALID_TOKEN_LIMIT?: CfRateLimitBinding;
  TOKEN_RESOLVE_LIMIT?: CfRateLimitBinding;
  TOKEN_PUBLISH_LIMIT?: CfRateLimitBinding;
  INSTANCE_API_LIMIT?: CfRateLimitBinding;
  AGENT_SHARE_IP_LIMIT?: CfRateLimitBinding;
  AGENT_SHARE_INSTANCE_LIMIT?: CfRateLimitBinding;
};

/** Map each rate-limit operation to its Cloudflare binding, with memory fallback. */
export function createCompositeRateLimiter(env: RateLimitBindingEnv): RateLimiter {
  const memory = new MemoryRateLimiter();
  const wrap = (binding: CfRateLimitBinding | undefined): RateLimiter | undefined =>
    binding ? new CloudflareBindingRateLimiter(binding) : undefined;
  return new CompositeRateLimiter(
    {
      'pwd-ip': wrap(env.PASSWORD_IP_LIMIT),
      'pwd-site': wrap(env.PASSWORD_SITE_LIMIT),
      'invalid-cred': wrap(env.INVALID_TOKEN_LIMIT),
      resolve: wrap(env.TOKEN_RESOLVE_LIMIT),
      publish: wrap(env.TOKEN_PUBLISH_LIMIT),
      api: wrap(env.INSTANCE_API_LIMIT),
      'agent-share-ip': wrap(env.AGENT_SHARE_IP_LIMIT),
      'agent-share-instance': wrap(env.AGENT_SHARE_INSTANCE_LIMIT),
    },
    memory,
  );
}

async function digestKey(parts: string[]): Promise<string> {
  return sha256Hex(new TextEncoder().encode(parts.join('\0')));
}

export async function enforceRateLimit(
  limiter: RateLimiter,
  keyParts: string[],
  limit: number,
  windowMs: number,
): Promise<void> {
  const key = await digestKey(keyParts);
  const ok = await limiter.take(key, limit, windowMs, keyParts[0]);
  if (!ok) {
    throw new ApiError(PublisherApiErrorCode.RateLimited, 'Rate limit exceeded. Try again later.', {
      retryAfterSeconds: RATE_LIMITS.retryAfterSeconds,
    });
  }
}

export { RATE_LIMITS };
