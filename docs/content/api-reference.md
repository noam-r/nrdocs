# API Reference

The Control Plane exposes a REST API for managing registered documentation repos. Most endpoints require `Authorization: Bearer <API_KEY>`.

Publishing from GitHub Actions uses **OIDC** (`POST /oidc/publish-credentials`) and short-lived repo-publish JWTs. Long-lived tokens from **`POST /repos/:id/publish-token`** are for **operator manual publish** and for **binding `repo_identity`** when it was missing at registration.

## OIDC

### POST /oidc/publish-credentials

Exchange a **GitHub Actions OIDC** token for publish credentials.

**Headers:** `Authorization: Bearer <github-oidc-token>` (audience = control plane origin)

**Response:** `201 Created`

```json
{
  "repo_id": "550e8400-e29b-41d4-a716-446655440000",
  "repo_publish_token": "eyJhbGciOi...",
  "expires_at": "2026-01-01T00:00:00.000Z"
}
```

---

## Admin endpoints

These endpoints require `Authorization: Bearer <API_KEY>`.

### POST /repos

Register a new documentation site (row in `repos`).

**Request body:**

```json
{
  "slug": "my-docs",
  "repo_url": "https://github.com/org/repo",
  "title": "My Docs",
  "description": "Internal documentation",
  "access_mode": "public",
  "repo_identity": "github.com/org/repo"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `slug` | yes | Unique **site slug** for this deployment. |
| `repo_url` | yes | Canonical repo URL (informational). |
| `title` | yes | Display title. |
| `description` | no | Optional. |
| `access_mode` | yes | `public` or `password`. |
| `repo_identity` | no | Canonical identity for CI: **`github.com/<owner>/<repo>`** (normalized server-side). |

**Response:** `201 Created` with the full repo object (includes `id` = **`repo_id`**).

---

### GET /repos

List registered repos. Query params: `all`, `status`, `name`, `slug`, `title`, `repo_identity`, `access_mode`.

**Response:** `{ "repos": [ … ], "count": N }`

---

### POST /repos/:id/approve

Approve a repo for publishing. Only rows in `awaiting_approval` can be approved.

**Response:** `200 OK` — `{ "message": "Repo approved", "id": "<uuid>" }`

---

### POST /repos/:id/publish-token

Mint a **repo publish** JWT for an **approved** repo.

**Request body (optional):** `{ "repo_identity": "github.com/owner/repo" }` if the row needs `repo_identity` set.

**Response:** `201 Created` — `{ "repo_publish_token": "<JWT>" }`

---

### POST /repos/:id/disable

Disable a site (404 for readers). Data preserved.

---

### POST /repos/:id/publish

Build and publish. Repo must be `approved`.

**Authentication:** repo-publish JWT in `Authorization` (not the API key). Optional **`X-Repo-Identity`** when the token enforces repository binding.

**Request body:** `repo_content` with `project_yml`, `nav_yml`, `allowed_list_yml`, `pages` map.

**Response:** includes `publish_id` and R2 **`prefix`**, typically `publishes/<site-slug>/<publish-id>/`.

---

### DELETE /repos/:id

Delete the registration and associated data (D1, R2 under that site’s publish prefix, related rows).

---

### POST /repos/:id/password · POST /repos/:id/access-mode

Set password or access mode (operator API key or repo-publish JWT per server rules).

---

## Public / repo-owner

### GET /status/:id

Limited status for a **`repo_id`** (no API key). Returns lifecycle, `repo_identity`, delivery URL hint, published flag.

---

### Repo-proof (`/repo-proof/...`)

Challenge / verify / consume flows for repo owners changing password or access mode without operator involvement. See [CLI guide](guides/cli/index.html).

---

## Admin access overrides

### POST /admin/overrides

**Request body:** `scope_type` is `platform` or `repo`; for `repo`, `scope_value` is the **`repo_id`**.

### PUT /admin/overrides/:id · DELETE /admin/overrides/:id

Update or delete an override.
