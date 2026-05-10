# nrdocs System Architecture

## Purpose

This document specifies the architecture for nrdocs.

nrdocs is a **serverless, protected-first docs publishing layer for private GitHub repositories**. The system allows repo owners to upload generated docs artifacts, while operators control whether those artifacts are visible and how they are accessed.

This document is normative. Implementation choices must not violate the invariants in [`01-non-negotiable-invariants.md`](./01-non-negotiable-invariants.md).

## Architectural Summary

nrdocs has three request paths:

```text
Repo owner path:
  GitHub repo
    -> GitHub Actions
    -> nrdocs Worker API
    -> R2 artifact storage
    -> D1 metadata

Operator path:
  nrdocs CLI
    -> nrdocs Worker API
    -> D1 metadata

Reader path:
  Browser
    -> nrdocs Worker serving route
    -> D1 policy lookup
    -> R2 artifact fetch, only if allowed
```

The system has no persistent application server. All server-side application logic runs in Cloudflare Workers or equivalent serverless request handlers.

## Required Platform Model

The MVP assumes a Cloudflare-based deployment:

| Component | Responsibility |
|---|---|
| Cloudflare Worker API | Publish API, operator API, auth verification, metadata writes |
| Cloudflare Worker serving route | Docs routing, access checks, static artifact serving |
| Cloudflare R2 | Private storage for generated docs artifacts |
| Cloudflare D1 | Durable relational metadata and policy state |
| GitHub Actions | Builds docs artifacts from repo source |
| GitHub OIDC | Proves repository identity during publish |
| nrdocs CLI | Repo-owner initialization and operator administration |

Alternative serverless providers may be supported later, but the MVP architecture must preserve the same trust boundaries and lifecycle.

## Non-Persistent Requirement

The following are forbidden in the core architecture:

```text
- Persistent web server
- Long-running application process
- Background daemon
- VM-hosted queue worker
- In-memory authoritative state
- Server-side repo clone service
- Server-side arbitrary build execution
```

All authoritative state must live in durable managed storage such as D1 and R2.

## Main Components

### 1. GitHub Action

The GitHub Action runs inside the repo owner's GitHub repository.

Responsibilities:

1. Build documentation artifacts from repository files.
2. Obtain a GitHub OIDC token.
3. Call the nrdocs publish API.
4. Upload the generated static artifact bundle.
5. Report publish status in CI output.

The GitHub Action is allowed to execute repo-owned build code because it runs inside the repo owner's GitHub Actions environment, not inside nrdocs infrastructure.

The GitHub Action must not require an nrdocs publish token in the repo for MVP. Publish authentication must be based on GitHub OIDC.

### 2. nrdocs Worker API

The Worker API handles machine and operator requests.

Responsibilities:

1. Verify GitHub OIDC tokens for publish requests.
2. Derive repo identity from verified OIDC claims.
3. Accept generated docs artifacts.
4. Store artifacts in private R2.
5. Upsert repo and build metadata in D1.
6. Evaluate auto-approval rules.
7. Handle operator actions such as approve, disable, access changes, and password management.
8. Write audit log entries for security-relevant actions.

The Worker API must not build docs, clone repos, or execute repo-provided commands.

### 3. nrdocs Worker Serving Route

The serving route is the only supported public path for reading docs.

Responsibilities:

1. Resolve incoming request path to a repo identity.
2. Look up repo state and access policy in D1.
3. Return `404` for unknown, pending, disabled, or unapproved repos.
4. Enforce password access when required.
5. Fetch the latest successful artifact from private R2 only after access is allowed.
6. Return static files with safe headers.

The serving route must never expose raw R2 URLs or redirect users to public bucket objects.

### 4. R2 Artifact Storage

R2 stores generated documentation artifacts.

R2 must be private.

Artifacts may exist before a repo is approved. Artifact existence alone must never make docs reachable.

The Worker serving route is the only supported read path for artifacts.

### 5. D1 Metadata Store

D1 stores all authoritative metadata, including:

```text
- GitHub repo identity
- Repo display name
- Approval state
- Effective access mode
- Latest successful build pointer
- Build records
- Password credential metadata
- Auto-approval rules
- Operator tokens or token metadata
- Audit logs
```

D1 is the source of truth for serving decisions.

### 6. nrdocs CLI

The CLI has two usage modes:

```text
Repo-owner mode:
  nrdocs init
  nrdocs publish
  nrdocs doctor

Repo-owner publish status is surfaced through the GitHub Action summary.

Operator mode:
  nrdocs repos
  nrdocs approve
  nrdocs disable
  nrdocs access set
  nrdocs password set
  nrdocs rules add/list/remove
```

Repo-owner commands interact with local repo files and the publish API.

Operator commands call authenticated Worker API endpoints.

The CLI must not require direct D1 or R2 access.

## Data Flow: First Publish

```text
1. Repo owner runs `nrdocs init`.
2. CLI creates docs config and GitHub workflow.
3. Repo owner pushes to GitHub.
4. GitHub Action builds docs artifacts.
5. GitHub Action obtains GitHub OIDC token.
6. GitHub Action calls `POST /api/publish`.
7. Worker verifies OIDC token.
8. Worker derives repo identity from token claims.
9. Worker stores artifacts in private R2.
10. Worker creates or updates repo record in D1.
11. Worker creates build record in D1.
12. Worker marks latest successful build.
13. Worker evaluates auto-approval rules.
14. Worker returns status to GitHub Action.
```

If no auto-approval rule matches, the result is:

```text
Build: ready
Approval: pending
Access: none
Serving: 404
```

The GitHub Action must succeed if build, authentication, and upload succeeded. Pending approval is not an error.

## Data Flow: Manual Approval

```text
1. Operator runs `nrdocs approve OWNER/REPO --access password|public`.
2. CLI calls Worker operator API.
3. Worker authenticates operator request.
4. Worker updates D1 repo policy.
5. Worker writes audit log entry.
6. Next reader request sees updated policy and serves docs if allowed.
```

Manual approval must not copy, rebuild, or move artifacts.

Approval is a metadata-only operation.

## Data Flow: Auto-Approval

```text
1. Publish request completes artifact upload.
2. Worker checks repo identity against enabled auto-approval rules.
3. If a rule matches, Worker sets approval/access according to the rule.
4. Latest successful build becomes serveable immediately under that access mode.
```

Auto-approval rules must specify access mode explicitly.

Example:

```yaml
auto_approval:
  rules:
    - match: noam-r/*
      access: password
    - match: noam-r/public-docs
      access: public
```

A repo config request must never override the access mode defined by the matched operator rule.

## Data Flow: Reader Request

```text
1. Reader requests `/OWNER/REPO/path/to/page`.
2. Worker resolves route to `OWNER/REPO`.
3. Worker reads repo metadata from D1.
4. If repo is unknown, pending, disabled, or unapproved, Worker returns 404.
5. If repo is approved public, Worker fetches file from R2 and returns it.
6. If repo is approved password, Worker validates password session.
7. If password session is missing or invalid, Worker returns login/challenge page.
8. If password session is valid, Worker fetches file from R2 and returns it.
```

Unknown, pending, disabled, and unapproved repos must be indistinguishable to anonymous readers.

## Trust Boundaries

### GitHub Action to Worker API

Trust is established with GitHub OIDC.

The Worker must verify the OIDC token and derive repo identity from token claims.

The request body must not be trusted for repo identity.

### Operator CLI to Worker API

Operator requests must be authenticated with an operator credential.

The operator credential must be deployment-controlled and must not be stored in repo-owner GitHub repositories.

### Reader to Worker Serving Route

Readers are untrusted.

Every docs request must perform access-control checks before reading from R2.

## Protected-First Routing

Default route behavior:

| Repo state | Reader response |
|---|---|
| Unknown | 404 |
| Pending | 404 |
| Disabled | 404 |
| Approved public | Serve artifact |
| Approved password, no session | Password page |
| Approved password, valid session | Serve artifact |
| Approved but no successful build | Non-sensitive unavailable page or 404 |

The MVP should prefer `404` when a response could reveal private repo existence.

## URL Model

For MVP, docs URLs are deterministic:

```text
https://DOCS_BASE_URL/OWNER/REPO/
```

Examples:

```text
https://docs.example.com/noam-r/repoA/
https://docs.example.com/my-company/internal-api/
```

Repo owners must not be able to claim arbitrary custom slugs in MVP.

Custom slugs may be added later only as operator-controlled routes.

## Build Responsibility

Builds happen in GitHub Actions.

nrdocs infrastructure accepts completed static artifacts.

The Worker must not run:

```text
npm install
npm run build
mkdocs build
docusaurus build
arbitrary shell commands
```

inside nrdocs infrastructure.

## Artifact Selection

Each successful publish creates a build record and stores artifacts under a build-specific R2 prefix.

The repo record points to the latest successful build.

Serving reads from:

```text
repo.latest_successful_build_id -> build.artifact_prefix -> R2 object
```

Approval/access state does not change artifact location.

## Failure Isolation

A failed publish must not corrupt the currently served docs.

Required behavior:

```text
- Existing latest_successful_build_id remains unchanged until a new build is fully uploaded and committed.
- Partial uploads are not served.
- Failed build records may be retained for diagnostics.
```

## Caching

Caching is allowed but not authoritative.

The source of truth remains D1 and R2.

A cache must not allow stale public access after a repo is disabled or moved from public to password.

For MVP, prefer correctness over aggressive caching.

## Audit Logging

The Worker API must write audit log entries for:

```text
- Repo auto-approved
- Repo manually approved
- Repo disabled
- Access mode changed
- Password set or changed
- Auto-approval rule added, modified, or removed
- Operator authentication failure, if practical
```

Audit logs should not include plaintext passwords or full artifact contents.

## Security Headers

The serving Worker must set security-conscious headers for docs responses.

At minimum, the security spec must define:

```text
- Content-Security-Policy
- X-Content-Type-Options
- Referrer-Policy
- X-Frame-Options or frame-ancestors in CSP
```

Exact values are specified in [`08-access-control-and-security.md`](./08-access-control-and-security.md).

## Architecture Non-Goals

The MVP does not include:

```text
- SaaS multi-tenancy
- Persistent application server
- Web admin UI
- Repo-owner approval API requests beyond publish/status
- Custom domains per repo
- Custom slugs controlled by repo owners
- Server-side doc builds
- Public R2 bucket hosting
- Direct GitHub App installation flow
```

These may be added later if they preserve protected-first and serverless invariants.

## Acceptance Criteria

An implementation satisfies this architecture when:

1. A repo can publish docs artifacts through GitHub Actions using OIDC.
2. The artifacts are stored in private R2 before approval.
3. Pending repos are not visible to anonymous readers.
4. Operator approval changes only D1 metadata.
5. Docs become available immediately after approval without another GitHub push.
6. Public access never happens without manual approval or an auto-approval rule that explicitly grants public access.
7. Password-protected access can be enabled without rebuilding docs.
8. There is no persistent nrdocs server process.
9. The Worker serving route is the only way to read artifacts.
10. Builds execute in GitHub Actions, not inside nrdocs infrastructure.
