# 08 - Access Control and Security

## Status

Draft for MVP rewrite.

## Depends on

- `00-product-brief.md`
- `01-non-negotiable-invariants.md`
- `02-user-flows.md`
- `03-system-architecture.md`
- `04-data-model.md`
- `05-api-spec.md`
- `06-cli-spec.md`
- `07-github-action-spec.md`

## Purpose

This document defines the security model for nrdocs MVP.

The most important security boundary is:

> Repo owners can upload generated docs artifacts, but only operators can make those artifacts visible.

## Security goals

nrdocs must protect:

1. Private repo existence from anonymous enumeration.
2. Uploaded docs artifacts before approval.
3. Password-protected docs from unauthenticated readers.
4. Operator APIs from repo owners and readers.
5. Artifact storage from direct public access.
6. The platform from arbitrary server-side code execution.

## Non-goals for MVP security

MVP does not provide:

- multi-tenant SaaS isolation;
- per-user reader accounts;
- GitHub OAuth reader auth;
- repo-owner self-service access changes;
- audit-grade compliance reporting;
- WAF-level bot protection;
- malware scanning of artifacts.

These may be added later, but the MVP must not accidentally imply they exist.

## Actor model

| Actor | Auth mechanism | Allowed actions |
|---|---|---|
| Repo owner GitHub Action | GitHub OIDC | Upload artifacts for its own verified repo identity |
| Operator CLI | Operator bearer token | Approve, disable, set access, set passwords, manage rules, inspect state |
| Anonymous reader | None | Read only public approved docs |
| Password-authenticated reader | Password session cookie | Read one password-protected approved docs site |

## Protected-first rule

All repos are protected by default.

A newly discovered repo must start as:

```text
approval_state = pending
access_mode = none
serving = not_visible
```

Public access must only happen after an explicit operator policy:

1. manual approval with `access_mode = public`; or
2. auto-approval rule with `access_mode = public`.

There is no default path from publish to public.

## GitHub OIDC publishing authentication

### Requirement

`POST /api/publish` must authenticate using a GitHub OIDC token.

No long-lived repo publish token is allowed in MVP.

### Token verification

The Worker API must verify:

- token signature using GitHub's OIDC issuer keys;
- issuer is GitHub Actions;
- audience is the expected nrdocs audience;
- token is not expired;
- token is not used outside allowed clock skew;
- repository claims are present.

### Required claims

At minimum, the server needs:

```text
repository
repository_id
repository_owner
repository_owner_id
ref
sha
workflow_ref
run_id
```

The implementation may validate additional claims.

### Authoritative identity

The authoritative repo identity is derived from verified OIDC claims.

The request body must not be trusted for:

- owner;
- repo name;
- GitHub repository ID;
- repository owner ID;
- approval state;
- access mode.

### Stable identity

The stable repo identity should be GitHub `repository_id`.

The display identity should be `owner/repo`.

Reason: `owner/repo` can change after rename or transfer.

## Repo rename and transfer handling

### Rename

If GitHub `repository_id` matches an existing repo but `owner/repo` changed, the server may update display fields.

This should be audited.

### Transfer

If `repository_id` matches but `repository_owner_id` changes, be conservative.

Recommended MVP behavior:

```text
approval_state = pending
access_mode = none
reason = repository_owner_changed
```

The operator must reapprove.

This prevents an approved repo from silently moving to a different owner namespace.

## Operator authentication

Operator API endpoints require a bearer token:

```text
Authorization: Bearer <operator-token>
```

The operator token must never be accepted on publish endpoints as a substitute for GitHub OIDC unless a future spec explicitly adds an admin upload mode.

### Token storage

Operator tokens should be stored as hashes when persisted.

Plaintext operator tokens must not be logged.

### Token scope

MVP may use one admin scope:

```text
operator
```

Later versions may add narrower scopes.

## Reader access model

Reader requests go through the Worker serving path:

```text
request -> resolve route -> read D1 policy -> validate access -> fetch R2 artifact -> respond
```

The Worker must never fetch and return an artifact before policy checks pass.

## Anonymous serving behavior

For anonymous readers:

| Repo state | Response |
|---|---|
| unknown | 404 |
| pending | 404 |
| disabled | 404 |
| approved public with artifact | 200 |
| approved public without artifact | 404 or safe empty state |
| approved password without session | password page |
| approved password with invalid session | password page |

Pending repos must not return a public “awaiting approval” page to anonymous readers.

## Password-protected access

### Password ownership

Passwords are operator-managed in MVP.

Repo owners must not set effective password policy through repo config.

### Password storage

Store password hashes only.

MVP must use Web Crypto PBKDF2-HMAC-SHA-256 with a per-password random salt, a deployment-configured iteration count (default 100,000), and a stored password version for session invalidation.

Do not store plaintext passwords. Argon2id may be considered in a later version only if a Workers-compatible implementation is selected and performance-tested.

### Password verification

The password form posts to a Worker endpoint scoped to the repo route.

On success, the Worker sets a secure session cookie.

### Cookie requirements

Password session cookies must be:

```text
HttpOnly
Secure
SameSite=Lax or Strict
Path scoped to the docs site path when possible
Expires/Max-Age limited
```

Example path scoping:

```text
Path=/noam-r/repoA/
```

This prevents one docs site's password session from automatically applying to all sites.

### Session storage

MVP options:

1. Signed encrypted cookie containing repo ID and expiry.
2. Opaque session ID stored in KV/D1.

Signed encrypted cookie is simpler and serverless-friendly.

The cookie must include or bind to:

```text
repo_id
access_mode
expiry
password_version
```

Including `password_version` allows password rotation to invalidate old sessions.

### Password page behavior

For approved password-protected repos, unauthenticated readers may see a password page.

The page must not expose private repo metadata beyond what is already in the URL.

Avoid showing GitHub private repo details unless the operator has approved that route.

## Access mode semantics

### `none`

Not serveable.

Used for pending repos, disabled repos, or repos without an effective access policy.

### `public`

Serveable to anonymous readers if approved and artifact exists.

Only set by operator policy.

### `password`

Serveable only after password/session validation.

Only set by operator policy.

If no password credential exists, the repo remains not readable by docs users even if approved.

## Approval semantics

Approval applies to a repo identity, not to a single build.

A later successful upload from the same approved repo may become visible immediately under the existing access policy.

Approval must not be stored inside artifacts.

Approval must not require copying artifacts to another bucket or path.

## Auto-approval rules

Auto-approval rules are operator policies.

They may match:

```text
owner/*
owner/repo
```

Each rule must specify an access mode:

```text
public
password
```

There must be no auto-approval rule with implicit access.

### Rule matching

The server evaluates rules against verified OIDC identity, not user-supplied body fields.

### Rule effect

A matching auto-approval rule may set:

```text
approval_state = approved
access_mode = <rule access mode>
```

A rule must not allow the repo to control:

- password value;
- custom domain;
- custom route outside its safe namespace;
- security headers;
- redirects;
- global config.

### Existing pending repos

Adding a new auto-approval rule must not silently approve existing pending repos unless the operator explicitly requests that behavior.

## Artifact storage security

R2 buckets must be private.

Artifacts must not be directly addressable by public R2 URLs.

All docs traffic must go through the Worker serving path.

### Object keys

Object keys should not be treated as a security boundary, but they should avoid obvious public predictability.

Prefer keys like:

```text
artifacts/{internal_repo_id}/{build_id}/{content_hash}/...
```

Avoid serving directly from keys like:

```text
sites/noam-r/repoA/latest/index.html
```

The Worker may internally map stable routes to artifact prefixes.

## Route safety

MVP route format:

```text
/<owner>/<repo>/...
```

The route is derived from verified GitHub identity and platform records.

Repo owners must not claim arbitrary routes in MVP.

Reserved paths must not be available as repo owner or repo names in routing logic, including:

```text
/api
/admin
/login
/logout
_assets
```

GitHub owner/repo names should be normalized and validated before route use.

## Path traversal protection

Artifact upload and serving must reject or sanitize paths containing:

```text
../
absolute paths
backslash traversal
URL-encoded traversal
symlink escape
control characters
```

The artifact manifest should contain normalized relative paths only.

## Content security

Generated docs are untrusted content.

Even if a repo is approved, its docs can contain dangerous HTML or JavaScript.

### MVP recommendation

Default MVP must:

- render Markdown with raw HTML disabled by escaping raw HTML;
- disallow arbitrary repo-provided JavaScript;
- use a strict Content Security Policy;
- avoid shared-origin script execution between docs sites.

Markdown links and Markdown images may reference external URLs. That does not imply support for raw HTML, external scripts, iframes, forms, or active content in MVP.

### Security headers

Docs responses should include headers such as:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer-when-downgrade or stricter
Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'self'
```

The exact CSP depends on the renderer and static assets.

Repo content must not be allowed to set or override platform security headers.

## MIME type handling

The Worker must determine MIME types safely.

Do not trust uploaded MIME types blindly.

Use file extension and a known allowlist.

Unknown local asset file types must be rejected by artifact policy in MVP unless the operator explicitly extends the allowlist.

## Redirect and header safety

Repo config must not control:

- `Set-Cookie`;
- `Content-Security-Policy`;
- `Access-Control-Allow-Origin`;
- `Location` redirects;
- `X-Frame-Options`;
- cache policy for protected pages.

Redirect support is out of scope for MVP unless separately specified.

## Caching rules

Public docs may be cached more aggressively.

Password-protected docs must be cached carefully.

Recommended:

```text
Public docs static assets: cacheable
Public HTML: short or moderate cache
Password-protected HTML/assets: private/no-store unless proven safe
Pending/disabled/404: short cache or no-store
```

Do not let a previously public artifact remain publicly cached after an operator switches access to password or disables the repo.

For MVP, choose conservative caching.

## Audit logging

Security-relevant events must be recorded:

```text
publish_uploaded
publish_rejected
repo_created
repo_auto_approved
repo_manually_approved
repo_disabled
access_changed
password_updated
auto_rule_created
auto_rule_removed
operator_token_used or operator_action
repo_identity_changed
repo_owner_changed
```

Audit records should include:

```text
timestamp
actor_type
actor_id when available
action
target_repo_id when applicable
metadata JSON without secrets
```

Do not log tokens or passwords.

## API error privacy

Public reader routes should avoid revealing whether a private repo exists.

Use `404` for:

- unknown;
- pending;
- disabled;
- unapproved.

Operator APIs can return detailed state because they require operator auth.

Publish API can return detailed status to the authenticated GitHub Action for that repo.

## Rate limiting and abuse controls

### Password Attempt Throttling (MVP Required)

MVP must implement password brute-force protection:

```text
Threshold: 5 failed attempts per repo per client key per 5 minutes
Lockout duration: 5 minutes
Client key: IP address by default, or Cloudflare-provided client identifier (e.g., CF-Connecting-IP) when available
Lockout response: Return password page with generic error; do not reveal lockout reason to attacker
```

After lockout expires, the client may attempt again.

### Other Rate Limits (Deferred to Post-MVP)

The following rate limits are deferred to post-MVP, relying on Cloudflare platform limits as the baseline:

```text
- Publish rate limiting by repo identity
- Operator API rate limiting
- Maximum artifact size (enforced by upload validation, not rate limiting)
- Request body size limits (enforced by Cloudflare Worker limits)
```

Serverless platform limits (Worker CPU time, request size, subrequest count) serve as natural rate limiting for MVP.

## Serverless security boundary

nrdocs infrastructure must not execute repo-provided code.

Builds run in GitHub Actions, under the repo owner's GitHub environment.

Cloudflare Workers only:

- verify identity;
- validate artifacts;
- store artifacts;
- mutate metadata;
- enforce access;
- serve static content.

## Secrets inventory

MVP secrets include:

```text
operator token (NRDOCS_OPERATOR_TOKEN) - Worker secret
session signing/encryption key (NRDOCS_SESSION_SECRET) - Worker secret, auto-generated by nrdocs deploy
password hashes - stored in D1
OIDC audience/config values - Worker environment variables
```

### NRDOCS_SESSION_SECRET

This secret signs and encrypts password-session cookies.

Required properties:

1. Auto-generated by `nrdocs deploy` during first deployment.
2. Stored only as a Cloudflare Worker secret.
3. Never stored in D1, R2, repo config, or audit logs.
4. Rotating this secret invalidates all active password sessions immediately.
5. The operator does not need to manage it manually unless rotation is desired.
6. Minimum 256 bits of cryptographic randomness.

Not MVP secrets:

```text
repo publish token
repo password in GitHub secrets
R2 public access token
```

## Security acceptance tests

The implementation must pass tests for:

1. Unknown repo route returns 404.
2. Pending repo with uploaded artifact returns 404 to anonymous reader.
3. Disabled repo with artifact returns 404.
4. Approved public repo serves artifact.
5. Approved password repo without session shows password page, not artifact.
6. Approved password repo with valid session serves artifact.
7. Repo owner cannot set effective access through `nrdocs.yml`.
8. Publish endpoint rejects mismatched request body repo identity.
9. Publish endpoint derives repo from OIDC token.
10. Operator endpoints reject missing/invalid token.
11. R2 objects are not publicly reachable.
12. Path traversal in artifact is rejected.
13. Raw HTML/script behavior follows renderer security policy.
14. Adding auto-approval rule without access mode is rejected.
15. Manual approval without access mode is rejected.
16. Password rotation invalidates old sessions.
17. Logs do not contain tokens or passwords.

## Non-negotiable security invariants

1. Public is never the fallback.
2. Repo owner upload is not approval.
3. Approval/access changes are metadata-only.
4. All docs serving goes through the Worker access-control path.
5. R2 is private.
6. GitHub OIDC is required for repo publish.
7. Operator token is required for operator actions.
8. Pending/private existence is not leaked to anonymous readers.
9. No persistent server executes repo content.
10. Repo config cannot override platform security policy.

