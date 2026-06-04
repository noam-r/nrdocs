# nrdocs API Spec

## Purpose

This document specifies the HTTP API exposed by the nrdocs Worker.

The API supports two clients:

```text
1. GitHub Actions / repo-owner publish flow
2. Operator CLI / administrative flow
```

The API must preserve the protected-first, serverless architecture described in:

```text
00-product-brief.md
01-non-negotiable-invariants.md
02-user-flows.md
03-system-architecture.md
04-data-model.md
```

## API Design Principles

### 1. Publish Is Not Approval

`POST /api/publish` uploads docs artifacts and records build metadata.

It must not make a repo visible unless an enabled operator-defined auto-approval rule matches.

### 2. Repo Identity Comes from GitHub OIDC

For publish requests, the server must derive repo identity from verified GitHub OIDC claims.

The request body must not be trusted for repo identity.

### 3. Operator Actions Are Metadata-Only

Approving, disabling, changing access mode, and setting passwords must only update metadata.

They must not require a rebuild, push, artifact copy, or artifact rewrite.

### 4. Fail Closed

API validation failures, authentication failures, and unknown states must not accidentally expose docs.

## Base URL

The API lives under:

```text
https://DOCS_BASE_URL/api
```

Example:

```text
https://docs.example.com/api
```

The docs serving routes share the same Worker deployment but are not under `/api`.

## Authentication

### Publish Authentication

Publish endpoints require a GitHub OIDC token.

The client sends the OIDC token using:

```http
Authorization: Bearer <github-oidc-jwt>
```

The Worker must verify:

```text
- JWT signature against GitHub's OIDC issuer
- issuer
- audience
- expiration
- not-before / issued-at where applicable
- repository claims
```

Required claims include, at minimum:

```text
repository
repository_id
repository_owner
repository_owner_id
ref
sha
workflow_ref
run_id or run_number if available
```

The Worker derives:

```text
owner = claim.repository_owner
name = second part of claim.repository
full_name = claim.repository
github_repository_id = claim.repository_id
```

The request body may include display/config metadata but must not override OIDC-derived identity.

### Operator Authentication

Operator endpoints require an operator credential.

For MVP, operator authentication uses exactly one deployment-level operator token configured as a Cloudflare Worker secret.

The Worker must compare the provided token against the configured secret using a constant-time comparison or equivalent safe comparison. Multi-token management and D1-stored operator tokens are future work.

The CLI sends the token using:

```http
Authorization: Bearer <operator-token>
```

Operator tokens must not be used by GitHub Actions and must not be stored in repo-owner repositories.

## Common Response Format

Successful responses return JSON:

```json
{
  "ok": true,
  "data": {}
}
```

Error responses return JSON:

```json
{
  "ok": false,
  "error": {
    "code": "string_code",
    "message": "Human readable message",
    "details": {}
  }
}
```

Error messages must not leak private artifact contents, passwords, raw tokens, or sensitive OIDC material.

## Common HTTP Status Codes

| Status | Meaning |
|---:|---|
| 200 | Successful request |
| 201 | Created |
| 400 | Invalid request |
| 401 | Missing or invalid authentication |
| 403 | Authenticated but not allowed |
| 404 | Repo/rule/resource not found, or intentionally hidden |
| 409 | Conflict or invalid state transition |
| 413 | Artifact too large |
| 422 | Valid JSON but invalid semantic input |
| 500 | Internal error |

## Endpoint: POST /api/publish

### Purpose

Upload generated docs artifacts from a GitHub Action and record the latest successful build.

This endpoint is called by `nrdocs publish` inside GitHub Actions.

### Auth

GitHub OIDC bearer token required.

### Request Format

MVP uses a single-request `multipart/form-data` upload through the Worker API.

The artifact archive size must be below the configured `MAX_ARTIFACT_ARCHIVE_SIZE_MB`, which defaults to a Worker-safe limit such as 50 MB. Direct R2 multipart upload and signed upload URLs are future work.

### Multipart Fields

| Field | Required | Description |
|---|---:|---|
| `metadata` | yes | JSON metadata |
| `artifact` | yes | Compressed artifact archive in `.tar.gz` format |

### Metadata Body

```json
{
  "schema_version": 1,
  "site": {
    "title": "My Project Docs",
    "requested_access": "password"
  },
  "artifact": {
    "format": "tar.gz",
    "content_hash": "sha256:...",
    "file_count": 42,
    "size_bytes": 123456
  },
  "nrdocs": {
    "cli_version": "0.1.0"
  }
}
```

### Metadata Validation

`requested_access` is advisory only.

Allowed values:

```text
public
password
```

Missing `requested_access` should be treated as advisory `password` or `null`; it must not cause public access.

### Server Behavior

The Worker must:

```text
1. Verify GitHub OIDC token.
2. Derive repo identity from token claims.
3. If an existing repo record for that immutable GitHub repository ID is `disabled`, reject the publish before artifact validation or storage.
4. Validate metadata and artifact package.
5. Create or update repo record.
6. Create build record with status `uploading`.
7. Store artifact under a build-specific private R2 prefix.
8. Mark build as `success` only after complete upload and validation.
9. Update repo.latest_successful_build_id to the new successful build.
10. If repo is pending, evaluate auto-approval/pre-approval rules.
11. If an auto-approval/pre-approval rule matches, set approval/access according to the rule.
12. Write audit log events.
13. Return current publish and serving status.
```

### Response: Pending Approval

```json
{
  "ok": true,
  "data": {
    "repo": {
      "full_name": "noam-r/repoA",
      "github_repository_id": "123456789"
    },
    "build": {
      "id": "build_123",
      "status": "success",
      "git_sha": "abc123"
    },
    "approval": {
      "state": "pending",
      "source": null
    },
    "access": {
      "mode": "none"
    },
    "serving": {
      "visible": false,
      "reason": "awaiting_operator_approval",
      "url": "https://docs.example.com/noam-r/repoA/"
    }
  }
}
```

### Response: Auto-Approved Password

```json
{
  "ok": true,
  "data": {
    "repo": {
      "full_name": "noam-r/repoA",
      "github_repository_id": "123456789"
    },
    "build": {
      "id": "build_124",
      "status": "success",
      "git_sha": "def456"
    },
    "approval": {
      "state": "approved",
      "source": "auto_rule:rule_001"
    },
    "access": {
      "mode": "password"
    },
    "serving": {
      "visible": false,
      "requires_password": true,
      "reason": "needs_password",
      "url": "https://docs.example.com/noam-r/repoA/"
    }
  }
}
```

### Important Success Rule

If the artifact upload succeeds but the repo is pending approval, the endpoint must return success.

Pending approval is not a publish failure.

### Failure Cases

| Code | HTTP | Meaning |
|---|---:|---|
| `invalid_oidc_token` | 401 | OIDC token is missing or invalid |
| `repo_identity_mismatch` | 400 | Request attempts to override token repo identity |
| `invalid_metadata` | 422 | Metadata schema invalid |
| `invalid_artifact` | 422 | Artifact cannot be unpacked or validated |
| `artifact_too_large` | 413 | Artifact exceeds configured size limit |
| `repo_disabled` | 409 | Repo is disabled; publish is rejected before artifact storage |
| `upload_failed` | 500 | Artifact storage failed |
| `extension_not_permitted` | 422 | Artifact contains a file extension that is not whitelisted and the matching auto-approval rule does not grant `allow_unlisted_assets` |

## Endpoint: GET /api/publish-capabilities

### Purpose

Return publish-time capabilities for the authenticated GitHub repository (OIDC identity). Used by `nrdocs publish` and `nrdocs doctor --ci` before packaging assets.

### Auth

GitHub OIDC required. The repo identity is derived from the token; callers must not override it.

### Response

```json
{
  "ok": true,
  "data": {
    "allow_unlisted_assets": false
  }
}
```

`allow_unlisted_assets` is `true` only when an enabled auto-approval rule matches the repository **and** that rule has `allow_unlisted_assets = true`.

## Endpoint: GET /api/repos

### Purpose

List repos known to nrdocs.

Used by operator CLI.

### Auth

Operator token required.

### Query Parameters

| Parameter | Required | Description |
|---|---:|---|
| `state` | no | Filter by `pending`, `approved`, or `disabled` |
| `access` | no | Filter by `none`, `public`, or `password` |
| `owner` | no | Filter by GitHub owner |
| `limit` | no | Page size |
| `cursor` | no | Pagination cursor |

### Response

```json
{
  "ok": true,
  "data": {
    "repos": [
      {
        "full_name": "noam-r/repoA",
        "github_repository_id": "123456789",
        "approval_state": "pending",
        "access_mode": "none",
        "latest_successful_build": {
          "id": "build_123",
          "git_sha": "abc123",
          "completed_at": "2026-05-07T12:00:00Z"
        },
        "url": "https://docs.example.com/noam-r/repoA/"
      }
    ],
    "next_cursor": null
  }
}
```

## Endpoint: GET /api/repos/:owner/:repo

### Purpose

Get operator-visible status for one repo.

### Auth

Operator token required.

### Response

```json
{
  "ok": true,
  "data": {
    "repo": {
      "full_name": "noam-r/repoA",
      "github_repository_id": "123456789",
      "approval_state": "approved",
      "access_mode": "password",
      "requested_access": "password",
      "site_title": "Repo A Docs",
      "url": "https://docs.example.com/noam-r/repoA/",
      "latest_successful_build": {
        "id": "build_123",
        "git_sha": "abc123",
        "artifact_size_bytes": 123456,
        "completed_at": "2026-05-07T12:00:00Z"
      }
    }
  }
}
```

## Endpoint: POST /api/repos/:owner/:repo/approve

### Purpose

Approve a repo and set its effective access mode.

### Auth

Operator token required.

### Request Body

```json
{
  "access_mode": "password"
}
```

Allowed values:

```text
public
password
```

There is no default. The operator must choose.

### Server Behavior

The Worker must:

```text
1. Authenticate operator.
2. Find repo by owner/repo.
3. Set approval_state = approved.
4. Set access_mode = request.access_mode.
5. Set approved_at and approved_by.
6. Write audit log.
7. Return current repo status.
```

This endpoint must require that a latest successful build exists. Approving a repo without artifacts is rejected. Pre-approval before first publish must use auto-approval rules, not manual approval of repos without verified builds.

### Response

```json
{
  "ok": true,
  "data": {
    "repo": {
      "full_name": "noam-r/repoA",
      "approval_state": "approved",
      "access_mode": "password",
      "url": "https://docs.example.com/noam-r/repoA/"
    }
  }
}
```

## Endpoint: POST /api/repos/:owner/:repo/disable

### Purpose

Disable a repo immediately.

### Auth

Operator token required.

### Request Body

```json
{
  "reason": "optional human-readable reason"
}
```

### Server Behavior

```text
1. Set approval_state = disabled.
2. Optionally set access_mode = none.
3. Preserve builds and artifacts unless cleanup policy says otherwise.
4. Write audit log.
```

Disabled repos must return 404 to anonymous readers.

## Endpoint: POST /api/repos/:owner/:repo/access

### Purpose

Change effective access mode for an approved repo.

### Auth

Operator token required.

### Request Body

```json
{
  "access_mode": "public"
}
```

Allowed values:

```text
public
password
none
```

`none` means approved but not currently serveable.

### Server Behavior

This endpoint updates metadata only. It must not rebuild, move, copy, or modify artifacts.

### Response

```json
{
  "ok": true,
  "data": {
    "repo": {
      "full_name": "noam-r/repoA",
      "approval_state": "approved",
      "access_mode": "public"
    }
  }
}
```

## Endpoint: POST /api/repos/:owner/:repo/password

### Purpose

Set or rotate the password for a password-protected repo.

### Auth

Operator token required.

### Request Body

```json
{
  "password": "new password value"
}
```

### Server Behavior

The Worker must:

```text
1. Authenticate operator.
2. Validate password against deployment password policy.
3. Hash password using Web Crypto PBKDF2-HMAC-SHA-256 with per-password random salt, deployment-configured iteration count (default 100,000), and password version metadata.
4. Store hash, never plaintext.
5. Write audit log without the password.
6. Return success.
```

### Response

```json
{
  "ok": true,
  "data": {
    "repo": {
      "full_name": "noam-r/repoA",
      "access_mode": "password",
      "password_configured": true
    }
  }
}
```

## Endpoint: GET /api/auto-approval-rules

### Purpose

List auto-approval rules.

### Auth

Operator token required.

### Response

```json
{
  "ok": true,
  "data": {
    "rules": [
      {
        "id": "rule_001",
        "pattern": "noam-r/*",
        "access_mode": "password",
        "enabled": true,
        "priority": 0,
        "allow_unlisted_assets": false
      }
    ]
  }
}
```

## Endpoint: POST /api/auto-approval-rules

### Purpose

Create an auto-approval rule.

### Auth

Operator token required.

### Request Body

```json
{
  "pattern": "noam-r/*",
  "access_mode": "password",
  "enabled": true,
  "priority": 0,
  "apply_existing": false,
  "allow_unlisted_assets": false
}
```

`allow_unlisted_assets` is optional. When omitted, the server stores `false` (only whitelisted asset extensions may appear in published artifacts for repos matching this rule).

Allowed pattern forms:

```text
OWNER/*
OWNER/REPO
```

Allowed access modes:

```text
public
password
```

There is no implicit default access mode.

### Server Behavior

The Worker must validate pattern syntax and access mode.

By default, creating a rule affects future publishes only. If `apply_existing` is `true`, the Worker must evaluate the new rule against existing pending repos and apply approval/access to matching pending repos that already have a verified GitHub repository ID. `apply_existing` must never apply to disabled repos.

### Response

```json
{
  "ok": true,
  "data": {
    "rule": {
      "id": "rule_001",
      "pattern": "noam-r/*",
      "access_mode": "password",
      "enabled": true,
      "priority": 0,
      "apply_existing": false
    }
  }
}
```

## Endpoint: PATCH /api/auto-approval-rules/:id

### Purpose

Update fields on an existing auto-approval rule (for example revoke `allow_unlisted_assets` without deleting the rule).

### Auth

Operator token required.

### Request Body

```json
{
  "allow_unlisted_assets": false
}
```

At least one supported field must be present. Supported MVP fields include `allow_unlisted_assets`, `access_mode`, `priority`, and `enabled`.

### Response

Returns the updated rule object (same shape as create/list).

## Endpoint: DELETE /api/auto-approval-rules/:id

### Purpose

Delete or disable an auto-approval rule.

### Auth

Operator token required.

### Server Behavior

For MVP, deletion may either hard-delete the rule or set `enabled = false`.

Removing a rule must not automatically disable repos that were already approved by that rule. Operators can disable those repos separately.

## Endpoint: GET /api/status

### Purpose

Return deployment health and configuration summary.

Used by `nrdocs doctor` and operator diagnostics.

### Auth

Operator token required for full details.

A limited unauthenticated response may be allowed if it does not reveal sensitive configuration.

### Response

```json
{
  "ok": true,
  "data": {
    "service": "nrdocs",
    "version": "0.1.0",
    "storage": {
      "d1": "ok",
      "r2": "ok"
    },
    "base_url": "https://docs.example.com"
  }
}
```

## Endpoint: GET /api/operator/me

### Purpose

Validate operator credentials and return basic operator/deployment info.

Used by `nrdocs auth login` to validate before saving, `nrdocs auth status` to check connectivity, and `nrdocs doctor --operator` to verify operator access.

### Auth

Operator token required.

### Response

```json
{
  "ok": true,
  "data": {
    "operator": {
      "type": "operator_token"
    },
    "deployment": {
      "base_url": "https://docs.example.com",
      "version": "0.1.0"
    }
  }
}
```

### Failure

```json
{
  "ok": false,
  "error": {
    "code": "invalid_operator_token",
    "message": "Operator token is invalid or expired."
  }
}
```

## Endpoint: GET /api/static

### Purpose

List current instance static files.

### Auth

Operator token required.

### Response

```json
{
  "ok": true,
  "data": {
    "files": [
      {
        "key": "homepage",
        "route": "/",
        "source": "bundled_default",
        "size_bytes": 1234,
        "updated_at": "2026-05-07T12:00:00Z"
      },
      {
        "key": "favicon",
        "route": "/favicon.ico",
        "source": "bundled_default",
        "size_bytes": 4286,
        "updated_at": "2026-05-07T12:00:00Z"
      },
      {
        "key": "robots",
        "route": "/robots.txt",
        "source": "bundled_default",
        "size_bytes": 26,
        "updated_at": "2026-05-07T12:00:00Z"
      }
    ]
  }
}
```

## Endpoint: PUT /api/static/:key

### Purpose

Upload or replace an instance static file.

### Auth

Operator token required.

### Path Parameters

`:key` must be one of the allowed static file keys:

```text
homepage
favicon
robots
well-known/<name>
```

### Request

Binary file content with appropriate `Content-Type` header.

### Server Behavior

```text
1. Validate key is in the allowed set.
2. Validate file size is within limits.
3. Store file in R2 or KV under the instance static prefix.
4. Write audit log.
5. Return success.
```

### Response

```json
{
  "ok": true,
  "data": {
    "key": "homepage",
    "route": "/",
    "source": "custom",
    "size_bytes": 2048,
    "updated_at": "2026-05-07T13:00:00Z"
  }
}
```

### Failure Cases

| Code | HTTP | Meaning |
|---|---:|---|
| `invalid_static_key` | 400 | Key is not in the allowed set |
| `static_file_too_large` | 413 | File exceeds size limit |

## Endpoint: DELETE /api/static/:key

### Purpose

Remove a custom instance static file and revert to the bundled default.

### Auth

Operator token required.

### Path Parameters

`:key` must be one of the allowed static file keys.

### Server Behavior

```text
1. Remove custom file for the key.
2. Revert to bundled default for that route.
3. Write audit log.
4. Return success.
```

### Response

```json
{
  "ok": true,
  "data": {
    "key": "homepage",
    "route": "/",
    "source": "bundled_default",
    "updated_at": "2026-05-07T13:05:00Z"
  }
}
```

## Endpoint: GET /api/audit-log (Optional MVP)

### Purpose

Query audit log entries.

This endpoint is optional for MVP. Audit log writes are required for all security-sensitive operations, but the read/query API may be deferred to a future iteration.

If implemented, the contract must follow this specification.

### Auth

Operator token required.

### Query Parameters

| Parameter | Required | Description |
|---|---:|---|
| `repo` | no | Filter by `owner/repo` |
| `event` | no | Filter by event type |
| `actor` | no | Filter by actor ID |
| `limit` | no | Page size (default 50) |
| `cursor` | no | Pagination cursor |

### Response

```json
{
  "ok": true,
  "data": {
    "events": [
      {
        "id": "evt_001",
        "event_type": "repo.manually_approved",
        "actor_type": "operator",
        "actor_id": "operator",
        "repo_id": "noam-r/repoA",
        "metadata": {},
        "created_at": "2026-05-07T12:14:00Z"
      }
    ],
    "next_cursor": null
  }
}
```

### Implementation Note

MVP must write audit log entries for all security-sensitive operations as defined in `04-data-model.md`. The read API is optional and may be implemented in a later phase.

## Docs Serving Routes

Docs serving routes are not under `/api`.

Canonical route format:

```text
/:owner/:repo/*path
```

Example:

```text
/noam-r/repoA/index.html
/noam-r/repoA/guides/install.html
```

### Serving Behavior

The serving Worker must:

```text
1. Resolve `owner` and `repo` from path.
2. Find repo in D1 by full_name.
3. If missing, pending, disabled, or unapproved: return 404.
4. If approved but no latest successful build: return 404 or unavailable page.
5. If access_mode = public: serve requested file.
6. If access_mode = password: validate session or show password page.
7. Fetch files only from private R2 through Worker.
```

### Password Login Route

The implementation may use internal routes such as:

```text
/_nrdocs/login
/_nrdocs/logout
```

These routes must avoid leaking whether a pending or disabled repo exists.

Password session behavior is specified in `08-access-control-and-security.md`.

## Idempotency

`POST /api/publish` may be retried by GitHub Actions.

The API should support safe retries by using some combination of:

```text
- GitHub repository_id
- git_sha
- run_id
- artifact content hash
```

A retry must not create inconsistent latest build pointers.

Operator endpoints should be idempotent where practical:

```text
Approving an already approved repo with the same access mode should succeed.
Disabling an already disabled repo should succeed.
Setting the same access mode should succeed.
```

## Privacy Requirements

API responses visible to GitHub Actions may reveal status for that repo only.

Anonymous docs readers must not receive API-like status for pending or disabled repos.

Operator APIs may reveal pending repo names because operators are trusted.

## Versioning

The MVP API may be unversioned under `/api`, but request/response bodies should include schema versions where useful.

If breaking API changes are expected, introduce:

```text
/api/v1/...
```

before external usage grows.

## Acceptance Criteria

An implementation satisfies this API spec when:

1. GitHub Actions can publish artifacts with OIDC and no repo-stored nrdocs publish token.
2. The publish endpoint derives repo identity from OIDC, not request body.
3. Publishing pending docs returns success and reports pending status.
4. Manual approval immediately makes existing artifacts serveable according to chosen access mode.
5. Public access requires explicit operator action or auto-approval rule with `access_mode = public`.
6. Auto-approval rules require explicit access mode.
7. Operator actions are authenticated and metadata-only.
8. Password setting stores only hashes and requires no rebuild.
9. Unknown, pending, disabled, and unapproved repos are hidden from anonymous readers.
10. Failed publish attempts do not replace the latest successful served build.
