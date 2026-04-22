-- nrdocs platform initial schema
-- Requirement 14.1: D1 as system of record for project records, access policy,
-- admin overrides, repo-derived entries, and operational records.

-- ── Projects ─────────────────────────────────────────────────────────

CREATE TABLE projects (
  id                     TEXT    PRIMARY KEY,
  slug                   TEXT    UNIQUE NOT NULL,
  repo_url               TEXT    NOT NULL,
  title                  TEXT    NOT NULL,
  description            TEXT,
  status                 TEXT    NOT NULL,
  access_mode            TEXT    NOT NULL,
  active_publish_pointer TEXT,
  password_hash          TEXT,
  password_version       INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT    NOT NULL,
  updated_at             TEXT    NOT NULL
);

-- ── Access Policy Entries ────────────────────────────────────────────

CREATE TABLE access_policy_entries (
  id            TEXT PRIMARY KEY,
  scope_type    TEXT NOT NULL,
  scope_value   TEXT NOT NULL,
  subject_type  TEXT NOT NULL,
  subject_value TEXT NOT NULL,
  effect        TEXT NOT NULL,
  source        TEXT NOT NULL,
  created_at    TEXT NOT NULL,

  -- Repo-sourced entries must always be 'allow' effect
  CHECK (source != 'repo' OR effect = 'allow'),
  -- Repo-sourced entries must always be scoped to a project
  CHECK (source != 'repo' OR scope_type = 'project')
);

CREATE INDEX idx_access_policy_scope ON access_policy_entries (scope_type, scope_value);

-- ── Operational Events ───────────────────────────────────────────────

CREATE TABLE operational_events (
  id         TEXT PRIMARY KEY,
  project_id TEXT,
  event_type TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_operational_events_project ON operational_events (project_id);

-- ── Rate Limit Entries ───────────────────────────────────────────────

CREATE TABLE rate_limit_entries (
  project_id    TEXT    PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  window_start  TEXT    NOT NULL
);
