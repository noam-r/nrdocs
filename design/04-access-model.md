# Access Model

## Conceptual access modes
The platform defines these access modes:
- `public`
- `password`
- `invite_list` (future)

Phase 1 supports:
- `public`
- `password`

## Access authority model
Repo config expresses project-owner desired access.
The DB stores authoritative effective access state.

Repo-originated changes are accepted only when they do not collide with higher-priority DB policy.

## Effective precedence order
Access is evaluated in this order:
1. platform blacklist
2. platform whitelist
3. project blacklist
4. project whitelist
5. repo-derived allow list
6. default deny

## Deny semantics
Any deny rule wins over any allow rule.
If a single deny rule applies, access is denied.

## Repo constraints
Repos may only declare project-local allow rules.
Repos may not declare deny rules.
Repos may not manage access for any project other than their own.

## Repo-to-DB sync behavior
On publish:
- the existing repo-derived desired allow set for that project is removed
- the new repo-derived desired allow set from the repository is written
- admin overrides are preserved

This means publishing replaces only the repo-derived desired allow set, not DB-managed overrides.

## Public projects
Public projects require no authentication and are served directly through the Worker/R2 path with no auth gate.

## Password projects
Password projects require the platform password flow before content is served.

## Future invite-list projects
Invite-list projects are expected to use Cloudflare Access as the identity-aware enforcement layer in future phases.
