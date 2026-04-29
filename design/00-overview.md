# Private Docs Publishing Platform — Design Overview

## Purpose
This design defines a serverless platform for publishing private documentation sites from Markdown repositories under a single domain. Reader paths:

- Default org: `docs.example.com/<project-slug>/…`
- Named org (multi-tenant): `docs.example.com/<org-slug>/<project-slug>/…`

The platform is optimized for:
- one repository per project
- automatic publish after registration/approval
- simple custom Markdown site format
- path-based hosting under a shared domain
- public and protected projects
- a Cloudflare-only delivery and control stack

## Design summary
Each project is represented by a single repository containing:
- Markdown content
- a project configuration file
- a navigation configuration file
- an optional allow-list file

A protected admin/control API registers the project, validates configuration, and triggers publishing.

Publishing performs three actions:
1. build the static site from the repository content
2. sync repo-derived desired state into the platform database
3. reconcile edge access policy if required

Content is stored in Cloudflare R2.
A Cloudflare Worker sits in front of all site requests and acts as a thin request router and authentication gate.

## Core design decisions
- Custom content format, not MkDocs
- One repo per project
- One immutable slug per project (**unique per organization** in D1; not globally unique)
- Explicit project registration in phase 1
- Automatic publish after registration/approval
- Platform DB stores effective state
- Repo config provides project-scoped desired state only
- Repos may only declare `allow` rules for their own project
- Deny always wins
- Public and password-protected projects are supported in phase 1
- Future invite-list mode is expected to integrate with Cloudflare Access

## Conceptual architecture

### Content plane
- Repository per project
- Markdown content and project config files
- GitHub Actions build and publish flow

### Control plane
- Admin API
- Project registration and approval
- Publish orchestration
- Repo-to-DB synchronization
- Edge policy reconciliation

### State plane
- Platform database for projects, policy overrides, and repo-derived desired access state

### Delivery plane
- Cloudflare Worker at `docs.example.com/*`
- R2 as content origin
- Path-based project resolution by organization slug + project slug (legacy single-segment path for default org)
- Authentication gate for protected projects

## Phase scope

### Phase 1
- `public` access mode
- `password` access mode
- explicit registration
- approval required before publish
- single shared docs template
- no search
- no attachments/downloads

### Future phases
- `invite_list` mode
- Cloudflare Access integration for identity-aware access
- richer admin application
- templating expansion
- dynamic history/version pages derived from Git history
