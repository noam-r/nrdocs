# Private Docs Publishing Platform — Requirements Overview

## Purpose

Create a platform for publishing private documentation minisites from Markdown content under a single hostname:

- `docs.example.com/<project-slug>/`

The platform is designed for:

- one repository per project
- automatic publishing after explicit project registration
- static-site delivery
- public or protected projects
- a Cloudflare-first architecture
- a publish-focused control plane for phase 1

## Core decisions already made

- The platform does **not** aim to support existing MkDocs projects.
- The platform defines its own simpler Markdown-based content format.
- Each project is bound to exactly one repository.
- Slugs are immutable after project creation.
- The control plane is publish-focused in phase 1.
- Project registration is explicit through an admin API call.
- Repository config expresses project-owner desired state.
- The database stores effective state and has higher authority than repository config.
- Repositories may declare only project-local **allow** access rules.
- Deny rules are platform-controlled and always win.
- The platform supports `public`, `password`, and future `invite_list` access modes.
- Phase 1 requires `public` and `password`.
- Projects are served under one hostname: `docs.example.com`.
- A disabled or unknown project returns `404`.
- Public projects must be supported without authentication.

## Document structure

This requirements package is split into several files:

- `00-overview.md` — overview and scope
- `01-product-requirements.md` — product and functional requirements
- `02-architecture-requirements.md` — system architecture requirements
- `03-access-policy-requirements.md` — access model and policy precedence
- `04-content-format-requirements.md` — custom content format requirements
- `05-api-and-lifecycle-requirements.md` — control plane and project lifecycle
- `06-open-implementation-notes.md` — non-blocking implementation notes

## Phase summary

### Phase 1
- explicit admin registration
- automatic publish flow
- custom Markdown rendering
- single standard template
- explicit nav config file
- access modes: `public`, `password`
- repository-derived allow list support
- platform and project deny/allow overrides in DB
- Cloudflare-first deployment stack

### Future phases
- `invite_list` access mode
- richer administration UI
- optional git-history-based content version experience
- richer templates
- search
- attachments/downloadables
