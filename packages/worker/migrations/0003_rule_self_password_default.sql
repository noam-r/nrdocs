-- Add per-rule default for self-service password capability on newly auto-approved repos.
-- Existing rules default to 1 (allow) without modifying any other column.
ALTER TABLE auto_approval_rules ADD COLUMN default_allow_repo_owner_password INTEGER NOT NULL DEFAULT 1;
