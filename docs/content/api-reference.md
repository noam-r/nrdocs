# API Reference

The Control Plane exposes a REST API for managing projects. Most endpoints require `Authorization: Bearer <API_KEY>`. Bootstrap endpoints use `Authorization: Bearer <bootstrap-token>` instead.

## Bootstrap Endpoints

These endpoints use bootstrap token authentication (not API key auth).

### POST /bootstrap/init

Validate a bootstrap token and return org metadata. Used by the CLI as a preflight check before onboarding.

**Headers:** `Authorization: Bearer <bootstrap-token>`

**Request body:** empty or `{}`

**Response:** `200 OK`

```json
{
  "org_name": "My Organization",
  "org_slug": "my-org",
  "remaining_quota": 8,
  "expires_at": "2025-12-31T00:00:00.000Z"
}
```

---

### POST /bootstrap/onboard

Create a project and mint a repo publish token in a single request. Used by the CLI after the user confirms onboarding values.

**Headers:** `Authorization: Bearer <bootstrap-token>`

**Request body:**

```json
{
  "slug": "my-project",
  "title": "My Project",
  "description": "Optional description",
  "repo_identity": "github.com/owner/repo"
}
```

**Response:** `201 Created`

```json
{
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "repo_publish_token": "eyJhbGciOi..."
}
```

**Error responses:** 400 (missing/invalid fields, invalid repo_identity), 401 (auth), 403 (org disabled, quota exceeded), 409 (slug conflict — slug already used **in that organization**; quota slot from a failed write is rolled back).

---

## Admin Endpoints

These endpoints require `Authorization: Bearer <API_KEY>`.

### POST /projects

Register a new documentation project.

**Request body:**

```json
{
  "slug": "my-project",
  "repo_url": "https://github.com/org/repo",
  "title": "My Project Docs",
  "description": "Internal documentation",
  "access_mode": "public",
  "repo_identity": "github.com/org/repo"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `slug` | yes | Unique per organization. |
| `repo_url` | yes | Canonical repo URL (informational). |
| `title` | yes | Display title. |
| `description` | no | Optional. |
| `access_mode` | yes | `public` or `password`. |
| `repo_identity` | no | Canonical identity for CI binding: **`github.com/<owner>/<repo>`** (normalized server-side). Omit if unknown; see [Administrator guide](guides/administrator/index.html). |

**Response:** `201 Created` with the full project object.

---

### POST /projects/:id/approve

Approve a project for publishing. Only projects in `awaiting_approval` status can be approved.

**Response:** `200 OK`

---

### POST /projects/:id/publish-token

**Authentication:** Control Plane **`API_KEY`** (Bearer `NRDOCS_API_KEY`).

Mint a **repo publish** JWT for an **approved** project and insert the corresponding `repo_publish_tokens` row. Used by **`nrdocs admin mint-publish-token`** when a project was created via **`POST /projects`** instead of bootstrap onboard.

**Request body (optional JSON):**

| Field | Required | Description |
|-------|----------|-------------|
| `repo_identity` | no | **`github.com/<owner>/<repo>`**. If omitted, the server uses the project’s stored **`repo_identity`**; one of the two must be set. |

**Response:** `201 Created` with `{ "repo_publish_token": "<JWT>" }`.

---

### POST /projects/:id/disable

Disable a project. Returns 404 to all readers. Data is preserved.

**Response:** `200 OK`

---

### POST /projects/:id/publish

Trigger a build and publish for the project. Project must be `approved`.

**Authentication:** **repo publish** JWT in **`Authorization: Bearer …`** (not the control plane API key). Optionally **`X-Repo-Identity: github.com/owner/repo`** when the token enforces repository binding.

**Request body:**

```json
{
  "repo_content": {
    "project_yml": "...",
    "nav_yml": "...",
    "allowed_list_yml": "...",
    "pages": {
      "getting-started": "# Getting Started\n\nContent...",
      "guides/installation": "# Installation\n\nContent..."
    }
  }
}
```

**Response:** `200 OK` with publish details including `publish_id` and `prefix`.

The `prefix` is the R2 path for this publish version, typically `publishes/<org-slug>/<project-slug>/<publish-id>/`.

---

### DELETE /projects/:id

Delete a project and all associated data (D1 records, R2 artifacts, access config).

**Response:** `200 OK`

---

### POST /admin/overrides

Create an admin access policy override.

**Request body:**

```json
{
  "scope_type": "platform",
  "scope_value": "*",
  "subject_type": "email",
  "subject_value": "blocked@example.com",
  "effect": "deny"
}
```

**Response:** `201 Created`

---

### PUT /admin/overrides/:id

Update an existing admin override. Same body format as create.

**Response:** `200 OK`

---

### DELETE /admin/overrides/:id

Delete an admin override.

**Response:** `200 OK`
