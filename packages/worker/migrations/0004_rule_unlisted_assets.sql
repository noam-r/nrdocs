-- Allow operator rules to consent to non-whitelist artifact extensions per matching repo pattern.

ALTER TABLE auto_approval_rules ADD COLUMN allow_unlisted_assets INTEGER NOT NULL DEFAULT 0;
