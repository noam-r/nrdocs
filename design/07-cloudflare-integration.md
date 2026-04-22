# Cloudflare Integration Design

## Platform products used
- Cloudflare Worker for request/auth handling
- Cloudflare R2 for content artifacts
- Cloudflare Access for future identity-aware protection
- Cloudflare-managed DNS/edge delivery for `docs.example.com`

## Worker role
The Worker is a thin gateway in front of all project requests.
Responsibilities:
- resolve project slug from URL path
- load project metadata/state
- enforce status behavior (`awaiting_approval`, `approved`, `disabled`)
- enforce `public` vs `password`
- serve content from R2

## R2 role
R2 stores static artifacts under stable project paths.
URLs remain stable at:
- `docs.example.com/<slug>/...`

## Cloudflare Access role
Cloudflare Access is not the primary source of truth.
The platform DB remains authoritative.
Cloudflare Access is the enforcement layer for future identity-aware project access.

## Access mapping strategy
Cloudflare Access is modeled per project path.
Example:
- `docs.example.com/project-a/*`
- `docs.example.com/project-b/*`

## Sync model
The sync model is hybrid:
- admin/DB-side access changes should sync immediately
- repo-originated access changes should sync on publish
- a periodic reconcile job may be added later as repair/self-heal

## Public projects
Public project paths are not gated by Cloudflare Access.

## Password projects
Phase 1 password mode is implemented by the platform Worker and is not dependent on Cloudflare Access.
