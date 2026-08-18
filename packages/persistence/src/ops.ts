import {
  assertDirection,
  assertLanguage,
  formatRfc3339,
  normalizeDisplayName,
  parseArtifactId,
  parseHttpsServerUrl,
  parseInstanceId,
  parseLockId,
  parseSha256Digest,
  parseSiteId,
  parseSlug,
  parseTokenRecordId,
  type InstanceDescriptor,
  type InstanceId,
  type LockId,
  type SiteId,
  type TokenRecordId,
} from '@nrdocs/contracts';
import {
  PUBLISH_LOCK_HARD_LIFETIME_SECONDS,
  PUBLISH_LOCK_LEASE_SECONDS,
  PUBLISH_LOCK_RENEW_THRESHOLD_SECONDS,
  SCHEMA_VERSION,
  TOKEN_LAST_USED_MIN_INTERVAL_SECONDS,
} from './constants.js';
import {
  PersistenceError,
  constraintFailure,
  conflict,
  descriptorMismatch,
  invariantFailure,
  notFound,
} from './errors.js';
import {
  decodeInstanceMetadata,
  decodePublishingToken,
  decodeSite,
  isTokenUsable,
} from './decode.js';
import type { SqlExecutor } from './sql.js';
import type {
  AccessMode,
  CurrentPublicationInput,
  InstanceMetadataRow,
  PublishingTokenRow,
  SiteRow,
} from './types.js';
import { assertPasswordVerifier, assertTokenVerifier } from './verifiers.js';

function nowIso(now: Date): string {
  return formatRfc3339(now);
}

function addSeconds(iso: string, seconds: number): string {
  const d = new Date(Date.parse(iso));
  d.setUTCSeconds(d.getUTCSeconds() + seconds);
  return formatRfc3339(d);
}

function secondsBetween(laterIso: string, earlierIso: string): number {
  return Math.floor((Date.parse(laterIso) - Date.parse(earlierIso)) / 1000);
}

// --- Instance metadata -------------------------------------------------------

export async function insertInstanceMetadata(
  db: SqlExecutor,
  input: {
    id: InstanceId;
    display_name: string;
    account_id: string;
    resource_suffix: string;
    canonical_origin: string;
    deployed_version: string;
    created_at?: Date;
  },
): Promise<InstanceMetadataRow> {
  const id = parseInstanceId(input.id);
  if (!id) throw constraintFailure('invalid instance id');
  const display_name = normalizeDisplayName(input.display_name);
  if (!display_name) throw constraintFailure('invalid display_name');
  const canonical_origin = parseHttpsServerUrl(input.canonical_origin);
  if (!canonical_origin) throw constraintFailure('invalid canonical_origin');
  const created_at = nowIso(input.created_at ?? new Date());

  try {
    await db.run(
      `INSERT INTO instance_metadata (
        id, display_name, account_id, resource_suffix, canonical_origin,
        deployed_version, schema_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        display_name,
        input.account_id.trim(),
        input.resource_suffix.trim(),
        canonical_origin,
        input.deployed_version.trim(),
        SCHEMA_VERSION,
        created_at,
      ],
    );
  } catch (error) {
    throw constraintFailure(
      error instanceof Error ? error.message : 'failed to insert instance_metadata',
    );
  }

  return getInstanceMetadata(db);
}

export async function getInstanceMetadata(db: SqlExecutor): Promise<InstanceMetadataRow> {
  const row = await db.one(`SELECT * FROM instance_metadata LIMIT 2`);
  if (!row) throw notFound('instance_metadata row is missing');
  const count = await db.one(`SELECT COUNT(*) AS c FROM instance_metadata`);
  if (Number(count?.c) !== 1)
    throw invariantFailure('instance_metadata must contain exactly one row');
  return decodeInstanceMetadata(row);
}

export async function updateInstanceCanonicalOrigin(
  db: SqlExecutor,
  canonical_origin: string,
): Promise<InstanceMetadataRow> {
  const origin = parseHttpsServerUrl(canonical_origin);
  if (!origin) throw constraintFailure('invalid canonical_origin');
  await db.run(`UPDATE instance_metadata SET canonical_origin = ?`, [origin]);
  return getInstanceMetadata(db);
}

export async function assertDescriptorConsistency(
  db: SqlExecutor,
  descriptor: InstanceDescriptor,
): Promise<InstanceMetadataRow> {
  const meta = await getInstanceMetadata(db);
  if (meta.id !== descriptor.instance_id || meta.display_name !== descriptor.display_name) {
    throw descriptorMismatch(
      'Local instance descriptor does not match D1 instance_metadata (id/display_name).',
    );
  }
  return meta;
}

// --- Sites -------------------------------------------------------------------

export type CreateSiteInput = {
  id: SiteId;
  slug: string;
  access_mode: AccessMode;
  password_verifier?: string | null;
  now?: Date;
  initialToken: {
    id: TokenRecordId;
    name: string;
    token_verifier: string;
    expires_at?: string | null;
  };
};

export async function createSiteWithInitialToken(
  db: SqlExecutor,
  input: CreateSiteInput,
): Promise<{ site: SiteRow; token: PublishingTokenRow }> {
  const id = parseSiteId(input.id);
  if (!id) throw constraintFailure('invalid site id');
  const slug = parseSlug(input.slug);
  if (!slug) throw constraintFailure('invalid or reserved slug');
  const ts = nowIso(input.now ?? new Date());

  let password_verifier: string | null = null;
  if (input.access_mode === 'password') {
    password_verifier = assertPasswordVerifier(input.password_verifier);
  } else if (input.password_verifier) {
    throw constraintFailure('public sites must not have a password_verifier');
  }

  const tokenId = parseTokenRecordId(input.initialToken.id);
  if (!tokenId) throw constraintFailure('invalid token id');
  const tokenName = normalizeDisplayName(input.initialToken.name);
  if (!tokenName) throw constraintFailure('invalid token name');
  const tokenVerifier = assertTokenVerifier(input.initialToken.token_verifier);

  return db.transaction(async (tx) => {
    try {
      const taken = await tx.one(`SELECT id FROM sites WHERE slug = ?`, [slug]);
      if (taken) throw conflict('A site with this slug already exists.');
      await tx.run(
        `INSERT INTO sites (
          id, slug, enabled, access_mode, password_verifier, session_generation,
          current_artifact_id, current_artifact_digest, current_root_route,
          current_language, current_direction, current_page_count,
          current_asset_count, current_attachment_count, last_published_at,
          publish_lock_id, publish_lock_acquired_at, publish_lock_expires_at,
          created_at, updated_at
        ) VALUES (?, ?, 1, ?, ?, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
        [id, slug, input.access_mode, password_verifier, ts, ts],
      );
      await tx.run(
        `INSERT INTO publishing_tokens (
          id, site_id, name, token_verifier, expires_at, revoked_at, last_used_at, created_at
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
        [tokenId, id, tokenName, tokenVerifier, input.initialToken.expires_at ?? null, ts],
      );
    } catch (error) {
      if (error instanceof PersistenceError) throw error;
      throw constraintFailure(error instanceof Error ? error.message : 'site create failed');
    }
    const site = decodeSite((await tx.one(`SELECT * FROM sites WHERE id = ?`, [id]))!);
    const token = decodePublishingToken(
      (await tx.one(`SELECT * FROM publishing_tokens WHERE id = ?`, [tokenId]))!,
    );
    return { site, token };
  });
}

export async function getSiteById(db: SqlExecutor, siteId: SiteId): Promise<SiteRow | null> {
  const row = await db.one(`SELECT * FROM sites WHERE id = ?`, [siteId]);
  return row ? decodeSite(row) : null;
}

export async function getSiteBySlug(db: SqlExecutor, slug: string): Promise<SiteRow | null> {
  const parsed = parseSlug(slug);
  if (!parsed) return null;
  const row = await db.one(`SELECT * FROM sites WHERE slug = ?`, [parsed]);
  return row ? decodeSite(row) : null;
}

export async function listSites(db: SqlExecutor): Promise<SiteRow[]> {
  const rows = await db.many(`SELECT * FROM sites ORDER BY slug ASC`);
  return rows.map(decodeSite);
}

export async function renameSite(
  db: SqlExecutor,
  siteId: SiteId,
  newSlug: string,
  now: Date = new Date(),
): Promise<SiteRow> {
  const slug = parseSlug(newSlug);
  if (!slug) throw constraintFailure('invalid or reserved slug');
  const site = await getSiteById(db, siteId);
  if (!site) throw notFound('site not found');
  if (site.slug === slug) return site;
  const taken = await getSiteBySlug(db, slug);
  if (taken) throw conflict('A site with this slug already exists.');
  const ts = nowIso(now);
  const result = await db.run(`UPDATE sites SET slug = ?, updated_at = ? WHERE id = ?`, [
    slug,
    ts,
    siteId,
  ]);
  if (result.changes !== 1) throw notFound('site not found');
  return (await getSiteById(db, siteId))!;
}

export async function setSiteEnabled(
  db: SqlExecutor,
  siteId: SiteId,
  enabled: boolean,
  now: Date = new Date(),
): Promise<SiteRow> {
  const ts = nowIso(now);
  const result = await db.run(`UPDATE sites SET enabled = ?, updated_at = ? WHERE id = ?`, [
    enabled ? 1 : 0,
    ts,
    siteId,
  ]);
  if (result.changes !== 1) throw notFound('site not found');
  return (await getSiteById(db, siteId))!;
}

export async function setSiteAccessPublic(
  db: SqlExecutor,
  siteId: SiteId,
  now: Date = new Date(),
): Promise<SiteRow> {
  const ts = nowIso(now);
  const result = await db.run(
    `UPDATE sites
     SET access_mode = 'public',
         password_verifier = NULL,
         session_generation = session_generation + 1,
         updated_at = ?
     WHERE id = ?`,
    [ts, siteId],
  );
  if (result.changes !== 1) throw notFound('site not found');
  return (await getSiteById(db, siteId))!;
}

export async function setSiteAccessPassword(
  db: SqlExecutor,
  siteId: SiteId,
  passwordVerifier: string,
  now: Date = new Date(),
): Promise<SiteRow> {
  const verifier = assertPasswordVerifier(passwordVerifier);
  const ts = nowIso(now);
  const result = await db.run(
    `UPDATE sites
     SET access_mode = 'password',
         password_verifier = ?,
         session_generation = session_generation + 1,
         updated_at = ?
     WHERE id = ?`,
    [verifier, ts, siteId],
  );
  if (result.changes !== 1) throw notFound('site not found');
  return (await getSiteById(db, siteId))!;
}

export async function changeSitePassword(
  db: SqlExecutor,
  siteId: SiteId,
  passwordVerifier: string,
  now: Date = new Date(),
): Promise<SiteRow> {
  const verifier = assertPasswordVerifier(passwordVerifier);
  const ts = nowIso(now);
  const result = await db.run(
    `UPDATE sites
     SET password_verifier = ?,
         session_generation = session_generation + 1,
         updated_at = ?
     WHERE id = ? AND access_mode = 'password'`,
    [verifier, ts, siteId],
  );
  if (result.changes !== 1) throw notFound('password site not found');
  return (await getSiteById(db, siteId))!;
}

// --- Tokens ------------------------------------------------------------------

export async function issueToken(
  db: SqlExecutor,
  input: {
    id: TokenRecordId;
    site_id: SiteId;
    name: string;
    token_verifier: string;
    expires_at?: string | null;
    now?: Date;
  },
): Promise<PublishingTokenRow> {
  const id = parseTokenRecordId(input.id);
  if (!id) throw constraintFailure('invalid token id');
  const site_id = parseSiteId(input.site_id);
  if (!site_id) throw constraintFailure('invalid site id');
  const name = normalizeDisplayName(input.name);
  if (!name) throw constraintFailure('invalid token name');
  const token_verifier = assertTokenVerifier(input.token_verifier);
  const ts = nowIso(input.now ?? new Date());
  try {
    await db.run(
      `INSERT INTO publishing_tokens (
        id, site_id, name, token_verifier, expires_at, revoked_at, last_used_at, created_at
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
      [id, site_id, name, token_verifier, input.expires_at ?? null, ts],
    );
  } catch (error) {
    if (error instanceof PersistenceError) throw error;
    throw constraintFailure(error instanceof Error ? error.message : 'token issue failed');
  }
  return decodePublishingToken(
    (await db.one(`SELECT * FROM publishing_tokens WHERE id = ?`, [id]))!,
  );
}

export async function getTokenById(
  db: SqlExecutor,
  tokenId: TokenRecordId,
): Promise<PublishingTokenRow | null> {
  const row = await db.one(`SELECT * FROM publishing_tokens WHERE id = ?`, [tokenId]);
  return row ? decodePublishingToken(row) : null;
}

export async function getTokenByVerifier(
  db: SqlExecutor,
  tokenVerifier: string,
): Promise<PublishingTokenRow | null> {
  const verifier = assertTokenVerifier(tokenVerifier);
  const row = await db.one(`SELECT * FROM publishing_tokens WHERE token_verifier = ?`, [verifier]);
  return row ? decodePublishingToken(row) : null;
}

export async function listTokensForSite(
  db: SqlExecutor,
  siteId: SiteId,
): Promise<PublishingTokenRow[]> {
  const rows = await db.many(
    `SELECT * FROM publishing_tokens WHERE site_id = ? ORDER BY name ASC`,
    [siteId],
  );
  return rows.map(decodePublishingToken);
}

export async function findTokenByNameOrId(
  db: SqlExecutor,
  siteId: SiteId,
  nameOrId: string,
): Promise<PublishingTokenRow | null> {
  const byId = parseTokenRecordId(nameOrId);
  if (byId) {
    const row = await getTokenById(db, byId);
    if (row && row.site_id === siteId) return row;
  }
  const name = normalizeDisplayName(nameOrId);
  if (!name) return null;
  const row = await db.one(`SELECT * FROM publishing_tokens WHERE site_id = ? AND name = ?`, [
    siteId,
    name,
  ]);
  return row ? decodePublishingToken(row) : null;
}

export async function revokeToken(
  db: SqlExecutor,
  tokenId: TokenRecordId,
  now: Date = new Date(),
): Promise<{ revoked: boolean; token: PublishingTokenRow | null }> {
  const ts = nowIso(now);
  const result = await db.run(
    `UPDATE publishing_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
    [ts, tokenId],
  );
  const token = await getTokenById(db, tokenId);
  return { revoked: result.changes === 1, token };
}

export async function touchTokenLastUsed(
  db: SqlExecutor,
  tokenId: TokenRecordId,
  now: Date = new Date(),
): Promise<boolean> {
  const ts = nowIso(now);
  const threshold = addSeconds(ts, -TOKEN_LAST_USED_MIN_INTERVAL_SECONDS);
  const result = await db.run(
    `UPDATE publishing_tokens
     SET last_used_at = ?
     WHERE id = ?
       AND revoked_at IS NULL
       AND (last_used_at IS NULL OR last_used_at <= ?)`,
    [ts, tokenId, threshold],
  );
  return result.changes === 1;
}

// --- Locks -------------------------------------------------------------------

export type AcquireLockResult =
  | { ok: true; lockId: LockId; acquiredAt: string; expiresAt: string; site: SiteRow }
  | { ok: false; retryAfterSeconds: number; site: SiteRow };

export async function acquirePublishLock(
  db: SqlExecutor,
  input: { siteId: SiteId; lockId: LockId; now?: Date },
): Promise<AcquireLockResult> {
  const siteId = parseSiteId(input.siteId);
  const lockId = parseLockId(input.lockId);
  if (!siteId || !lockId) throw constraintFailure('invalid site or lock id');
  const now = input.now ?? new Date();
  const ts = nowIso(now);
  const expires = addSeconds(ts, PUBLISH_LOCK_LEASE_SECONDS);

  const result = await db.run(
    `UPDATE sites
     SET publish_lock_id = ?,
         publish_lock_acquired_at = ?,
         publish_lock_expires_at = ?,
         updated_at = ?
     WHERE id = ?
       AND (
         publish_lock_id IS NULL
         OR publish_lock_expires_at <= ?
       )`,
    [lockId, ts, expires, ts, siteId, ts],
  );

  const site = await getSiteById(db, siteId);
  if (!site) throw notFound('site not found');

  if (result.changes === 1 || site.publish_lock_id === lockId) {
    return {
      ok: true,
      lockId,
      acquiredAt: site.publish_lock_acquired_at ?? ts,
      expiresAt: site.publish_lock_expires_at ?? expires,
      site,
    };
  }

  const remaining = site.publish_lock_expires_at
    ? Math.ceil(secondsBetween(site.publish_lock_expires_at, ts))
    : PUBLISH_LOCK_LEASE_SECONDS;
  const retryAfterSeconds = Math.min(120, Math.max(1, remaining));
  return { ok: false, retryAfterSeconds, site };
}

export type RenewLockResult =
  | { ok: true; expiresAt: string; site: SiteRow }
  | {
      ok: false;
      reason: 'not_owner' | 'hard_lifetime' | 'not_due' | 'missing';
      site: SiteRow | null;
    };

export async function renewPublishLock(
  db: SqlExecutor,
  input: {
    siteId: SiteId;
    lockId: LockId;
    tokenId: TokenRecordId;
    now?: Date;
  },
): Promise<RenewLockResult> {
  const siteId = parseSiteId(input.siteId)!;
  const lockId = parseLockId(input.lockId)!;
  const tokenId = parseTokenRecordId(input.tokenId)!;
  const now = input.now ?? new Date();
  const ts = nowIso(now);

  const site = await getSiteById(db, siteId);
  if (!site) return { ok: false, reason: 'missing', site: null };
  if (site.publish_lock_id !== lockId) return { ok: false, reason: 'not_owner', site };

  const token = await getTokenById(db, tokenId);
  if (!token || token.site_id !== siteId || !isTokenUsable(token, ts)) {
    return { ok: false, reason: 'not_owner', site };
  }

  const acquired = site.publish_lock_acquired_at!;
  const hardDeadline = addSeconds(acquired, PUBLISH_LOCK_HARD_LIFETIME_SECONDS);
  const proposed = addSeconds(ts, PUBLISH_LOCK_LEASE_SECONDS);
  if (proposed > hardDeadline || ts >= hardDeadline) {
    return { ok: false, reason: 'hard_lifetime', site };
  }

  const remaining = secondsBetween(site.publish_lock_expires_at!, ts);
  if (remaining > PUBLISH_LOCK_RENEW_THRESHOLD_SECONDS) {
    return { ok: false, reason: 'not_due', site };
  }

  const expiresAt = proposed <= hardDeadline ? proposed : hardDeadline;
  const result = await db.run(
    `UPDATE sites
     SET publish_lock_expires_at = ?, updated_at = ?
     WHERE id = ? AND publish_lock_id = ?`,
    [expiresAt, ts, siteId, lockId],
  );
  if (result.changes !== 1) return { ok: false, reason: 'not_owner', site };
  return { ok: true, expiresAt, site: (await getSiteById(db, siteId))! };
}

export async function releasePublishLock(
  db: SqlExecutor,
  input: { siteId: SiteId; lockId: LockId; now?: Date },
): Promise<boolean> {
  const ts = nowIso(input.now ?? new Date());
  const result = await db.run(
    `UPDATE sites
     SET publish_lock_id = NULL,
         publish_lock_acquired_at = NULL,
         publish_lock_expires_at = NULL,
         updated_at = ?
     WHERE id = ? AND publish_lock_id = ?`,
    [ts, input.siteId, input.lockId],
  );
  if (result.changes === 1) return true;
  const site = await getSiteById(db, input.siteId);
  return site?.publish_lock_id === null;
}

// --- Promotion ---------------------------------------------------------------

export type PromoteResult =
  | { result: 'published'; site: SiteRow }
  | { result: 'unchanged'; site: SiteRow }
  | { result: 'rejected'; reason: 'lock' | 'token' | 'missing'; site: SiteRow | null };

export async function promoteArtifact(
  db: SqlExecutor,
  input: {
    siteId: SiteId;
    lockId: LockId;
    tokenId: TokenRecordId;
    publication: CurrentPublicationInput;
    now?: Date;
  },
): Promise<PromoteResult> {
  const siteId = parseSiteId(input.siteId)!;
  const lockId = parseLockId(input.lockId)!;
  const tokenId = parseTokenRecordId(input.tokenId)!;
  const artifactId = parseArtifactId(input.publication.artifact_id);
  const digest = parseSha256Digest(input.publication.artifact_digest);
  if (!artifactId || !digest) throw constraintFailure('invalid publication artifact fields');
  if (!input.publication.root_route.startsWith('/')) {
    throw constraintFailure('invalid root_route');
  }
  const language = assertLanguage(input.publication.language);
  const direction = assertDirection(input.publication.direction);
  for (const n of [
    input.publication.page_count,
    input.publication.asset_count,
    input.publication.attachment_count,
  ]) {
    if (!Number.isInteger(n) || n < 0) throw constraintFailure('invalid publication counts');
  }

  const now = input.now ?? new Date();
  const ts = nowIso(now);

  return db.transaction(async (tx) => {
    const site = await getSiteById(tx, siteId);
    if (!site) return { result: 'rejected', reason: 'missing', site: null } as const;

    const token = await getTokenById(tx, tokenId);
    if (!token || token.site_id !== siteId || !isTokenUsable(token, ts)) {
      return { result: 'rejected', reason: 'token', site } as const;
    }

    if (site.current_artifact_digest === digest) {
      // Idempotent unchanged: release lock if owned; do not touch last_published_at.
      await releasePublishLock(tx, { siteId, lockId, now });
      const refreshed = (await getSiteById(tx, siteId))!;
      return { result: 'unchanged', site: refreshed } as const;
    }

    const result = await tx.run(
      `UPDATE sites
       SET current_artifact_id = ?,
           current_artifact_digest = ?,
           current_root_route = ?,
           current_language = ?,
           current_direction = ?,
           current_page_count = ?,
           current_asset_count = ?,
           current_attachment_count = ?,
           last_published_at = ?,
           updated_at = ?,
           publish_lock_id = NULL,
           publish_lock_acquired_at = NULL,
           publish_lock_expires_at = NULL
       WHERE id = ?
         AND publish_lock_id = ?
         AND publish_lock_expires_at > ?
         AND EXISTS (
           SELECT 1 FROM publishing_tokens t
           WHERE t.id = ?
             AND t.site_id = sites.id
             AND t.revoked_at IS NULL
             AND (t.expires_at IS NULL OR ? < t.expires_at)
         )`,
      [
        artifactId,
        digest,
        input.publication.root_route,
        language,
        direction,
        input.publication.page_count,
        input.publication.asset_count,
        input.publication.attachment_count,
        ts,
        ts,
        siteId,
        lockId,
        ts,
        tokenId,
        ts,
      ],
    );

    if (result.changes !== 1) {
      const refreshed = await getSiteById(tx, siteId);
      if (
        refreshed &&
        refreshed.current_artifact_digest === digest &&
        refreshed.publish_lock_id === null
      ) {
        return { result: 'published', site: refreshed } as const;
      }
      return { result: 'rejected', reason: 'lock', site } as const;
    }
    return { result: 'published', site: (await getSiteById(tx, siteId))! } as const;
  });
}

// --- Site deletion primitives ------------------------------------------------

export async function beginSiteDeletion(
  db: SqlExecutor,
  siteId: SiteId,
  now: Date = new Date(),
): Promise<SiteRow> {
  const ts = nowIso(now);
  return db.transaction(async (tx) => {
    const existing = await getSiteById(tx, siteId);
    if (!existing) throw notFound('site not found');
    await tx.run(`UPDATE sites SET enabled = 0, updated_at = ? WHERE id = ?`, [ts, siteId]);
    await tx.run(
      `UPDATE publishing_tokens SET revoked_at = ? WHERE site_id = ? AND revoked_at IS NULL`,
      [ts, siteId],
    );
    return (await getSiteById(tx, siteId))!;
  });
}

export type SiteDeletionReadiness = {
  site: SiteRow | null;
  usableTokenCount: number;
  lockActive: boolean;
  readyForFinalDelete: boolean;
};

export async function inspectSiteDeletionState(
  db: SqlExecutor,
  siteId: SiteId,
  now: Date = new Date(),
): Promise<SiteDeletionReadiness> {
  const ts = nowIso(now);
  const site = await getSiteById(db, siteId);
  if (!site) {
    return { site: null, usableTokenCount: 0, lockActive: false, readyForFinalDelete: false };
  }
  const tokens = await listTokensForSite(db, siteId);
  const usableTokenCount = tokens.filter((t) => isTokenUsable(t, ts)).length;
  const lockActive =
    site.publish_lock_id !== null &&
    site.publish_lock_expires_at !== null &&
    site.publish_lock_expires_at > ts;
  const readyForFinalDelete = site.enabled === false && usableTokenCount === 0 && !lockActive;
  return { site, usableTokenCount, lockActive, readyForFinalDelete };
}

export async function finalizeSiteDeletion(
  db: SqlExecutor,
  siteId: SiteId,
  now: Date = new Date(),
): Promise<boolean> {
  const ts = nowIso(now);
  await db.run(
    `DELETE FROM sites
     WHERE id = ?
       AND enabled = 0
       AND NOT EXISTS (
         SELECT 1 FROM publishing_tokens
         WHERE site_id = ?
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR ? < expires_at)
       )
       AND (
         publish_lock_id IS NULL
         OR publish_lock_expires_at IS NULL
         OR publish_lock_expires_at <= ?
       )`,
    [siteId, siteId, ts, ts],
  );
  // D1 HTTP often reports meta.changes = 0 even when the DELETE succeeded.
  return (await getSiteById(db, siteId)) === null;
}
