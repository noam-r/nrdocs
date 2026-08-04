import { describe, expect, it } from 'vitest';
import {
  formatId,
  formatRfc3339,
  type ArtifactId,
  type InstanceDescriptor,
  type InstanceId,
  type LockId,
  type SiteId,
  type TokenRecordId,
} from '@nrdocs/contracts';
import {
  PersistenceError,
  acquirePublishLock,
  applyMigrations,
  artifactPrefix,
  assertDescriptorConsistency,
  beginSiteDeletion,
  changeSitePassword,
  cleanupOrphanPrefix,
  createD1Executor,
  createD1HttpExecutor,
  createSiteWithInitialToken,
  createSqliteExecutor,
  deleteSitePrefix,
  finalizeSiteDeletion,
  getInstanceMetadata,
  getSiteById,
  insertInstanceMetadata,
  inspectSiteDeletionState,
  issueToken,
  listTokensForSite,
  MemoryArtifactStore,
  openMemorySqlite,
  promoteArtifact,
  releasePublishLock,
  renewPublishLock,
  revokeToken,
  setSiteAccessPassword,
  setSiteAccessPublic,
  setSiteEnabled,
  sitePrefix,
  sqliteAsD1Database,
  sqliteAsD1HttpClient,
  writeStagingArtifact,
  type SqlExecutor,
} from './index.js';

function id16(seed: number): Uint8Array {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = (seed + i * 17) & 0xff;
  return bytes;
}

const INST = formatId('inst', id16(1)) as InstanceId;
const SITE = formatId('site', id16(2)) as SiteId;
const SITE_B = formatId('site', id16(3)) as SiteId;
const TOK = formatId('tok', id16(4)) as TokenRecordId;
const TOK2 = formatId('tok', id16(5)) as TokenRecordId;
const LOCK_A = formatId('lock', id16(6)) as LockId;
const LOCK_B = formatId('lock', id16(7)) as LockId;
const ART_A = formatId('artifact', id16(8)) as ArtifactId;
const ART_B = formatId('artifact', id16(9)) as ArtifactId;

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const TOKEN_VERIFIER_A = `sha256:${'c'.repeat(64)}`;
const TOKEN_VERIFIER_B = `sha256:${'d'.repeat(64)}`;
const TOKEN_VERIFIER_C = `sha256:${'e'.repeat(64)}`;
const PASSWORD_VERIFIER =
  'pbkdf2-sha256$600000$abcdefghijklmnopqrstuv$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

function publication(artifactId: ArtifactId, digest: string) {
  return {
    artifact_id: artifactId,
    artifact_digest: digest,
    root_route: '/',
    language: 'en',
    direction: 'ltr' as const,
    page_count: 1,
    asset_count: 0,
    attachment_count: 0,
  };
}

async function seededDb(wrap: (exec: SqlExecutor) => SqlExecutor = (e) => e): Promise<SqlExecutor> {
  const { executor } = openMemorySqlite();
  const db = wrap(executor);
  await applyMigrations(db, new Date('2026-01-01T00:00:00Z'));
  await insertInstanceMetadata(db, {
    id: INST,
    display_name: 'docs-prod',
    account_id: 'acct',
    resource_suffix: 'sfx1',
    canonical_origin: 'https://docs.example.com',
    deployed_version: '2.0.0',
    created_at: new Date('2026-01-01T00:00:00Z'),
  });
  await createSiteWithInitialToken(db, {
    id: SITE,
    slug: 'handbook',
    access_mode: 'public',
    now: new Date('2026-01-01T00:01:00Z'),
    initialToken: {
      id: TOK,
      name: 'bootstrap',
      token_verifier: TOKEN_VERIFIER_A,
    },
  });
  return db;
}

function runSuite(label: string, wrap: (exec: SqlExecutor) => SqlExecutor) {
  describe(`persistence conformance (${label})`, () => {
    it('enforces instance singleton and descriptor consistency', async () => {
      const db = await seededDb(wrap);
      const meta = await getInstanceMetadata(db);
      expect(meta.display_name).toBe('docs-prod');

      await expect(
        insertInstanceMetadata(db, {
          id: formatId('inst', id16(99)) as InstanceId,
          display_name: 'other',
          account_id: 'a',
          resource_suffix: 'sfx2',
          canonical_origin: 'https://other.example.com',
          deployed_version: '2.0.0',
        }),
      ).rejects.toBeInstanceOf(PersistenceError);

      const descriptor: InstanceDescriptor = {
        instance_id: INST,
        display_name: 'docs-prod',
        canonical_origin: 'https://docs.example.com',
        account_id: 'acct',
        resource_suffix: 'sfx1',
        database_id: 'db',
        bucket_name: 'bucket',
        worker_name: 'worker',
        status: 'active',
        deployed_version: '2.0.0',
        reconciliation: {},
      };
      await assertDescriptorConsistency(db, descriptor);

      await expect(
        assertDescriptorConsistency(db, { ...descriptor, display_name: 'wrong' }),
      ).rejects.toMatchObject({ code: 'descriptor_mismatch' });
    });

    it('rejects invalid access and publication tuples at the SQL boundary', async () => {
      const { executor } = openMemorySqlite();
      const db = wrap(executor);
      await applyMigrations(db);
      await insertInstanceMetadata(db, {
        id: INST,
        display_name: 'x',
        account_id: 'a',
        resource_suffix: 's',
        canonical_origin: 'https://docs.example.com',
        deployed_version: '2.0.0',
      });

      await expect(
        db.run(
          `INSERT INTO sites (
            id, slug, enabled, access_mode, password_verifier, session_generation,
            created_at, updated_at
          ) VALUES (?, 'bad', 1, 'public', ?, 1, ?, ?)`,
          [SITE, PASSWORD_VERIFIER, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'],
        ),
      ).rejects.toBeInstanceOf(PersistenceError);

      await expect(
        db.run(
          `INSERT INTO sites (
            id, slug, enabled, access_mode, password_verifier, session_generation,
            current_artifact_id, current_artifact_digest, current_root_route,
            current_language, current_direction, current_page_count,
            current_asset_count, current_attachment_count, last_published_at,
            created_at, updated_at
          ) VALUES (?, 'partial', 1, 'public', NULL, 1, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
          [SITE, ART_A, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'],
        ),
      ).rejects.toBeInstanceOf(PersistenceError);
    });

    it('supports access-mode transitions and session generation bumps', async () => {
      const db = await seededDb(wrap);
      let site = await setSiteAccessPassword(
        db,
        SITE,
        PASSWORD_VERIFIER,
        new Date('2026-01-02T00:00:00Z'),
      );
      expect(site.access_mode).toBe('password');
      expect(site.session_generation).toBe(2);
      site = await changeSitePassword(
        db,
        SITE,
        PASSWORD_VERIFIER,
        new Date('2026-01-02T01:00:00Z'),
      );
      expect(site.session_generation).toBe(3);
      site = await setSiteAccessPublic(db, SITE, new Date('2026-01-02T02:00:00Z'));
      expect(site.access_mode).toBe('public');
      expect(site.password_verifier).toBeNull();
      expect(site.session_generation).toBe(4);
    });

    it('enforces token name uniqueness per site and cascades on delete', async () => {
      const db = await seededDb(wrap);
      await issueToken(db, {
        id: TOK2,
        site_id: SITE,
        name: 'ci',
        token_verifier: TOKEN_VERIFIER_B,
      });
      await expect(
        issueToken(db, {
          id: formatId('tok', id16(20)) as TokenRecordId,
          site_id: SITE,
          name: 'ci',
          token_verifier: TOKEN_VERIFIER_C,
        }),
      ).rejects.toBeInstanceOf(PersistenceError);

      await createSiteWithInitialToken(db, {
        id: SITE_B,
        slug: 'other',
        access_mode: 'public',
        initialToken: {
          id: formatId('tok', id16(21)) as TokenRecordId,
          name: 'ci',
          token_verifier: TOKEN_VERIFIER_C,
        },
      });

      await beginSiteDeletion(db, SITE, new Date('2026-01-03T00:00:00Z'));
      expect(await finalizeSiteDeletion(db, SITE, new Date('2026-01-03T00:01:00Z'))).toBe(true);
      expect(await listTokensForSite(db, SITE)).toEqual([]);
      expect(await getSiteById(db, SITE)).toBeNull();
    });

    it('allows only one competing lock and supports stale reclaim', async () => {
      const db = await seededDb(wrap);
      const t0 = new Date('2026-01-04T00:00:00Z');
      const first = await acquirePublishLock(db, { siteId: SITE, lockId: LOCK_A, now: t0 });
      expect(first.ok).toBe(true);
      const second = await acquirePublishLock(db, {
        siteId: SITE,
        lockId: LOCK_B,
        now: new Date('2026-01-04T00:00:30Z'),
      });
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.retryAfterSeconds).toBeGreaterThanOrEqual(1);

      const reclaim = await acquirePublishLock(db, {
        siteId: SITE,
        lockId: LOCK_B,
        now: new Date('2026-01-04T00:02:01Z'),
      });
      expect(reclaim.ok).toBe(true);
      if (reclaim.ok) expect(reclaim.lockId).toBe(LOCK_B);
    });

    it('rejects wrong-owner release and promotion; closes revoke race', async () => {
      const db = await seededDb(wrap);
      const t0 = new Date('2026-01-05T00:00:00Z');
      await acquirePublishLock(db, { siteId: SITE, lockId: LOCK_A, now: t0 });
      expect(await releasePublishLock(db, { siteId: SITE, lockId: LOCK_B, now: t0 })).toBe(false);

      const rejected = await promoteArtifact(db, {
        siteId: SITE,
        lockId: LOCK_B,
        tokenId: TOK,
        publication: publication(ART_A, DIGEST_A),
        now: t0,
      });
      expect(rejected.result).toBe('rejected');

      await revokeToken(db, TOK, new Date('2026-01-05T00:00:10Z'));
      const raced = await promoteArtifact(db, {
        siteId: SITE,
        lockId: LOCK_A,
        tokenId: TOK,
        publication: publication(ART_A, DIGEST_A),
        now: new Date('2026-01-05T00:00:11Z'),
      });
      expect(raced.result).toBe('rejected');
      const site = await getSiteById(db, SITE);
      expect(site?.current_artifact_id).toBeNull();
    });

    it('promotes conditionally, preserves pointer on failure, and handles unchanged digest', async () => {
      const db = await seededDb(wrap);
      const t0 = new Date('2026-01-06T00:00:00Z');
      await acquirePublishLock(db, { siteId: SITE, lockId: LOCK_A, now: t0 });
      await setSiteEnabled(db, SITE, false, t0);

      const published = await promoteArtifact(db, {
        siteId: SITE,
        lockId: LOCK_A,
        tokenId: TOK,
        publication: publication(ART_A, DIGEST_A),
        now: t0,
      });
      expect(published.result).toBe('published');
      if (published.result === 'published') {
        expect(published.site.current_artifact_digest).toBe(DIGEST_A);
        expect(published.site.enabled).toBe(false);
        expect(published.site.publish_lock_id).toBeNull();
        expect(published.site.current_language).toBe('en');
        expect(published.site.current_direction).toBe('ltr');
      }

      const before = (await getSiteById(db, SITE))!;
      await acquirePublishLock(db, {
        siteId: SITE,
        lockId: LOCK_B,
        now: new Date('2026-01-06T00:01:00Z'),
      });
      const failed = await promoteArtifact(db, {
        siteId: SITE,
        lockId: LOCK_A,
        tokenId: TOK,
        publication: publication(ART_B, DIGEST_B),
        now: new Date('2026-01-06T00:01:00Z'),
      });
      expect(failed.result).toBe('rejected');
      expect((await getSiteById(db, SITE))!.current_artifact_digest).toBe(
        before.current_artifact_digest,
      );

      await releasePublishLock(db, {
        siteId: SITE,
        lockId: LOCK_B,
        now: new Date('2026-01-06T00:01:30Z'),
      });
      await acquirePublishLock(db, {
        siteId: SITE,
        lockId: LOCK_A,
        now: new Date('2026-01-06T00:02:00Z'),
      });
      const unchanged = await promoteArtifact(db, {
        siteId: SITE,
        lockId: LOCK_A,
        tokenId: TOK,
        publication: publication(ART_A, DIGEST_A),
        now: new Date('2026-01-06T00:02:00Z'),
      });
      expect(unchanged.result).toBe('unchanged');
      if (unchanged.result === 'unchanged') {
        expect(unchanged.site.last_published_at).toBe(before.last_published_at);
        expect(unchanged.site.current_artifact_id).toBe(ART_A);
      }
    });

    it('deletion start disables/revokes and final delete waits for lock expiry', async () => {
      const db = await seededDb(wrap);
      const t0 = new Date('2026-01-07T00:00:00Z');
      await acquirePublishLock(db, { siteId: SITE, lockId: LOCK_A, now: t0 });
      await beginSiteDeletion(db, SITE, new Date('2026-01-07T00:00:10Z'));
      const mid = await inspectSiteDeletionState(db, SITE, new Date('2026-01-07T00:00:20Z'));
      expect(mid.site?.enabled).toBe(false);
      expect(mid.usableTokenCount).toBe(0);
      expect(mid.lockActive).toBe(true);
      expect(mid.readyForFinalDelete).toBe(false);
      expect(await finalizeSiteDeletion(db, SITE, new Date('2026-01-07T00:00:20Z'))).toBe(false);

      const ready = await inspectSiteDeletionState(db, SITE, new Date('2026-01-07T00:02:11Z'));
      expect(ready.readyForFinalDelete).toBe(true);
      expect(await finalizeSiteDeletion(db, SITE, new Date('2026-01-07T00:02:11Z'))).toBe(true);
    });

    it('renews near expiry and stops at hard lifetime', async () => {
      const db = await seededDb(wrap);
      const acquiredAt = new Date('2026-01-08T00:00:00Z');
      await acquirePublishLock(db, { siteId: SITE, lockId: LOCK_A, now: acquiredAt });

      const tooEarly = await renewPublishLock(db, {
        siteId: SITE,
        lockId: LOCK_A,
        tokenId: TOK,
        now: new Date('2026-01-08T00:00:30Z'),
      });
      expect(tooEarly.ok).toBe(false);

      const renewed = await renewPublishLock(db, {
        siteId: SITE,
        lockId: LOCK_A,
        tokenId: TOK,
        now: new Date('2026-01-08T00:01:30Z'),
      });
      expect(renewed.ok).toBe(true);

      // Force acquired_at age past hard lifetime by reclaiming then manually aging is hard;
      // acquire at T, jump now to T+601s without reclaim by updating expires first via renew loop.
      // Directly assert hard lifetime rejection when now >= acquired + 600.
      const hard = await renewPublishLock(db, {
        siteId: SITE,
        lockId: LOCK_A,
        tokenId: TOK,
        now: new Date('2026-01-08T00:10:01Z'),
      });
      expect(hard.ok).toBe(false);
      if (!hard.ok) expect(hard.reason).toBe('hard_lifetime');
    });
  });
}

runSuite('sqlite', (e) => e);
runSuite('worker-d1-adapter', (sqlite) => createD1Executor(sqliteAsD1Database(sqlite)));
runSuite('cli-d1-http-adapter', (sqlite) => createD1HttpExecutor(sqliteAsD1HttpClient(sqlite)));

describe('R2 key and orphan cleanup', () => {
  it('uses opaque site/artifact prefixes and never deletes the current prefix', async () => {
    expect(sitePrefix(SITE)).toBe(`sites/${SITE}/`);
    expect(artifactPrefix(SITE, ART_A)).toBe(`sites/${SITE}/artifacts/${ART_A}/`);

    const store = new MemoryArtifactStore();
    await writeStagingArtifact(store, {
      siteId: SITE,
      artifactId: ART_A,
      objects: [{ path: 'nrdocs-manifest.json', body: new TextEncoder().encode('{}') }],
    });
    await writeStagingArtifact(store, {
      siteId: SITE,
      artifactId: ART_B,
      objects: [{ path: 'nrdocs-manifest.json', body: new TextEncoder().encode('{}') }],
    });

    const skipped = await cleanupOrphanPrefix(store, {
      siteId: SITE,
      candidateArtifactId: ART_A,
      currentArtifactId: ART_A,
    });
    expect(skipped.skipped).toBe(true);
    expect(await store.get(`${artifactPrefix(SITE, ART_A)}nrdocs-manifest.json`)).not.toBeNull();

    const cleaned = await cleanupOrphanPrefix(store, {
      siteId: SITE,
      candidateArtifactId: ART_B,
      currentArtifactId: ART_A,
    });
    expect(cleaned.skipped).toBe(false);
    expect(await store.get(`${artifactPrefix(SITE, ART_B)}nrdocs-manifest.json`)).toBeNull();

    const wiped = await deleteSitePrefix(store, SITE);
    expect(wiped.empty).toBe(true);
  });
});

describe('sqlite adapter smoke', () => {
  it('opens memory db and applies migrations idempotently', async () => {
    const { db, executor } = openMemorySqlite();
    expect(createSqliteExecutor(db)).toBeTruthy();
    await applyMigrations(executor);
    await applyMigrations(executor);
    expect(formatRfc3339(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01T00:00:00Z');
  });
});
