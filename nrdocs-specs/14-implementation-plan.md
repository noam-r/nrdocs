# nrdocs Implementation Plan

## Purpose

This document defines a safe, staged implementation plan for rebuilding nrdocs from scratch.

The plan is designed for LLM-assisted development. Each phase has a narrow goal, explicit deliverables, and acceptance criteria.

Do not skip phases. Later phases rely on invariants established earlier.

## Guiding Build Principles

1. Implement protected-first behavior before convenience features.
2. Implement serverless request/response paths only.
3. Build and upload artifacts before implementing public serving.
4. Keep operator-controlled access separate from repo-owner publishing.
5. Add password/public access only after pending/approved/disabled states are reliable.
6. Add auto-approval only after manual approval works.
7. Add polish only after access-control tests pass.

## Phase 0: Repository Reset and Project Skeleton

### Goal

Create a clean implementation skeleton without carrying over confusing legacy flows.

### Deliverables

```text
package/workspace structure
Cloudflare Worker source directory
CLI source directory
shared types package or module
schema/migrations directory
test directory
basic README pointing to specs
nrdocs deploy command skeleton
```

### Required Decisions

Choose implementation language and package structure.

Recommended:

```text
TypeScript for Worker and CLI
Cloudflare Workers runtime
D1 for metadata
R2 for artifacts
```

### Acceptance Criteria

1. Project installs dependencies cleanly.
2. Tests can run, even if only placeholder tests exist.
3. Worker can run locally with a health endpoint.
4. CLI can print version/help.
5. `nrdocs deploy --dry-run` can run without errors.
6. Legacy concepts like project UUIDs, publish tokens, and challenge pushes are not present in the new public flow.

## Phase 0.5: CLI Local Config and Auth

### Goal

Implement local CLI configuration so operator commands work without manual env var exports.

### Deliverables

```text
local config read/write module
platform-appropriate config path resolution
file permission management (Unix 0700/0600)
nrdocs auth login
nrdocs auth status
nrdocs auth logout
nrdocs config show
nrdocs profiles list/use/remove
credential resolution chain (flags → env → config)
```

### Acceptance Criteria

1. CLI can read/write local config at the platform-appropriate path.
2. Config file is created with restrictive permissions where supported.
3. `nrdocs auth login` validates credentials and saves profile.
4. `nrdocs auth status` reports configured profile without printing secrets.
5. `nrdocs auth logout` removes credentials from profile.
6. Operator commands resolve API URL/token from flags, then env vars, then local config.
7. Missing credentials produce a helpful error pointing to `nrdocs auth login`.
8. `nrdocs deploy` saves the default local profile after successful interactive deployment.
9. `nrdocs deploy --no-save-profile` skips local profile creation.

## Phase 1: Data Model and Migrations

### Goal

Implement D1 schema for repos, builds, access policy, auto-approval rules, password credentials, and audit log. MVP operator auth uses a Worker secret, not a D1 operator token table.

### Deliverables

```text
D1 migration files
schema types
query helpers
state transition helpers
unit tests for state transitions
```

### Required Tables

Minimum tables:

```text
repos
builds
password_credentials
auto_approval_rules
audit_log
```

See `04-data-model.md` for exact conceptual fields.

### Acceptance Criteria

1. A repo can be upserted by immutable GitHub repository ID.
2. `owner/repo` is stored as display identity.
3. A repo can exist with `approval_state = pending` and `access_mode = none`.
4. A build can be marked `ready` without making the repo visible.
5. Manual approval updates only repo policy metadata.
6. Disabled repos cannot be served.
7. Tests cover valid and invalid state combinations.

## Phase 2: Worker API Foundation

### Goal

Create the API structure, authentication middleware, error schema, and basic operator endpoints.

### Deliverables

```text
Worker router
JSON response helpers
standard error schema
operator authentication middleware
GET /api/health
GET /api/repos
GET /api/repos/:owner/:repo
POST /api/repos/:owner/:repo/approve
POST /api/repos/:owner/:repo/disable
POST /api/repos/:owner/:repo/access
```

### Acceptance Criteria

1. All errors use the standard schema from `12-error-handling-and-statuses.md`.
2. Operator endpoints reject unauthenticated requests.
3. Approval requires explicit access mode: `public` or `password`.
4. Approval/access changes do not touch artifacts.
5. Pending and disabled states are represented correctly in API responses.
6. Audit log records approval, disable, and access changes.

## Phase 3: Artifact Storage Without Public Serving

### Goal

Implement R2 artifact storage and metadata linking, without serving docs publicly yet.

### Deliverables

```text
artifact upload helper
artifact validation helper
R2 key generation
build record creation
latest_successful_build pointer updates
artifact size checks
```

### Acceptance Criteria

1. Artifacts are stored under non-public, non-guessable internal prefixes.
2. R2 bucket is private.
3. Uploading a new ready artifact updates `latest_successful_build_id`.
4. A failed upload does not replace the previous successful build.
5. Approval state is not required for artifact storage.
6. Artifact keys are not exposed as public URLs.

## Phase 4: GitHub OIDC Publish Endpoint

### Goal

Implement secure publishing from GitHub Actions using OIDC.

### Deliverables

```text
GitHub OIDC verifier
POST /api/publish
repo identity derivation from OIDC claims
repo upsert on publish
build metadata creation
artifact upload path
publish response status summary
```

### Required Security Behavior

1. Repo identity must be derived from verified OIDC claims.
2. Request body must not be trusted for repo identity.
3. Publish must not require operator approval.
4. Publish must not make docs visible by itself.
5. Pending approval must produce success when artifact upload succeeds.

### Acceptance Criteria

1. Valid OIDC token can publish artifacts.
2. Invalid OIDC token is rejected.
3. Claim mismatch is rejected.
4. First publish for unknown repo creates pending repo with `access_mode = none` unless auto-approval is already implemented later.
5. Publish response includes repo, build, serving status, and URL.
6. GitHub Action can treat pending approval as success.

## Phase 5: Minimal CLI: `init`, `publish`, `status`

### Goal

Implement repo-owner CLI flows.

### Deliverables

```text
nrdocs init
nrdocs publish
nrdocs doctor
repo config parser
Markdown-to-HTML renderer
artifact packager
GitHub Actions OIDC token retrieval in CI
GitHub Action step summary output
```

### Acceptance Criteria

1. `nrdocs init` creates `docs/nrdocs.yml`, `docs/index.md`, and `.github/workflows/nrdocs.yml`.
2. `nrdocs publish` validates config before upload.
3. `nrdocs publish` exits `0` when artifacts upload successfully and approval is pending.
4. `nrdocs publish` exits non-zero for invalid config, failed build, failed auth, or failed upload.
5. Generated workflow includes `id-token: write` and `contents: read`.
6. No publish token or repo UUID is required.

## Phase 6: Docs Serving Path, Public Access Only

### Goal

Implement Worker docs serving through the access-control path, initially for approved public repos.

### Deliverables

```text
route resolver for /:owner/:repo/*
policy lookup
artifact lookup
R2 object serving
MIME type handling
404 behavior for unknown/pending/disabled
```

### Acceptance Criteria

1. Unknown repos return 404.
2. Pending repos return 404.
3. Disabled repos return 404.
4. Approved public repos with ready artifacts return 200 for existing files.
5. Missing files inside approved repos return 404.
6. Serving always goes through Worker policy checks.
7. R2 is not public.

## Phase 7: Operator CLI

### Goal

Implement operator commands that call Worker API.

### Deliverables

```text
nrdocs repos
nrdocs approve OWNER/REPO --access public|password
nrdocs disable OWNER/REPO
nrdocs access set OWNER/REPO public|password
nrdocs password set OWNER/REPO
nrdocs rules list
nrdocs rules add OWNER/* --access public|password
nrdocs rules remove RULE_ID
```

Password commands are implemented in Phase 8. Earlier phases must not expose password-protected repos as live until Phase 8 is complete.

### Acceptance Criteria

1. Operator commands require operator authentication.
2. `approve` requires explicit access.
3. Commands print clear before/after state.
4. Commands never require repo owner to push again.
5. Errors use stable messages and exit codes.

## Phase 8: Password-Protected Access

### Goal

Implement operator-managed password protection for approved repos.

### Deliverables

```text
password credential storage
password hashing
password set/rotate API
password login page
password verification endpoint or form handler
signed session cookie
session validation in serving path
```

### Acceptance Criteria

1. Passwords are never stored or returned in plaintext.
2. Approved password repos show password page without valid session.
3. Valid password creates a session.
4. Valid session allows artifact serving.
5. Invalid password does not disclose sensitive details.
6. Pending/disabled repos still return 404, not password page.
7. Switching a repo from public to password takes effect immediately.
8. Switching a repo from password to public takes effect immediately.

## Phase 9: Auto-Approval Rules

### Goal

Implement operator-managed auto-approval rules.

### Deliverables

```text
auto rule table/API
rule matching helper
rule precedence logic
CLI rules commands
publish-time rule evaluation
`--apply-existing` evaluation for existing pending repos
```

### Acceptance Criteria

1. Rules support only `OWNER/*` and `OWNER/REPO` patterns.
2. Rule must specify `access = public|password`.
3. Exact repo match has higher precedence than namespace match.
4. Matching rule can approve a repo and set access mode.
5. Matching rule cannot grant any other privileges.
6. Repo config cannot override rule access mode.
7. Auto-approval events are audit-logged.

## Phase 10: Rendering and Content Hardening

### Goal

Finalize Markdown rendering, navigation, sanitization, and content restrictions.

### Deliverables

```text
Markdown renderer
Raw HTML escaping
navigation generator
static asset handling
security headers
content validation tests
```

### Acceptance Criteria

1. Markdown files render consistently.
2. Raw HTML is escaped according to `10-rendering-and-content-model.md`; repo-provided JavaScript is not supported.
3. Arbitrary JavaScript is not allowed by default.
4. Generated docs include navigation.
5. Security headers are applied by Worker.
6. Content cannot escape its artifact prefix through path traversal.

## Phase 11: Observability and Audit

### Goal

Make the system operable without a persistent server.

### Deliverables

```text
audit log APIs or CLI view
structured logs
request IDs
publish summaries
operator status summaries
```

### Acceptance Criteria

1. Important state changes are audit-logged.
2. Failed auth attempts are audit-logged safely.
3. Logs do not include secrets.
4. CLI can show pending repos and recent publish failures.
5. GitHub Action summaries are useful for repo owners.

## Phase 12: Full Test Matrix and Hardening

### Goal

Verify correctness against the test plan before calling the rewrite complete.

### Deliverables

```text
unit tests
integration tests
Worker route tests
CLI tests
access-control matrix tests
OIDC verifier tests
auto-approval tests
password session tests
artifact storage tests
```

### Acceptance Criteria

1. All access-control matrix cases pass.
2. Public access is impossible without explicit operator policy.
3. Pending approval never causes publish failure.
4. Approval never requires another push.
5. Password access never serves content before validation.
6. Unknown/pending/disabled repos return 404 to anonymous readers.
7. Build failures do not destroy previous successful builds.
8. No persistent server component exists.

## Suggested Implementation Order Summary

```text
0. Skeleton
1. D1 schema
2. Worker API foundation
3. R2 artifact storage
4. GitHub OIDC publish endpoint
5. Repo-owner CLI
6. Public serving path
7. Operator CLI
8. Password access
9. Auto-approval rules
10. Rendering/content hardening
11. Observability/audit
12. Full test matrix
```

## Features Explicitly Deferred Beyond MVP

Do not implement these until the MVP is correct:

```text
multi-tenant SaaS organizations
GitHub OAuth web UI for repo owners
repo-owner API requests for operator actions
custom domains
custom slugs
repo-owner-managed passwords
server-side repository cloning
server-side docs builds
background workers requiring persistent compute
search indexing
versioned docs
rollback UI
analytics
comments
team/user invite system
```

## Definition of Done for MVP

The MVP is complete when this flow works end to end:

```text
1. Repo owner runs nrdocs init.
2. Repo owner pushes to GitHub.
3. GitHub Action builds docs and publishes artifacts using OIDC.
4. nrdocs stores artifacts and records repo as pending.
5. Anonymous readers get 404.
6. Operator runs nrdocs approve OWNER/REPO --access password.
7. Operator sets password.
8. Reader enters password and can view docs.
9. Repo owner pushes another docs change.
10. New docs are served without reapproval.
11. Operator changes access to public.
12. Docs become public immediately without another push.
```

The MVP is not complete if any of these are true:

```text
repo owner can make docs public without operator policy
approval requires a new GitHub push
password setup requires a challenge push
pending repos are visible to anonymous readers
R2 objects are directly public
server-side code runs persistently
server clones private repos
```
