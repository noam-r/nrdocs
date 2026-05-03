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
| `TOKEN_SIGNING_KEY` | Control Plane only | Signs repo publish tokens (JWT). |
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
- **Operators** can also change access mode via the Control Plane API (`POST /repos/:id/access-mode`).

If you initialize a repo with `nrdocs init`, the recommended default is to start in `password` mode and ensure a password is set **before the first publish** (operator: `nrdocs admin set-password <repo-id>`, or repo owner: `nrdocs password set`).

For **password** sites, the delivery worker redirects `https://<host>/<slug>` to `https://<host>/<slug>/` (308) so the site root always matches the trailing-slash URL used for static content and login redirects. Bookmarks and links should prefer the trailing-slash form.

### Delivery host root (`/`)

`GET` or `HEAD` on the delivery origin with path **`/`** (no repo slug) serves a **platform homepage** from the same R2 bucket as publishes, default object key **`site/index.html`**. This repository includes a starter page at **`site/index.html`** (tracked in git; other paths under `site/` remain ignored for generator output). Upload it with for example `wrangler r2 object put nrdocs-content/site/index.html --file=./site/index.html`. Links inside the page should use paths like `/<repo-slug>/` (trailing slash on the site root is recommended).

Override the key with **`HOME_PAGE_R2_KEY`** on the delivery Worker, or set **`HOME_PAGE_R2_KEY`** to an empty string to disable the homepage and return **404** on `/`.

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
