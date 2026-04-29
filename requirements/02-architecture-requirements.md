# Architecture Requirements

## Technology direction

The platform should be implementable without AWS.

The expected architecture family is Cloudflare-first, using Cloudflare services for:
- edge delivery
- access enforcement
- serverless control plane
- origin/object storage
- lightweight managed data storage

## High-level architecture

### Control plane
A protected serverless control plane is responsible for:
- admin-authenticated project registration
- publish orchestration
- repository config ingestion during publish
- database updates for effective state
- Cloudflare access reconciliation when needed

### Content plane
Each project repository contains:
- Markdown source content
- explicit nav config
- project config
- optional separate allowed-list declaration file

### Storage/delivery plane
- Projects are served under `docs.example.com/<project-slug>/...` (default org) or `docs.example.com/<org-slug>/<project-slug>/...` (named orgs)
- Static artifacts are stored in platform-managed object storage.
- Direct/static serving is preferred where feasible.
- A Worker routing layer is permitted if needed for correctness, auth integration, or route handling.

## Publish safety requirements

- A publish must only become live after the full content update succeeds.
- Partial publish success must not expose incomplete content.
- The phase 1 design does not require platform-managed historical artifact versions.
- Git history is considered the rollback/history mechanism for phase 1.

## Immutability requirements

The following must be immutable after registration:
- project slug
- repo binding
- project ID
- access mode

Changing any of these requires delete/create of a new project.

## Serving requirements

- Prefer stable URLs without version segments in the public project path.
- Public URLs remain stable under the chosen prefix (`/<project>/…` or `/<org>/<project>/…`).
- The platform must not require public URL changes on deploy.

## Sync requirements

- Repository config is read and applied only on publish.
- If repository config changes without a publish, platform state is not updated.
- Publish may skip DB/Cloudflare sync if there are no relevant config changes.

## Disable/delete requirements

### Disable
- Disabling a project makes it inaccessible.
- Disabled projects return `404`.
- Disabled projects cannot publish.

### Delete
- In phase 1, delete is an action, not a persistent lifecycle status.
- Deleting a project removes it from the system state.
