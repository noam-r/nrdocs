# System Architecture

## Topology

```text
GitHub Repo
  -> GitHub Actions publish workflow
    -> Admin/control API validation + orchestration
      -> Platform DB sync
      -> R2 content upload
      -> Cloudflare access reconcile (when needed)

Viewer request -> Cloudflare Worker -> project lookup -> auth decision -> R2 content
```

## Main components

### 1. Project repository
Each project lives in one repository.
The repository contains:
- content
- project metadata/config
- navigation config
- optional allow-list declarations

The repository is the source of project-owner intent, but not the source of effective access truth.

### 2. GitHub Actions workflow
Each repo exposes a publish workflow.
The workflow is responsible for:
- checking out source
- building the static site from the custom format
- invoking or cooperating with platform sync rules
- uploading generated artifacts to R2

The workflow is externally triggered after explicit registration/approval.

### 3. Admin/control API
The control plane is publish-focused in phase 1.
It is responsible for:
- registering a project
- validating the repo binding
- enforcing approval requirement
- triggering publish
- syncing repo-derived state into the DB when publishing
- reconciling edge access configuration when necessary

### 4. Platform database
The DB stores authoritative effective state, including:
- project registry
- project status
- immutable repo binding
- access mode
- admin overrides
- repo-derived desired access
- password hash for password projects

### 5. Cloudflare Worker
The Worker is a thin request/auth layer in front of content.
It is required because the platform supports password-gated projects and project-aware request handling.

Responsibilities:
- parse slug from request path
- load project metadata
- enforce project status behavior
- enforce `public` vs `password`
- serve content from R2
- return project login page when required

### 6. R2
R2 stores built project artifacts.
Artifacts are stored under stable project paths so project URLs remain fixed.

## Why a Worker is included
A Worker is included because password mode requires server-side request handling:
- verifying submitted password against a stored hash
- issuing a session
- checking that session before serving protected content

A purely static bucket cannot perform those operations.

## Serving model
The platform prefers direct/static serving semantics where possible, but a Worker is always present as the thin gateway.
In practice:
- public content is served with minimal Worker logic
- protected content is served only after Worker auth checks

This preserves a simple operational model while supporting protected content.
