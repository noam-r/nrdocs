-- Migration 0003: Org-scoped project slugs (UNIQUE(org_id, slug)) and index on slug for lookups.

-- We rebuild the `projects` table. Other tables (e.g. repo_publish_tokens) reference it,
-- so we temporarily disable FK enforcement during the swap, then re-enable it.
PRAGMA foreign_keys=OFF;

-- Defensive backfill:
-- Older installs or manual DB edits may have projects.org_id values that do not
-- exist in organizations(id). Rebuilds with a FOREIGN KEY will fail unless we
-- fix those rows first.
UPDATE projects
SET org_id = '00000000-0000-0000-0000-000000000001'
WHERE org_id IS NULL
   OR org_id NOT IN (SELECT id FROM organizations);

CREATE TABLE projects_next (
  id                     TEXT PRIMARY KEY,
  slug                   TEXT NOT NULL,
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
  updated_at             TEXT NOT NULL,
  UNIQUE (org_id, slug)
);

INSERT INTO projects_next SELECT
  id, slug, org_id, repo_url, title, description, status, access_mode,
  active_publish_pointer, password_hash, password_version, repo_identity,
  created_at, updated_at
FROM projects;

DROP TABLE projects;
ALTER TABLE projects_next RENAME TO projects;

CREATE INDEX idx_projects_org_slug ON projects (org_id, slug);

PRAGMA foreign_keys=ON;
