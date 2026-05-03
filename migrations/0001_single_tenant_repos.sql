-- Single-tenant baseline: one installation, flat list of registered repos.
-- Idempotent: safe to re-run if some tables already exist (same schema).

-- ── Repos (published docs site bound to a GitHub repo) ───────────────

CREATE TABLE IF NOT EXISTS repos (
  id                     TEXT PRIMARY KEY,
  slug                   TEXT UNIQUE NOT NULL,
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_repos_repo_identity_unique ON repos(repo_identity)
WHERE repo_identity IS NOT NULL;

-- ── Repo publish JWTs (OIDC exchange or operator mint) ──────────────

CREATE TABLE IF NOT EXISTS repo_publish_tokens (
  id              TEXT PRIMARY KEY,
  jti             TEXT UNIQUE NOT NULL,
  repo_id         TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  repo_identity   TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  token_source    TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  last_used_at    TEXT
);

-- ── Access policy ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS access_policy_entries (
  id            TEXT PRIMARY KEY,
  scope_type    TEXT NOT NULL,
  scope_value   TEXT NOT NULL,
  subject_type  TEXT NOT NULL,
  subject_value TEXT NOT NULL,
  effect        TEXT NOT NULL,
  source        TEXT NOT NULL,
  created_at    TEXT NOT NULL,

  CHECK (source != 'repo' OR effect = 'allow'),
  CHECK (source != 'repo' OR scope_type = 'repo')
);

CREATE INDEX IF NOT EXISTS idx_access_policy_scope ON access_policy_entries (scope_type, scope_value);

-- ── Operational events ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS operational_events (
  id         TEXT PRIMARY KEY,
  repo_id    TEXT,
  event_type TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operational_events_repo ON operational_events (repo_id);

-- ── Rate limiting (password attempts) ───────────────────────────────

CREATE TABLE IF NOT EXISTS rate_limit_entries (
  repo_id       TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  window_start  TEXT NOT NULL
);

-- ── Repo-proof challenges ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS repo_proof_challenges (
  id                 TEXT PRIMARY KEY,
  repo_id            TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  repo_identity      TEXT NOT NULL,
  action             TEXT NOT NULL,

  public_token       TEXT NOT NULL,
  private_token_hash TEXT NOT NULL,

  status             TEXT NOT NULL,

  issued_at          TEXT NOT NULL,
  expires_at         TEXT NOT NULL,

  verified_at        TEXT,
  opened_until       TEXT,
  verify_ref         TEXT,
  verify_sha         TEXT,

  consumed_at        TEXT,

  attempt_count_set    INTEGER NOT NULL DEFAULT 0,
  attempt_count_verify  INTEGER NOT NULL DEFAULT 0,
  last_denial_reason   TEXT
);

CREATE INDEX IF NOT EXISTS idx_repo_proof_challenges_repo ON repo_proof_challenges (repo_id);
CREATE INDEX IF NOT EXISTS idx_repo_proof_challenges_public_token ON repo_proof_challenges (public_token);
CREATE INDEX IF NOT EXISTS idx_repo_proof_challenges_expires_at ON repo_proof_challenges (expires_at);
