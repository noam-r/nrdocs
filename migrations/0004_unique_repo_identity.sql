-- Migration 0004: Ensure repo_identity is unique when set.
-- This enables OIDC-based publishing to map a GitHub repo to exactly one project.

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_repo_identity_unique
ON projects(repo_identity)
WHERE repo_identity IS NOT NULL;

