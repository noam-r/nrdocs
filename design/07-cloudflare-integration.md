# Cloudflare Integration Design

## Platform products used
- Cloudflare Worker for request/auth handling
- Cloudflare R2 for content artifacts
- Cloudflare Access for future identity-aware protection
- Cloudflare-managed DNS/edge delivery for `docs.example.com`

## Worker role
The Worker is a thin gateway in front of all project requests.
Responsibilities:
- resolve organization + project slugs from the URL path (`/<project>/…` for default org, `/<org>/<project>/…` otherwise)
- load project metadata/state
- enforce status behavior (`awaiting_approval`, `approved`, `disabled`)
- enforce `public` vs `password`
- serve content from R2

## R2 role
R2 stores static artifacts under stable paths, e.g. `publishes/<org-slug>/<project-slug>/<publish-id>/…`. Public URLs remain stable at:

- `docs.example.com/<project-slug>/...` (default org)
- `docs.example.com/<org-slug>/<project-slug>/...` (named orgs)

## Cloudflare Access role
Cloudflare Access is not the primary source of truth.
The platform DB remains authoritative.
Cloudflare Access is the enforcement layer for future identity-aware project access.

## Access mapping strategy
Cloudflare Access is modeled per project path.
Example (default org):
- `docs.example.com/project-a/*`
- `docs.example.com/project-b/*`

Example (named org `acme`):
- `docs.example.com/acme/docs/*`

## Sync model
The sync model is hybrid:
- admin/DB-side access changes should sync immediately
- repo-originated access changes should sync on publish
- a periodic reconcile job may be added later as repair/self-heal

## Public projects
Public project paths are not gated by Cloudflare Access.

## Password projects
Phase 1 password mode is implemented by the platform Worker and is not dependent on Cloudflare Access.
