import { describe, expect, it, vi } from 'vitest';
import { waitForOriginSmoke } from './cloudflare.js';

describe('waitForOriginSmoke', () => {
  it('returns on first 200/200', async () => {
    const smokeGet = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, body: '{"ok":true}' })
      .mockResolvedValueOnce({ status: 200, body: 'nrdocs' });
    const result = await waitForOriginSmoke(smokeGet, 'https://example.workers.dev', {
      attempts: 3,
      delayMs: 1,
    });
    expect(result.version.status).toBe(200);
    expect(result.root.status).toBe(200);
    expect(result.attempts).toHaveLength(1);
    expect(smokeGet).toHaveBeenCalledTimes(2);
  });

  it('retries through HTML 404 then succeeds', async () => {
    const smokeGet = vi
      .fn()
      .mockResolvedValueOnce({ status: 404, body: 'Page not found' })
      .mockResolvedValueOnce({ status: 404, body: 'Page not found' })
      .mockResolvedValueOnce({ status: 200, body: '{"ok":true}' })
      .mockResolvedValueOnce({ status: 200, body: 'nrdocs' });
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const result = await waitForOriginSmoke(smokeGet, 'https://example.workers.dev', {
      attempts: 5,
      delayMs: 1,
      onRetry,
    });
    expect(result.version.status).toBe(200);
    expect(result.attempts).toHaveLength(2);
    expect(onRetry).toHaveBeenCalled();
  });

  it('retries a few DNS misses then succeeds', async () => {
    const smokeGet = vi
      .fn()
      .mockResolvedValueOnce({ status: 0, body: '' })
      .mockResolvedValueOnce({ status: 0, body: '' })
      .mockResolvedValueOnce({ status: 0, body: '' })
      .mockResolvedValueOnce({ status: 0, body: '' })
      .mockResolvedValueOnce({ status: 200, body: '{"ok":true}' })
      .mockResolvedValueOnce({ status: 200, body: 'nrdocs' });
    const result = await waitForOriginSmoke(smokeGet, 'https://docs.example.com', {
      attempts: 10,
      delayMs: 1,
      maxConsecutiveDnsMisses: 8,
    });
    expect(result.version.status).toBe(200);
    expect(result.attempts).toHaveLength(3);
  });

  it('stops after several consecutive hard network failures', async () => {
    const smokeGet = vi.fn().mockResolvedValue({ status: 0, body: '' });
    const result = await waitForOriginSmoke(smokeGet, 'https://example.workers.dev', {
      attempts: 20,
      delayMs: 1,
      maxConsecutiveDnsMisses: 3,
    });
    expect(result.version.status).toBe(0);
    expect(result.attempts).toHaveLength(3);
  });
});
