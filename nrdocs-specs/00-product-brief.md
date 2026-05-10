# nrdocs Product Brief

## Purpose

nrdocs is a **serverless, protected-first docs publishing layer for private GitHub repositories**.

Repo owners can publish generated documentation artifacts from their repository. Operators control whether those artifacts are served publicly, behind password protection, or not at all.

The product exists to make documentation from private repositories easy to publish without exposing the repository, without maintaining a separate public docs repository, and without requiring a persistent server.

## One-Sentence Product Definition

> nrdocs lets private GitHub repos upload static docs artifacts to a self-hosted, serverless docs server where visibility and access are controlled only by the operator.

## Primary Promise

For a repo owner, the ideal flow is:

```bash
nrdocs init
git push
```

After that, the repo owner has done their part. The docs artifacts are uploaded. The operator decides whether and how the docs become visible.

For an operator, the ideal flow is:

```bash
nrdocs repos
nrdocs approve OWNER/REPO --access password
```

Approval and access changes take effect immediately. They must never require the repo owner to push again.

## Target Users

### Repo Owners

Repo owners are developers or maintainers of private GitHub repositories. They want to publish documentation from their repository with minimal setup.

Repo owners should not need to understand Cloudflare Workers, R2, D1, access-control internals, publication state machines, or operator policy.

They should only need to know:

1. Where their docs live.
2. How to initialize nrdocs.
3. That pushing the repo publishes the latest docs artifacts.
4. That visibility is controlled by the operator.

### Operators

Operators are trusted administrators of the self-hosted nrdocs installation.

Operators control:

1. Which repos may be served.
2. Whether approved repos are public or password-protected.
3. Passwords for password-protected repos.
4. Auto-approval rules.
5. Deployment-wide security and access defaults.

### Readers

Readers are users visiting the generated docs site.

Readers may only access docs when the operator policy allows it. Readers must not be able to discover pending, disabled, unknown, or unapproved private repo docs.

## Core Mental Model

nrdocs separates **publishing artifacts** from **serving artifacts**.

Publishing means:

```text
GitHub Action builds docs and uploads static artifacts to nrdocs.
```

Serving means:

```text
The nrdocs Worker decides whether a reader may access those artifacts.
```

Publishing is controlled by verified GitHub repository identity.

Serving is controlled by operator approval and access policy.

The repo owner can cause this:

```text
latest successful docs artifact exists
```

Only the operator can cause this:

```text
docs are visible to readers
```

## MVP Scope

The MVP must support:

1. Serverless deployment on Cloudflare Workers.
2. Artifact storage in Cloudflare R2.
3. Metadata/state storage in Cloudflare D1.
4. GitHub Actions based publishing.
5. GitHub OIDC authentication for publish requests.
6. CLI initialization for repo owners.
7. CLI publishing from GitHub Actions.
8. CLI operator commands for listing, approving, disabling, setting access, setting passwords, and managing auto-approval rules.
9. Protected-first behavior for all repos.
10. Manual approval by operator.
11. Auto-approval rules for exact repos and namespace globs.
12. Public access mode for explicitly approved public repos.
13. Password access mode for explicitly approved password-protected repos.
14. Anonymous 404 behavior for unknown, pending, disabled, and unapproved repos.

## MVP Non-Goals

The MVP must not include:

1. A multi-tenant SaaS model.
2. User accounts for repo owners.
3. A web admin UI.
4. Server-side repo cloning.
5. Server-side arbitrary build execution.
6. Persistent servers, daemons, or background workers that require a VM/container.
7. Public R2 bucket access.
8. Repo-owner-controlled effective access policy.
9. Repo-owner-controlled custom domains or arbitrary routes.
10. Repo-owner-controlled security headers.
11. Automatic public access by default.
12. Approval flows that require a second GitHub push.
13. Password setup flows that require a second GitHub push.
14. A full replacement for MkDocs, Docusaurus, or other advanced static site generators.

## Product Positioning

nrdocs is not primarily a documentation generator.

nrdocs is a protected publishing and serving layer.

The docs rendering experience should be simple and useful, but the core product value is:

```text
private GitHub repo → generated static docs artifact → operator-controlled docs site
```

A useful analogy:

> nrdocs is like GitHub Pages for private repos, but self-hosted, serverless, and protected-first.

## System Boundary

The source repository remains private.

The GitHub Action runs inside GitHub and produces static docs artifacts.

The nrdocs Cloudflare Worker receives the artifacts, verifies the GitHub OIDC identity, stores the artifacts in private R2 storage, stores metadata in D1, and serves docs only when operator policy allows it.

The nrdocs serverless installation never clones private repositories and never executes repository code.

## Repo Identity

The primary identity of a repo is the immutable GitHub repository ID from verified OIDC claims.

The display identity is:

```text
OWNER/REPO
```

The display identity may change if a repo is renamed. Security-sensitive decisions should rely on stable GitHub identity, not only the display name.

For MVP routing, docs should be served from deterministic repo-based paths:

```text
https://docs.example.com/OWNER/REPO/
```

Custom slugs and custom domains are out of scope for MVP unless set manually by the operator in a later version.

## Access Philosophy

All repos are protected first.

A repo owner publishing docs never makes the docs public by default.

The default outcome of first publish is:

```text
artifact uploaded
repo discovered
approval pending
access none
anonymous serving returns 404
```

A repo becomes visible only through:

1. Manual operator approval with an explicit access mode.
2. An operator-defined auto-approval rule with an explicit access mode.

Public access is never a fallback. Public access is always an explicit operator decision.

## Serverless Philosophy

nrdocs must not require a persistent server.

Allowed runtime components:

1. Cloudflare Workers for request handling.
2. Cloudflare R2 for private artifact storage.
3. Cloudflare D1 for persistent metadata/state.
4. Cloudflare KV only if needed for configuration/cache.
5. GitHub Actions for builds.
6. GitHub OIDC for publish authentication.

Disallowed runtime components:

1. Long-running app server.
2. VM-hosted backend.
3. Persistent container service.
4. In-memory state required for correctness.
5. Background daemon required for approval or publishing to complete.

Approval and access changes must be metadata-only operations.

## Success Criteria

The MVP is successful when:

1. A repo owner can initialize docs with a simple command.
2. A GitHub push builds and uploads docs artifacts.
3. The GitHub Action succeeds even when the repo is awaiting approval.
4. Pending docs are not visible to anonymous readers.
5. An operator can approve a repo without asking the repo owner to push again.
6. Docs become visible immediately after approval if artifacts already exist.
7. Public access is only enabled by explicit operator policy.
8. Password access works without requiring a repo owner to republish.
9. Auto-approval rules can approve trusted namespaces or exact repos.
10. No persistent server is required.
