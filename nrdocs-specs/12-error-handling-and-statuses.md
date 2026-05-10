# nrdocs Error Handling and Statuses

## Purpose

This document defines how nrdocs reports status and errors across the API, CLI, GitHub Actions, and docs serving path.

The goal is consistency. The same platform state must be described the same way everywhere.

This document depends on:

- `01-non-negotiable-invariants.md`
- `04-data-model.md`
- `05-api-spec.md`
- `06-cli-spec.md`
- `07-github-action-spec.md`
- `08-access-control-and-security.md`

## Core Rule

A publish may succeed even when docs are not visible.

Visibility is controlled by operator approval and access policy. Lack of approval is not a publish failure.

Therefore:

```text
build/upload success + pending approval = successful publish operation
```

Not:

```text
pending approval = failed publish operation
```

## Status Dimensions

nrdocs tracks and reports status in separate dimensions.

### Build Status

Build status describes whether static docs artifacts were generated and uploaded.

Allowed values:

```text
missing
uploading
ready
failed
```

Meanings:

| Status | Meaning |
|---|---|
| `missing` | No successful artifact has ever been uploaded for this repo. |
| `uploading` | A publish is currently uploading artifacts. This state should be short-lived. |
| `ready` | At least one successful artifact exists and can be served if policy allows. |
| `failed` | The latest publish attempt failed before producing a usable artifact. |

### Approval Status

Approval status describes whether the operator allows this repo identity to be served.

Allowed values:

```text
pending
approved
disabled
```

Meanings:

| Status | Meaning |
|---|---|
| `pending` | Repo has published artifacts or attempted to publish, but no operator approval applies. |
| `approved` | Repo may be served according to its effective access mode. |
| `disabled` | Repo must not be served, even if artifacts exist. |

### Access Mode

Access mode describes how an approved repo may be served.

Allowed values:

```text
none
public
password
```

Meanings:

| Mode | Meaning |
|---|---|
| `none` | No serving access is configured. This is the protected-first default. |
| `public` | Approved repo is served publicly. |
| `password` | Approved repo is served only after password/session validation. |

### Serving Status

Serving status is derived from build status, approval status, access mode, and password/session state.

Allowed values:

```text
not_found
pending_approval
disabled
no_artifact
public
password_required
password_session_valid
```

This status is shown to operators through authenticated APIs and to repo owners through GitHub Action summaries, not to anonymous readers.

Anonymous readers must not receive detailed status for unknown, pending, disabled, or unapproved repos.

Canonical route redirects for visible docs pages:

```text
/OWNER/REPO                          -> /OWNER/REPO/
/OWNER/REPO/index.html               -> /OWNER/REPO/
/OWNER/REPO/page                     -> /OWNER/REPO/page/
/OWNER/REPO/page.html                -> /OWNER/REPO/page/
/OWNER/REPO/page/index.html          -> /OWNER/REPO/page/
```

Redirects must not reveal unknown, pending, disabled, or unapproved repos to anonymous readers. Perform visibility checks before returning canonicalization redirects.

## Derived Serving Matrix

| Build status | Approval status | Access mode | Reader state | Anonymous HTTP behavior |
|---|---|---|---|---|
| `missing` | any | any | any | `404` |
| `ready` | `pending` | `none` | any | `404` |
| `ready` | `pending` | `public` | any invalid state | `404` |
| `ready` | `pending` | `password` | any invalid state | `404` |
| `ready` | `disabled` | any | any | `404` |
| `ready` | `approved` | `none` | any invalid state | `404` |
| `ready` | `approved` | `public` | anonymous | `200` |
| `ready` | `approved` | `password` | no valid session | password page / `401` |
| `ready` | `approved` | `password` | valid session | `200` |
| `failed` | any | any | any | previous ready build may serve if one exists; otherwise `404` |

Important: `failed` describes the latest publish attempt. It must not automatically remove the previous successful build.

## API Error Schema

All API errors must use a consistent JSON shape.

```json
{
  "error": {
    "code": "string_machine_readable_code",
    "message": "Human readable message.",
    "details": {}
  }
}
```

Rules:

1. `code` is stable and machine-readable.
2. `message` is safe to show in CLI output.
3. `details` may contain structured context, but must not include secrets.
4. API errors must not leak pending private repo existence to anonymous docs readers. This schema is for API clients, not the public docs serving path.

## Standard Error Codes

### Authentication and Authorization

| Code | HTTP | Meaning |
|---|---:|---|
| `missing_authentication` | `401` | Required authentication was not provided. |
| `invalid_operator_token` | `401` | Operator token is invalid, expired, or malformed. |
| `invalid_github_oidc_token` | `401` | GitHub OIDC token could not be verified. |
| `oidc_claim_mismatch` | `403` | OIDC token claims do not match the attempted operation. |
| `operator_permission_denied` | `403` | Authenticated operator is not allowed to perform the action. |

### Repo and Policy

| Code | HTTP | Meaning |
|---|---:|---|
| `repo_not_found` | `404` | Repo is not known to the operator API. |
| `repo_disabled` | `409` | Repo is disabled and cannot be modified by that operation. |
| `invalid_repo_identifier` | `400` | Repo identifier is malformed. |
| `invalid_access_mode` | `400` | Access mode is not `public` or `password` where required. |
| `invalid_auto_approval_rule` | `400` | Auto-approval rule is malformed or unsafe. |
| `rule_conflict` | `409` | Auto-approval rule conflicts with an existing higher-priority rule. |

### Publish

| Code | HTTP | Meaning |
|---|---:|---|
| `invalid_publish_request` | `400` | Publish request is malformed. |
| `invalid_docs_config` | `400` | `nrdocs.yml` is missing or invalid. |
| `artifact_too_large` | `413` | Artifact exceeds configured maximum size. |
| `invalid_artifact_format` | `400` | Uploaded artifact is not a valid nrdocs artifact. |
| `artifact_upload_failed` | `500` | Artifact could not be stored in R2. |
| `metadata_write_failed` | `500` | Repo/build metadata could not be written to D1. |

### Password Access

| Code | HTTP | Meaning |
|---|---:|---|
| `password_required` | `401` | Password-protected docs require authentication. |
| `invalid_password` | `401` | Submitted password is wrong. |
| `password_not_configured` | `409` | Repo is approved for password access, but no password credential exists. |
| `invalid_password_policy` | `400` | Submitted password does not meet operator policy. |

### Generic

| Code | HTTP | Meaning |
|---|---:|---|
| `not_found` | `404` | Resource was not found or must not be disclosed. |
| `conflict` | `409` | Requested mutation conflicts with current state. |
| `rate_limited` | `429` | Client exceeded rate limits. |
| `internal_error` | `500` | Unexpected server error. |

### Local CLI Config

| Code | CLI Exit | Meaning |
|---|---:|---|
| `missing_operator_credentials` | `3` | No API URL/token found from flags, env, or local config |
| `invalid_local_config` | `2` | Config file is malformed or unreadable |
| `insecure_local_config` | `2` | Config file permissions are too broad |
| `profile_not_found` | `2` | Selected profile does not exist in local config |
| `auth_validation_failed` | `3` | API URL/token failed validation against the server |

## API Success Response Shape

Where practical, mutation endpoints should return the updated resource plus a status summary.

Example publish response:

```json
{
  "repo": {
    "full_name": "noam-r/repoA",
    "github_repository_id": "123456789",
    "approval_state": "pending",
    "access_mode": "none"
  },
  "build": {
    "id": "build_01h...",
    "status": "ready",
    "git_sha": "abc123"
  },
  "serving": {
    "visible": false,
    "status": "pending_approval",
    "url": "https://docs.example.com/noam-r/repoA/"
  }
}
```

## GitHub Action Behavior

### Successful Publish, Pending Approval

The GitHub Action must exit with code `0` when docs build and upload successfully, even if approval is pending.

Action summary:

```text
nrdocs publish succeeded

Repo: noam-r/repoA
Build: ready
Approval: pending
Access: none
URL: https://docs.example.com/noam-r/repoA/

Docs were uploaded successfully. They are not visible until an operator approves the repo.
```

### Successful Publish, Auto-Approved Public

Exit code: `0`.

Summary:

```text
nrdocs publish succeeded

Repo: noam-r/repoA
Build: ready
Approval: approved by auto-approval rule noam-r/*
Access: public
URL: https://docs.example.com/noam-r/repoA/
```

### Successful Publish, Auto-Approved Password

Exit code: `0`.

Summary:

```text
nrdocs publish succeeded

Repo: noam-r/repoA
Build: ready
Approval: approved by auto-approval rule noam-r/*
Access: password
URL: https://docs.example.com/noam-r/repoA/

Readers must enter the operator-configured password.
```

### Invalid Docs Config

Exit code: non-zero.

Summary:

```text
nrdocs publish failed

Reason: invalid docs configuration
File: docs/nrdocs.yml
Error: site.title must be a non-empty string
```

### OIDC Failure

Exit code: non-zero.

Summary:

```text
nrdocs publish failed

Reason: GitHub OIDC authentication failed.
The workflow must include permissions:
  id-token: write
  contents: read
```

## CLI Exit Codes

| Exit code | Meaning |
|---:|---|
| `0` | Command succeeded. |
| `1` | General command failure. |
| `2` | Invalid user input or invalid config. |
| `3` | Authentication or authorization failure. |
| `4` | Network/API failure. |
| `5` | Publish/build failure. |

Pending approval is not a CLI failure for `nrdocs publish`.

## Status Output

MVP must not implement unauthenticated local repo-owner `nrdocs status`, because it would require an unspecified authentication model and could leak pending/private repo existence. Repo owners receive status through the GitHub Action summary generated by `nrdocs publish`.

Operator `nrdocs status OWNER/REPO` and `nrdocs repos` require operator authentication and should show operational state:

```text
Repo              Build   Approval  Access    Visible  Updated
noam-r/repoA      ready   pending   none      no       2026-05-07 12:13
noam-r/repoB      ready   approved  password  yes      2026-05-07 11:02
noam-r/repoC      ready   approved  public    yes      2026-05-06 18:44
noam-r/repoD      ready   disabled  none      no       2026-05-05 09:10
```

## Public Docs Serving HTTP Behavior

### Unknown Repo

Return:

```text
404 Not Found
```

Do not disclose whether the path resembles a repo.

### Pending Repo

Return:

```text
404 Not Found
```

Do not show a pending approval page to anonymous readers.

### Disabled Repo

Return:

```text
404 Not Found
```

Do not disclose that the repo was disabled.

### Approved Public Repo

Return the requested artifact with the correct status and MIME type.

Common responses:

| Case | HTTP |
|---|---:|
| Existing file | `200` |
| Missing file inside approved site | `404` |
| Directory with index | `200` |
| Directory without index | `404` |

### Approved Password Repo Without Session

Return either:

```text
200 password login page
```

or:

```text
401 password required
```

MVP recommendation: return `200` with a password page for browser navigation, and `401` for API-like requests only if explicitly needed.

### Approved Password Repo With Invalid Password

Return password page with a generic error:

```text
Invalid password.
```

Do not reveal whether the repo exists beyond what the current password page already implies. Since the password page is only served after approval, this is acceptable.

## Failed Publish and Previous Build Behavior

A failed publish must not delete or replace the previous successful build.

If repo state before publish is:

```text
latest_successful_build_id = build_1
```

and new publish fails, then:

```text
latest_successful_build_id remains build_1
latest_publish_attempt_id = build_2
build_2.status = failed
```

Serving continues using `build_1` if policy allows.

## Audit Log Status Messages

Security-sensitive state changes must be logged with stable event names.

Required events:

```text
repo.discovered
repo.auto_approved
repo.manually_approved
repo.disabled
repo.access_changed
repo.password_set
repo.password_rotated
repo.published
repo.publish_failed
auto_rule.created
auto_rule.deleted
operator.auth_failed
```

Each audit event must include:

```text
event type
repo id when applicable
operator id when applicable
GitHub repo identity when applicable
source IP when available
timestamp
safe metadata
```

Audit logs must not include plaintext passwords, operator tokens, GitHub OIDC tokens, or raw artifact contents.

## Implementation Notes

1. Avoid boolean-only status fields in external responses.
2. Prefer explicit strings over inferred text.
3. Keep repo-owner messages reassuring when publish succeeded but approval is pending.
4. Keep anonymous reader responses intentionally vague.
5. Log detailed internal reasons; expose safe summaries externally.
