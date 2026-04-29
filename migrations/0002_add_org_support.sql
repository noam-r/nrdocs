-- Migration 0002: Add organization support
-- Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 7.1, 13.1, 13.2

-- ── Step 1: Create organizations table ───────────────────────────────

CREATE TABLE organizations (
  id         TEXT PRIMARY KEY,
  slug       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ── Step 2: Seed default organization ────────────────────────────────

INSERT INTO organizations (id, slug, name, status, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'default',
  'Default Organization',
  'active',
  datetime('now'),
  datetime('now')
);

-- ── Step 3: Add org_id to projects and backfill ──────────────────────

-- Add nullable org_id first
ALTER TABLE projects ADD COLUMN org_id TEXT REFERENCES organizations(id);

-- Backfill all existing rows to default org
UPDATE projects SET org_id = '00000000-0000-0000-0000-000000000001';

-- Rebuild table to enforce NOT NULL on org_id and add repo_identity
CREATE TABLE projects_new (
  id                     TEXT PRIMARY KEY,
  slug                   TEXT UNIQUE NOT NULL,
  org_id                 TEXT NOT NULL REFERENCES organizations(id),
  repo_url               TEXT NOT NULL,
  title                  TEXT NOT NULL,
  description            TEXT,
  status                 TEXT NOT NULL,
  access_mode            TEXT NOT NULL,
  active_publish_pointer TEXT,
  password_hash          TEXT,
  password_version       INTEGER NOT NULL DEFAULT 0,
  repo_identity          TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

INSERT INTO projects_new SELECT
  id, slug, org_id, repo_url, title, description, status, access_mode,
  active_publish_pointer, password_hash, password_version,
  NULL,
  created_at, updated_at
FROM projects;

DROP TABLE projects;
ALTER TABLE projects_new RENAME TO projects;

-- ── Step 4: Create bootstrap_tokens table ────────────────────────────

CREATE TABLE bootstrap_tokens (
  id                 TEXT PRIMARY KEY,
  jti                TEXT UNIQUE NOT NULL,
  org_id             TEXT NOT NULL REFERENCES organizations(id),
  status             TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  created_by         TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  expires_at         TEXT NOT NULL,
  max_repos          INTEGER NOT NULL,
  repos_issued_count INTEGER NOT NULL DEFAULT 0,
  last_used_at       TEXT
);

-- ── Step 5: Create repo_publish_tokens table ─────────────────────────

CREATE TABLE repo_publish_tokens (
  id                         TEXT PRIMARY KEY,
  jti                        TEXT UNIQUE NOT NULL,
  org_id                     TEXT NOT NULL REFERENCES organizations(id),
  project_id                 TEXT NOT NULL REFERENCES projects(id),
  repo_identity              TEXT NOT NULL,
  status                     TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  created_from_bootstrap_jti TEXT NOT NULL,
  created_at                 TEXT NOT NULL,
  expires_at                 TEXT NOT NULL,
  last_used_at               TEXT
);
