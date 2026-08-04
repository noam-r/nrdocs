import { SCHEMA_VERSION } from './constants.js';

/**
 * Forward-only 2.x migration ledger shape.
 * Column layout is not locked by the data-model spec; this is the Phase 6 baseline choice.
 */
export type SchemaMigration = {
  version: number;
  name: string;
  /** Individual SQL statements — never combine into one multi-statement string for D1 HTTP. */
  statements: readonly string[];
};

const BASELINE_STATEMENTS: readonly string[] = [
  `PRAGMA foreign_keys = ON`,

  `CREATE TABLE schema_migrations (
  version INTEGER NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  CHECK (typeof(version) = 'integer' AND version >= 1)
) STRICT`,

  `CREATE TABLE instance_metadata (
  id TEXT NOT NULL PRIMARY KEY,
  display_name TEXT NOT NULL,
  account_id TEXT NOT NULL,
  resource_suffix TEXT NOT NULL UNIQUE,
  canonical_origin TEXT NOT NULL,
  deployed_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (typeof(schema_version) = 'integer' AND schema_version >= 1),
  CHECK (
    length(id) = 31
    AND substr(id, 1, 5) = 'inst_'
    AND substr(id, 6) NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'
  )
) STRICT`,

  `CREATE TRIGGER instance_metadata_singleton
BEFORE INSERT ON instance_metadata
WHEN (SELECT COUNT(*) FROM instance_metadata) >= 1
BEGIN
  SELECT RAISE(ABORT, 'instance_metadata must contain exactly one row');
END`,

  `CREATE TABLE sites (
  id TEXT NOT NULL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL,
  access_mode TEXT NOT NULL,
  password_verifier TEXT,
  session_generation INTEGER NOT NULL,
  current_artifact_id TEXT,
  current_artifact_digest TEXT,
  current_root_route TEXT,
  current_language TEXT,
  current_direction TEXT,
  current_page_count INTEGER,
  current_asset_count INTEGER,
  current_attachment_count INTEGER,
  last_published_at TEXT,
  publish_lock_id TEXT,
  publish_lock_acquired_at TEXT,
  publish_lock_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    length(id) = 31
    AND substr(id, 1, 5) = 'site_'
    AND substr(id, 6) NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'
  ),
  CHECK (
    length(slug) BETWEEN 1 AND 63
    AND slug NOT GLOB '*[^a-z0-9-]*'
    AND substr(slug, 1, 1) GLOB '[a-z0-9]'
    AND substr(slug, -1, 1) GLOB '[a-z0-9]'
    AND slug <> '_nrdocs'
  ),
  CHECK (typeof(enabled) = 'integer' AND enabled IN (0, 1)),
  CHECK (typeof(session_generation) = 'integer' AND session_generation >= 1),
  CHECK (
    (access_mode = 'public' AND password_verifier IS NULL)
    OR
    (access_mode = 'password' AND password_verifier IS NOT NULL)
  ),
  CHECK (
    (
      current_artifact_id IS NULL
      AND current_artifact_digest IS NULL
      AND current_root_route IS NULL
      AND current_language IS NULL
      AND current_direction IS NULL
      AND current_page_count IS NULL
      AND current_asset_count IS NULL
      AND current_attachment_count IS NULL
      AND last_published_at IS NULL
    )
    OR
    (
      current_artifact_id IS NOT NULL
      AND current_artifact_digest IS NOT NULL
      AND current_root_route IS NOT NULL
      AND current_language IS NOT NULL
      AND current_direction IN ('ltr', 'rtl', 'auto')
      AND typeof(current_page_count) = 'integer'
      AND current_page_count >= 0
      AND typeof(current_asset_count) = 'integer'
      AND current_asset_count >= 0
      AND typeof(current_attachment_count) = 'integer'
      AND current_attachment_count >= 0
      AND last_published_at IS NOT NULL
    )
  ),
  CHECK (
    (
      publish_lock_id IS NULL
      AND publish_lock_acquired_at IS NULL
      AND publish_lock_expires_at IS NULL
    )
    OR
    (
      publish_lock_id IS NOT NULL
      AND publish_lock_acquired_at IS NOT NULL
      AND publish_lock_expires_at IS NOT NULL
    )
  )
) STRICT`,

  `CREATE TABLE publishing_tokens (
  id TEXT NOT NULL PRIMARY KEY,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_verifier TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (
    length(id) = 30
    AND substr(id, 1, 4) = 'tok_'
    AND substr(id, 5) NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'
  ),
  CHECK (
    length(site_id) = 31
    AND substr(site_id, 1, 5) = 'site_'
    AND substr(site_id, 6) NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'
  ),
  CHECK (
    length(token_verifier) = 71
    AND substr(token_verifier, 1, 7) = 'sha256:'
    AND substr(token_verifier, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) STRICT`,

  `CREATE UNIQUE INDEX publishing_tokens_site_name_uq
  ON publishing_tokens(site_id, name)`,

  `CREATE INDEX publishing_tokens_verifier_idx
  ON publishing_tokens(token_verifier)`,
];

export const MIGRATIONS: readonly SchemaMigration[] = Object.freeze([
  {
    version: SCHEMA_VERSION,
    name: '0001_baseline',
    statements: BASELINE_STATEMENTS,
  },
]);
