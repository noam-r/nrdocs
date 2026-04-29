# Configuration

nrdocs is configured through Wrangler TOML files, environment variables, and Worker secrets.

## Environment variables

The Delivery Worker accepts these configurable values in `wrangler.toml` under `[env.delivery.vars]`:

| Variable | Default | Description |
|---|---|---|
| `SESSION_TTL` | `28800` | Session cookie lifetime in seconds (8 hours) |
| `CACHE_TTL` | `300` | `Cache-Control` max-age in seconds (5 minutes) |
| `RATE_LIMIT_MAX` | `5` | Failed login attempts before lockout |
| `RATE_LIMIT_WINDOW` | `300` | Rate limit window in seconds (5 minutes) |

## Secrets

Secrets are set via `wrangler secret put` and stored in Cloudflare's encrypted secret storage. They are never written to config files or logged.

| Secret | Workers | Description |
|---|---|---|
| `HMAC_SIGNING_KEY` | Both | Signs and verifies session tokens (HMAC-SHA256). Must be identical in both Workers. |
| `API_KEY` | Control Plane only | Authenticates all admin API requests. Sent as `Authorization: Bearer <key>`. |
| `TOKEN_SIGNING_KEY` | Control Plane only | Signs bootstrap tokens and repo publish tokens (JWT). |
| `DELIVERY_URL` | Control Plane only | Public Delivery Worker base URL. Used by `nrdocs init` to print the final docs URL. |

### Setting secrets

```bash
# Delivery Worker
wrangler secret put HMAC_SIGNING_KEY --env delivery

# Control Plane Worker
wrangler secret put API_KEY --env control-plane
wrangler secret put HMAC_SIGNING_KEY --env control-plane
wrangler secret put TOKEN_SIGNING_KEY --env control-plane
```

### Rotating secrets

To rotate the HMAC signing key, set the new value on both Workers and redeploy. All existing session tokens will be invalidated immediately (users will need to re-authenticate).

To rotate the API key, set the new value on the Control Plane Worker and update any operator scripts that use it. (The default GitHub Actions publish workflow uses OIDC and does not need the API key.)

To rotate the token signing key, set the new value on the Control Plane Worker. All existing bootstrap tokens and repo publish tokens signed with the old key will be invalidated. New tokens must be issued.

## Custom domain

Update the `routes` section in `wrangler.toml` to point to your domain:

```toml
routes = [
  { pattern = "docs.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

The domain must be managed by Cloudflare (added as a zone in your account). The Delivery Worker binds to this route and serves all project documentation under it.

## Access modes

Each project has an access mode set at registration:

- **public** — content is served without any authentication
- **password** — users must enter a shared password to view content; a session cookie is issued on success

The access mode **can** be changed later:

- **Repo owners** can set or disable a password using the repo-proof flow (`nrdocs password set` / `nrdocs password disable`).
- **Operators** can also change access mode via the Control Plane API (`POST /projects/:id/access-mode`).

If you onboard with `nrdocs init`, the recommended default is to start in `password` mode and set the initial password during `init` so content is never briefly exposed publicly.

## Project lifecycle

Projects go through these states:

```
awaiting_approval → approved → disabled
                              ↓
                           deleted
```

- **awaiting_approval** — initial state after registration. Cannot publish or serve content.
- **approved** — can publish and serve content.
- **disabled** — returns 404 to all requests. Cannot publish. Data is preserved.
- **deleted** — all data removed (D1 records, R2 artifacts, access config).
