-- Migration 0005: Repo-proof challenges for password management.
--
-- Adds a new table to support challenge-based repo-control verification for
-- privileged repo-owner actions (set/rotate/remove password, toggle access mode).

CREATE TABLE repo_proof_challenges (
  id                 TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id),
  repo_identity       TEXT NOT NULL,
  action             TEXT NOT NULL,

  public_token        TEXT NOT NULL,
  private_token_hash  TEXT NOT NULL,

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

CREATE INDEX idx_repo_proof_challenges_project ON repo_proof_challenges (project_id);
CREATE INDEX idx_repo_proof_challenges_public_token ON repo_proof_challenges (public_token);
CREATE INDEX idx_repo_proof_challenges_expires_at ON repo_proof_challenges (expires_at);
