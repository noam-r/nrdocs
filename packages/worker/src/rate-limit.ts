import { RATE_LIMITS } from './limits.js';
import { ApiError } from './http.js';
import { PublisherApiErrorCode, sha256Hex } from '@nrdocs/contracts';

export type RateLimiter = {
  take(key: string, limit: number, windowMs: number): Promise<boolean>;
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
  const ok = await limiter.take(key, limit, windowMs);
  if (!ok) {
    throw new ApiError(PublisherApiErrorCode.RateLimited, 'Rate limit exceeded. Try again later.', {
      retryAfterSeconds: RATE_LIMITS.retryAfterSeconds,
    });
  }
}

export { RATE_LIMITS };
