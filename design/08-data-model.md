# Data Model

## Project record
Suggested fields:
- `project_id`
- `slug`
- `repo_url` or canonical repo identifier
- `title`
- `description`
- `status` (`awaiting_approval`, `approved`, `disabled`)
- `access_mode` (`public`, `password`, future `invite_list`)
- `publish_enabled`
- `password_hash` (nullable)
- `created_at`
- `updated_at`

## Admin override policy entries
Suggested fields:
- `entry_id`
- `scope_type` (`platform`, `project`)
- `scope_value` (`*` or project_id)
- `subject_type` (`email`, `domain`)
- `subject_value`
- `effect` (`allow`, `deny`)
- `source` (`admin`)
- `created_at`

## Repo-derived desired access entries
Suggested fields:
- `entry_id`
- `project_id`
- `subject_type` (`email`, `domain`)
- `subject_value`
- `effect` (`allow` only)
- `source` (`repo`)
- `created_at`
- `updated_at`

## Effective access view
The system may compute or materialize effective access results for debugging and admin visibility.
The effective view is derived from:
- platform overrides
- project overrides
- repo-derived allow entries
- precedence rules

## Audit / operational records
Phase 1 should at least store operational records for:
- project registration
- project approval/disable actions
- publish attempts
- publish success/failure

Access audit is future-facing and not required for phase 1.
