import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from './index';
import { D1DataStore } from '../data-store/d1-data-store';
import { R2StorageProvider } from '../storage/r2-storage-provider';

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

describe('Delivery Worker routing disambiguation', () => {
  const original = {
    getProject: D1DataStore.prototype.getProjectByOrgSlugAndProjectSlug,
    getObject: R2StorageProvider.prototype.get,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    D1DataStore.prototype.getProjectByOrgSlugAndProjectSlug = original.getProject;
    R2StorageProvider.prototype.get = original.getObject;
  });

  it('falls back to default-org /<project>/<page>/ when /<org>/<project>/ does not exist', async () => {
    const calls: Array<[string, string]> = [];
    D1DataStore.prototype.getProjectByOrgSlugAndProjectSlug = vi.fn(async (org: string, proj: string) => {
      calls.push([org, proj]);
      if (org === 'default' && proj === 'reflexio') {
        return {
          id: 'p1',
          slug: 'reflexio',
          org_id: 'o1',
          repo_url: 'https://github.com/noam-r/reflexio',
          title: 'Reflexio',
          description: '',
          status: 'approved',
          access_mode: 'public',
          active_publish_pointer: 'publishes/default/reflexio/pub-1/',
          password_hash: null,
          password_version: 1,
          repo_identity: 'github.com/noam-r/reflexio',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
      return null;
    }) as unknown as typeof D1DataStore.prototype.getProjectByOrgSlugAndProjectSlug;

    R2StorageProvider.prototype.get = vi.fn(async (key: string) => {
      if (key === 'publishes/default/reflexio/pub-1/home/index.html') {
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
    expect(calls[0]).toEqual(['reflexio', 'home']); // explicit org/project probe
    expect(calls[1]).toEqual(['default', 'reflexio']); // fallback
  });

  it('uses explicit org route when /<org>/<project>/ exists', async () => {
    const calls: Array<[string, string]> = [];
    D1DataStore.prototype.getProjectByOrgSlugAndProjectSlug = vi.fn(async (org: string, proj: string) => {
      calls.push([org, proj]);
      if (org === 'acme' && proj === 'docs') {
        return {
          id: 'p2',
          slug: 'docs',
          org_id: 'o2',
          repo_url: 'https://github.com/acme/docs',
          title: 'Docs',
          description: '',
          status: 'approved',
          access_mode: 'public',
          active_publish_pointer: 'publishes/acme/docs/pub-2/',
          password_hash: null,
          password_version: 1,
          repo_identity: 'github.com/acme/docs',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
      return null;
    }) as unknown as typeof D1DataStore.prototype.getProjectByOrgSlugAndProjectSlug;

    R2StorageProvider.prototype.get = vi.fn(async (key: string) => {
      if (key === 'publishes/acme/docs/pub-2/home/index.html') {
        return { content: new Uint8Array([9]), contentType: 'text/html; charset=utf-8' };
      }
      return null;
    }) as unknown as typeof R2StorageProvider.prototype.get;

    const res = await worker.fetch(
      new Request('https://docs.example/acme/docs/home/'),
      makeEnv(),
      {} as ExecutionContext,
    );

    expect(res.status).toBe(200);
    expect(calls).toEqual([['acme', 'docs']]); // no fallback probe
  });
});

