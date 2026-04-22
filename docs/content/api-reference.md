# API Reference

The Control Plane exposes a REST API for managing projects. All endpoints require `Authorization: Bearer <API_KEY>`.

## Endpoints

### POST /projects

Register a new documentation project.

**Request body:**

```json
{
  "slug": "my-project",
  "repo_url": "https://github.com/org/repo",
  "title": "My Project Docs",
  "description": "Internal documentation",
  "access_mode": "public"
}
```

**Response:** `201 Created` with the full project object.

---

### POST /projects/:id/approve

Approve a project for publishing. Only projects in `awaiting_approval` status can be approved.

**Response:** `200 OK`

---

### POST /projects/:id/disable

Disable a project. Returns 404 to all readers. Data is preserved.

**Response:** `200 OK`

---

### POST /projects/:id/publish

Trigger a build and publish for the project. Project must be `approved`.

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
