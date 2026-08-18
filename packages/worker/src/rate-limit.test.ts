import { describe, expect, it, vi } from 'vitest';
import {
  CloudflareBindingRateLimiter,
  CompositeRateLimiter,
  MemoryRateLimiter,
  createCompositeRateLimiter,
  enforceRateLimit,
} from './rate-limit.js';
import { ApiError } from './http.js';
import { PublisherApiErrorCode } from '@nrdocs/contracts';

describe('rate limiters', () => {
  it('MemoryRateLimiter enforces a sliding window', async () => {
    const limiter = new MemoryRateLimiter();
    expect(await limiter.take('k', 2, 60_000)).toBe(true);
    expect(await limiter.take('k', 2, 60_000)).toBe(true);
    expect(await limiter.take('k', 2, 60_000)).toBe(false);
  });

  it('CloudflareBindingRateLimiter prefers binding.limit', async () => {
    const binding = {
      limit: vi.fn(async () => ({ success: false })),
    };
    const limiter = new CloudflareBindingRateLimiter(binding);
    expect(await limiter.take('hashed', 10, 60_000)).toBe(false);
    expect(binding.limit).toHaveBeenCalledWith({ key: 'hashed' });
  });

  it('CompositeRateLimiter routes by operation to CF bindings', async () => {
    const binding = {
      limit: vi.fn(async () => ({ success: true })),
    };
    const memory = new MemoryRateLimiter();
    const composite = new CompositeRateLimiter(
      { api: new CloudflareBindingRateLimiter(binding) },
      memory,
    );
    expect(await composite.take('k', 1, 60_000, 'api')).toBe(true);
    expect(binding.limit).toHaveBeenCalledWith({ key: 'k' });
    // Unknown operation falls back to memory.
    expect(await composite.take('m', 1, 60_000, 'other')).toBe(true);
    expect(await composite.take('m', 1, 60_000, 'other')).toBe(false);
  });

  it('CompositeRateLimiter falls back to memory when binding throws', async () => {
    const binding = {
      limit: vi.fn(async () => {
        throw new Error('binding unavailable');
      }),
    };
    const memory = new MemoryRateLimiter();
    const composite = new CompositeRateLimiter(
      { 'pwd-ip': new CloudflareBindingRateLimiter(binding) },
      memory,
    );
    expect(await composite.take('k', 1, 60_000, 'pwd-ip')).toBe(true);
    expect(await composite.take('k', 1, 60_000, 'pwd-ip')).toBe(false);
    expect(binding.limit).toHaveBeenCalled();
  });

  it('createCompositeRateLimiter maps env bindings', async () => {
    const binding = {
      limit: vi.fn(async () => ({ success: false })),
    };
    const limiter = createCompositeRateLimiter({ INSTANCE_API_LIMIT: binding });
    await expect(enforceRateLimit(limiter, ['api', '1.2.3.4'], 300, 60_000)).rejects.toMatchObject({
      code: PublisherApiErrorCode.RateLimited,
    } satisfies Partial<ApiError>);
    expect(binding.limit).toHaveBeenCalled();
  });
});
