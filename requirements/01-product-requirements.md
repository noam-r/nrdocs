# Product Requirements

## Goals

### Primary goals
- Publish documentation minisites from Markdown content.
- Serve all projects from one hostname, using `docs.example.com/<project-slug>/` for the default org and `docs.example.com/<org-slug>/<project-slug>/` for named orgs.
- Support both public and protected projects.
- Keep project authoring repository-driven.
- Centralize effective access control in a platform-managed database.
- Allow admins to enforce cross-project policy and override repository wishes.
- Keep phase 1 simple and operationally small.

### Non-goals for phase 1
- MkDocs compatibility
- multiple templates
- file attachments/downloadables
- full-text search
- multiple simultaneous access modes on one project
- rollback/version management beyond git history
- full admin UI

## Project model

- One project maps to one repository.
- One repository may control only its own project.
- One project has one immutable slug (unique within its organization).
- A project can be in one of these access modes:
  - `public`
  - `password`
  - `invite_list` (future)

## Routing requirements

- All projects must be served from a single hostname.
- Project identity is determined from the path: either **one** segment (`/<project>/…`, default org) or **two** segments (`/<org>/<project>/…`).
- The project root is:
  - `docs.example.com/<project-slug>/` (default org), or
  - `docs.example.com/<org-slug>/<project-slug>/` (named org)
- Deep links must work under that prefix, e.g. `docs.example.com/<project-slug>/section/page/` or `docs.example.com/acme/docs/section/page/`.
- Unknown projects return `404`.
- Disabled projects return `404`.
- Existing protected projects may show a login page/title before authentication.

## Publishing requirements

- A project must be explicitly registered by the operator (admin API) before it can publish.
- A project must be **approved** before it can publish or serve content.
- Publishing is automatic after a git push triggers GitHub Actions (OIDC-based workflow).
- Publishing must read repository config from the registered repository.
- Publishing must update content and sync any relevant repository-derived desired state.
- A project may publish only if it is approved/enabled.
- A disabled project must block publishing.

## Public/protected behavior

- The platform must support public projects with no authentication.
- The platform must support password-protected projects in phase 1.
- The platform should support a future `invite_list` mode.
- Access mode is singular per project in phase 1.

## UX requirements for phase 1

### Public projects
- Public project paths are directly readable.

### Password-protected projects
- Existing project title/login page may be shown before access is granted.
- Access session duration is configurable at platform level.
- Default session duration is 8 hours.
- Session configuration is not project-specific in phase 1.

## Project metadata

Repository config must be able to declare at least:
- slug
- title
- description
- publish enabled
- access mode
- requested access list
- nav settings

## Content requirements

The custom content format must support:
- Markdown pages
- explicit nav config
- page metadata:
  - title
  - order
  - section
  - hidden
  - template
  - tags

Only `title` and `order` are mandatory in phase 1.

## Template requirements

- Phase 1 uses a single standard template.
- The architecture should remain template-capable for the future.
