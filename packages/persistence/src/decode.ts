import {
  assertDirection,
  assertLanguage,
  assertRfc3339,
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
  type Direction,
} from '@nrdocs/contracts';
import { invariantFailure } from './errors.js';
import type { SqlRow } from './sql.js';
import type { AccessMode, InstanceMetadataRow, PublishingTokenRow, SiteRow } from './types.js';
import { assertPasswordVerifier, assertTokenVerifier } from './verifiers.js';

function reqString(row: SqlRow, key: string): string {
  const v = row[key];
  if (typeof v !== 'string') throw invariantFailure(`row.${key} must be TEXT`);
  return v;
}

function optString(row: SqlRow, key: string): string | null {
  const v = row[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw invariantFailure(`row.${key} must be TEXT or NULL`);
  return v;
}

function reqInt(row: SqlRow, key: string): number {
  const v = row[key];
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw invariantFailure(`row.${key} must be INTEGER`);
  }
  return v;
}

function assertCanonicalTime(value: string, field: string): string {
  try {
    return formatRfc3339(assertRfc3339(value));
  } catch {
    throw invariantFailure(`row.${field} must be canonical RFC 3339 UTC`);
  }
}

export function decodeInstanceMetadata(row: SqlRow): InstanceMetadataRow {
  const id = parseInstanceId(reqString(row, 'id'));
  if (!id) throw invariantFailure('instance_metadata.id invalid');
  const display_name = normalizeDisplayName(reqString(row, 'display_name'));
  if (!display_name) throw invariantFailure('instance_metadata.display_name invalid');
  const canonical_origin = parseHttpsServerUrl(reqString(row, 'canonical_origin'));
  if (!canonical_origin) throw invariantFailure('instance_metadata.canonical_origin invalid');
  const account_id = reqString(row, 'account_id').trim();
  const resource_suffix = reqString(row, 'resource_suffix').trim();
  const deployed_version = reqString(row, 'deployed_version').trim();
  if (!account_id || !resource_suffix || !deployed_version) {
    throw invariantFailure('instance_metadata required string fields empty');
  }
  return {
    id,
    display_name,
    account_id,
    resource_suffix,
    canonical_origin,
    deployed_version,
    schema_version: reqInt(row, 'schema_version'),
    created_at: assertCanonicalTime(reqString(row, 'created_at'), 'created_at'),
  };
}

export function decodeSite(row: SqlRow): SiteRow {
  const id = parseSiteId(reqString(row, 'id'));
  if (!id) throw invariantFailure('sites.id invalid');
  const slug = parseSlug(reqString(row, 'slug'));
  if (!slug) throw invariantFailure('sites.slug invalid');

  const enabledInt = reqInt(row, 'enabled');
  if (enabledInt !== 0 && enabledInt !== 1) throw invariantFailure('sites.enabled invalid');

  const access_mode = reqString(row, 'access_mode');
  if (access_mode !== 'public' && access_mode !== 'password') {
    throw invariantFailure('sites.access_mode invalid');
  }
  const password_verifier = optString(row, 'password_verifier');
  if (access_mode === 'public') {
    if (password_verifier !== null) throw invariantFailure('public site has password_verifier');
  } else {
    assertPasswordVerifier(password_verifier);
  }

  const publicationKeys = [
    'current_artifact_id',
    'current_artifact_digest',
    'current_root_route',
    'current_language',
    'current_direction',
    'current_page_count',
    'current_asset_count',
    'current_attachment_count',
    'last_published_at',
  ] as const;
  const present = publicationKeys.map((k) => row[k] !== null && row[k] !== undefined);
  const allNull = present.every((p) => !p);
  const allPresent = present.every((p) => p);
  if (!allNull && !allPresent) {
    throw invariantFailure('sites current-publication tuple must be all-null or all-present');
  }

  let current_artifact_id = null as SiteRow['current_artifact_id'];
  let current_artifact_digest = null as string | null;
  let current_root_route = null as string | null;
  let current_language = null as string | null;
  let current_direction = null as Direction | null;
  let current_page_count = null as number | null;
  let current_asset_count = null as number | null;
  let current_attachment_count = null as number | null;
  let last_published_at = null as string | null;

  if (allPresent) {
    current_artifact_id = parseArtifactId(reqString(row, 'current_artifact_id'));
    if (!current_artifact_id) throw invariantFailure('sites.current_artifact_id invalid');
    current_artifact_digest = parseSha256Digest(reqString(row, 'current_artifact_digest'));
    if (!current_artifact_digest) throw invariantFailure('sites.current_artifact_digest invalid');
    current_root_route = reqString(row, 'current_root_route');
    if (!current_root_route.startsWith('/')) {
      throw invariantFailure('sites.current_root_route invalid');
    }
    current_language = assertLanguage(reqString(row, 'current_language'));
    current_direction = assertDirection(reqString(row, 'current_direction'));
    current_page_count = reqInt(row, 'current_page_count');
    current_asset_count = reqInt(row, 'current_asset_count');
    current_attachment_count = reqInt(row, 'current_attachment_count');
    if (current_page_count < 0 || current_asset_count < 0 || current_attachment_count < 0) {
      throw invariantFailure('sites publication counts must be non-negative');
    }
    last_published_at = assertCanonicalTime(
      reqString(row, 'last_published_at'),
      'last_published_at',
    );
  }

  const lockIdRaw = optString(row, 'publish_lock_id');
  const lockAcquired = optString(row, 'publish_lock_acquired_at');
  const lockExpires = optString(row, 'publish_lock_expires_at');
  const lockPresent = [lockIdRaw, lockAcquired, lockExpires].map((v) => v !== null);
  if (!(lockPresent.every((p) => !p) || lockPresent.every((p) => p))) {
    throw invariantFailure('sites lock tuple must be all-null or all-present');
  }

  let publish_lock_id = null as SiteRow['publish_lock_id'];
  let publish_lock_acquired_at = null as string | null;
  let publish_lock_expires_at = null as string | null;
  if (lockIdRaw !== null) {
    publish_lock_id = parseLockId(lockIdRaw);
    if (!publish_lock_id) throw invariantFailure('sites.publish_lock_id invalid');
    publish_lock_acquired_at = assertCanonicalTime(lockAcquired!, 'publish_lock_acquired_at');
    publish_lock_expires_at = assertCanonicalTime(lockExpires!, 'publish_lock_expires_at');
  }

  return {
    id,
    slug,
    enabled: enabledInt === 1,
    access_mode: access_mode as AccessMode,
    password_verifier,
    session_generation: reqInt(row, 'session_generation'),
    current_artifact_id,
    current_artifact_digest,
    current_root_route,
    current_language,
    current_direction,
    current_page_count,
    current_asset_count,
    current_attachment_count,
    last_published_at,
    publish_lock_id,
    publish_lock_acquired_at,
    publish_lock_expires_at,
    created_at: assertCanonicalTime(reqString(row, 'created_at'), 'created_at'),
    updated_at: assertCanonicalTime(reqString(row, 'updated_at'), 'updated_at'),
  };
}

export function decodePublishingToken(row: SqlRow): PublishingTokenRow {
  const id = parseTokenRecordId(reqString(row, 'id'));
  if (!id) throw invariantFailure('publishing_tokens.id invalid');
  const site_id = parseSiteId(reqString(row, 'site_id'));
  if (!site_id) throw invariantFailure('publishing_tokens.site_id invalid');
  const name = normalizeDisplayName(reqString(row, 'name'));
  if (!name) throw invariantFailure('publishing_tokens.name invalid');
  const token_verifier = assertTokenVerifier(reqString(row, 'token_verifier'));

  const expires_at = optString(row, 'expires_at');
  const revoked_at = optString(row, 'revoked_at');
  const last_used_at = optString(row, 'last_used_at');

  return {
    id,
    site_id,
    name,
    token_verifier,
    expires_at: expires_at ? assertCanonicalTime(expires_at, 'expires_at') : null,
    revoked_at: revoked_at ? assertCanonicalTime(revoked_at, 'revoked_at') : null,
    last_used_at: last_used_at ? assertCanonicalTime(last_used_at, 'last_used_at') : null,
    created_at: assertCanonicalTime(reqString(row, 'created_at'), 'created_at'),
  };
}

export function isTokenUsable(token: PublishingTokenRow, nowIso: string): boolean {
  if (token.revoked_at !== null) return false;
  if (token.expires_at !== null && nowIso >= token.expires_at) return false;
  return true;
}
