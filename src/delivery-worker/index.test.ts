import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from './index';
import { D1DataStore } from '../data-store/d1-data-store';
import { R2StorageProvider } from '../storage/r2-storage-provider';
import { PasswordHasher } from '../auth/password-hasher';
import { SessionTokenManager } from '../auth/session-token-manager';
import { RateLimiter } from '../auth/rate-limiter';
import type { Repo } from '../types';

function makeEnv(): Parameters<typeof worker.fetch>[1] {
  return {
    DB: {} as unknown as D1Database,
    BUCKET: {} as unknown as R2Bucket,
    HMAC_SIGNING_KEY: 'hmac',
    SESSION_TTL: '28800',
    CACHE_TTL: '300',
    RATE_LIMIT_MAX: '5',
    RATE_LIMIT_WINDOW: '300',
  };
}

function baseRepo(overrides: Partial<Repo> = {}): Repo {
  const now = new Date().toISOString();
  return {
    id: 'p1',
    slug: 'reflexio',
    repo_url: 'https://github.com/noam-r/reflexio',
    title: 'Reflexio',
    description: '',
    status: 'approved',
    access_mode: 'public',
    active_publish_pointer: 'publishes/reflexio/pub-1/',
    password_hash: null,
    password_version: 1,
    repo_identity: 'github.com/noam-r/reflexio',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('Delivery Worker — platform homepage (GET /)', () => {
  const originalGet = R2StorageProvider.prototype.get;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    R2StorageProvider.prototype.get = originalGet;
  });

  it('serves site/index.html at / by default', async () => {
    vi.spyOn(D1DataStore.prototype, 'getRepoBySlug');
    R2StorageProvider.prototype.get = vi.fn(async (key: string) => {
      if (key === 'site/index.html') {
        return { content: new TextEncoder().encode('<h1>Home</h1>'), contentType: 'text/html; charset=utf-8' };
      }
      return null;
    }) as unknown as typeof R2StorageProvider.prototype.get;

    const res = await worker.fetch(new Request('https://docs.example/'), makeEnv(), {} as ExecutionContext);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Home');
    expect(D1DataStore.prototype.getRepoBySlug).not.toHaveBeenCalled();
  });

  it('returns 404 on / when HOME_PAGE_R2_KEY is empty', async () => {
    vi.spyOn(D1DataStore.prototype, 'getRepoBySlug');
    R2StorageProvider.prototype.get = vi.fn(async () => null) as unknown as typeof R2StorageProvider.prototype.get;

    const res = await worker.fetch(
      new Request('https://docs.example/'),
      { ...makeEnv(), HOME_PAGE_R2_KEY: '' },
      {} as ExecutionContext,
    );

    expect(res.status).toBe(404);
    expect(D1DataStore.prototype.getRepoBySlug).not.toHaveBeenCalled();
  });
});

describe('Delivery Worker — site slug routing', () => {
  const originalGet = R2StorageProvider.prototype.get;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    R2StorageProvider.prototype.get = originalGet;
  });

  it('serves /{site-slug}/… from flat R2 prefix publishes/<slug>/<publishId>/', async () => {
    vi.spyOn(D1DataStore.prototype, 'getRepoBySlug').mockResolvedValue(baseRepo());

    R2StorageProvider.prototype.get = vi.fn(async (key: string) => {
      if (key === 'publishes/reflexio/pub-1/home/index.html') {
        return { content: new Uint8Array([1, 2, 3]), contentType: 'text/html; charset=utf-8' };
      }
      return null;
    }) as unknown as typeof R2StorageProvider.prototype.get;

    const res = await worker.fetch(
      new Request('https://docs.example/reflexio/home/'),
      makeEnv(),
      {} as ExecutionContext,
    );

    expect(res.status).toBe(200);
    expect(D1DataStore.prototype.getRepoBySlug).toHaveBeenCalledWith('reflexio');
  });

  it('returns 404 when no repo is registered for the first path segment', async () => {
    vi.spyOn(D1DataStore.prototype, 'getRepoBySlug').mockResolvedValue(null);

    R2StorageProvider.prototype.get = vi.fn(async () => null) as unknown as typeof R2StorageProvider.prototype.get;

    const res = await worker.fetch(
      new Request('https://docs.example/unknown-site/home/'),
      makeEnv(),
      {} as ExecutionContext,
    );

    expect(res.status).toBe(404);
    expect(D1DataStore.prototype.getRepoBySlug).toHaveBeenCalledWith('unknown-site');
  });
});

describe('Delivery Worker — password site without HMAC', () => {
  it('returns 503 when HMAC_SIGNING_KEY is empty', async () => {
    vi.spyOn(D1DataStore.prototype, 'getRepoBySlug').mockResolvedValue(
      baseRepo({ access_mode: 'password' }),
    );
    const res = await worker.fetch(
      new Request('https://docs.example/reflexio/'),
      { ...makeEnv(), HMAC_SIGNING_KEY: '' },
      {} as ExecutionContext,
    );
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('HMAC_SIGNING_KEY');
  });
});

describe('Delivery Worker — password session cookie', () => {
  const originalGet = R2StorageProvider.prototype.get;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    R2StorageProvider.prototype.get = originalGet;
  });

  it('redirects GET site root without trailing slash to /slug/ (308)', async () => {
    vi.spyOn(D1DataStore.prototype, 'getRepoBySlug').mockResolvedValue(
      baseRepo({ access_mode: 'password' }),
    );
    const res = await worker.fetch(
      new Request('https://docs.example/reflexio', { method: 'GET' }),
      makeEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(308);
    expect(res.headers.get('Location')).toBe('https://docs.example/reflexio/');
  });

  it('omits Secure and uses Path=/slug on http so browsers store the cookie (wrangler dev)', async () => {
    const hash = await PasswordHasher.hash('testpass');
    vi.spyOn(D1DataStore.prototype, 'getRepoBySlug').mockResolvedValue(
      baseRepo({ access_mode: 'password' }),
    );
    vi.spyOn(D1DataStore.prototype, 'getPasswordHash').mockResolvedValue({ hash, version: 1 });
    vi.spyOn(RateLimiter.prototype, 'checkAndIncrement').mockResolvedValue({ allowed: true });
    vi.spyOn(D1DataStore.prototype, 'recordEvent').mockResolvedValue(undefined);

    const res = await worker.fetch(
      new Request('http://127.0.0.1:8788/reflexio/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=testpass',
      }),
      makeEnv(),
      {} as ExecutionContext,
    );

    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('http://127.0.0.1:8788/reflexio/');
    expect(setCookie).not.toContain('Secure');
    expect(setCookie).toContain('Path=/reflexio');
    expect(setCookie).not.toContain('Path=/reflexio/');
  });

  it('POST login from /slug without trailing slash redirects Location to /slug/', async () => {
    const hash = await PasswordHasher.hash('testpass');
    vi.spyOn(D1DataStore.prototype, 'getRepoBySlug').mockResolvedValue(
      baseRepo({ access_mode: 'password' }),
    );
    vi.spyOn(D1DataStore.prototype, 'getPasswordHash').mockResolvedValue({ hash, version: 1 });
    vi.spyOn(RateLimiter.prototype, 'checkAndIncrement').mockResolvedValue({ allowed: true });
    vi.spyOn(D1DataStore.prototype, 'recordEvent').mockResolvedValue(undefined);

    const res = await worker.fetch(
      new Request('http://127.0.0.1:8788/reflexio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=testpass',
      }),
      makeEnv(),
      {} as ExecutionContext,
    );

    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('http://127.0.0.1:8788/reflexio/');
  });

  it('includes Secure on https', async () => {
    const hash = await PasswordHasher.hash('testpass');
    vi.spyOn(D1DataStore.prototype, 'getRepoBySlug').mockResolvedValue(
      baseRepo({ access_mode: 'password' }),
    );
    vi.spyOn(D1DataStore.prototype, 'getPasswordHash').mockResolvedValue({ hash, version: 1 });
    vi.spyOn(RateLimiter.prototype, 'checkAndIncrement').mockResolvedValue({ allowed: true });
    vi.spyOn(D1DataStore.prototype, 'recordEvent').mockResolvedValue(undefined);

    const res = await worker.fetch(
      new Request('https://docs.example/reflexio/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=testpass',
      }),
      makeEnv(),
      {} as ExecutionContext,
    );

    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('https://docs.example/reflexio/');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('Path=/reflexio');
  });

  it('accepts session cookie when token repo id differs only by UUID letter case', async () => {
    const idLower = '1f20a1f4-4fbf-4f9a-acd3-f4a958032449';
    const idUpper = '1F20A1F4-4FBF-4F9A-ACD3-F4A958032449';
    vi.spyOn(D1DataStore.prototype, 'getRepoBySlug').mockResolvedValue(
      baseRepo({ id: idLower, access_mode: 'password' }),
    );
    R2StorageProvider.prototype.get = vi.fn(async (key: string) => {
      if (key.endsWith('index.html')) {
        return { content: new Uint8Array([60]), contentType: 'text/html; charset=utf-8' };
      }
      return null;
    }) as unknown as typeof R2StorageProvider.prototype.get;

    const token = await SessionTokenManager.create(idUpper, 1, 'hmac', 3600);
    const res = await worker.fetch(
      new Request(`https://docs.example/reflexio/`, {
        headers: { Cookie: `nrdocs_session=${token}` },
      }),
      makeEnv(),
      {} as ExecutionContext,
    );

    expect(res.status).toBe(200);
  });
});
