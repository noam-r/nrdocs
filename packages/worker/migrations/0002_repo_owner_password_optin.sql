-- Add per-repo opt-in flag for self-service password management.
-- Existing rows default to 0 (opt-in disabled) without rewriting any other column.
ALTER TABLE repos ADD COLUMN allow_repo_owner_password INTEGER NOT NULL DEFAULT 0;
