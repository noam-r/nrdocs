-- nrdocs initial D1 schema
-- See nrdocs-specs/04-data-model.md for field documentation

CREATE TABLE repos (
  id TEXT PRIMARY KEY,
  github_repository_id TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  default_branch TEXT,
  approval_state TEXT NOT NULL CHECK (approval_state IN ('pending', 'approved', 'disabled')),
  access_mode TEXT NOT NULL CHECK (access_mode IN ('none', 'public', 'password')),
  latest_successful_build_id TEXT,
  last_publish_status TEXT,
  requested_access TEXT,
  site_title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  approved_by TEXT,
  disabled_at TEXT,
  disabled_by TEXT
);

CREATE INDEX idx_repos_full_name ON repos(full_name);
CREATE INDEX idx_repos_approval_state ON repos(approval_state);
CREATE INDEX idx_repos_owner ON repos(owner);

CREATE TABLE builds (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  github_repository_id TEXT NOT NULL,
  git_sha TEXT NOT NULL,
  git_ref TEXT,
  workflow_ref TEXT,
  run_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('uploading', 'success', 'failed')),
  artifact_prefix TEXT,
  artifact_manifest_key TEXT,
  artifact_size_bytes INTEGER,
  file_count INTEGER,
  content_hash TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (repo_id) REFERENCES repos(id)
);

CREATE INDEX idx_builds_repo_id ON builds(repo_id);
CREATE INDEX idx_builds_status ON builds(status);

CREATE TABLE password_credentials (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  hash_algorithm TEXT NOT NULL,
  salt TEXT NOT NULL,
  iteration_count INTEGER NOT NULL,
  password_version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES repos(id)
);

CREATE INDEX idx_password_credentials_repo_id ON password_credentials(repo_id);

CREATE TABLE auto_approval_rules (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  access_mode TEXT NOT NULL CHECK (access_mode IN ('public', 'password')),
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX idx_auto_approval_rules_enabled ON auto_approval_rules(enabled);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('operator', 'github_action', 'system')),
  actor_id TEXT,
  repo_id TEXT,
  build_id TEXT,
  rule_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_log_repo_id ON audit_log(repo_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX idx_audit_log_event_type ON audit_log(event_type);
