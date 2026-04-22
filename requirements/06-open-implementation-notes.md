# Open Implementation Notes

These are not blockers for the requirements, but should be kept in mind during design/implementation.

## Cloudflare Access management detail

The intended model is that Cloudflare acts as the enforcement layer and platform/DB state is reconciled into it.

Implementation must still decide exact mechanics such as:
- full API-based reconciliation strategy
- repair/reconcile workflow
- failure handling when platform state and Cloudflare state diverge temporarily

## Serving from storage

The requirements prefer direct/static serving when practical.

Implementation may still choose a Worker in front of storage if needed for:
- path routing
- default document resolution
- auth integration
- consistent 404/login handling
- future extensibility

## Password flow

Phase 1 requires password-protected projects, while the long-term architecture also anticipates richer invite-based access.

Implementation may use Cloudflare capabilities where practical, but the product-level access mode remains:
- `public`
- `password`
- future `invite_list`

## Version/history UX

Phase 1 relies on git history instead of platform-managed content versioning.

A future enhancement may build a version/history UI from git metadata.

## Admin UI

Phase 1 does not require a full admin UI.
An admin API/config-driven approach is sufficient.
