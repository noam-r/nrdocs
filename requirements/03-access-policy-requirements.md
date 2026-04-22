# Access Policy Requirements

## Access modes

The platform must support the following conceptual access modes:
- `public`
- `password`
- `invite_list` (future)

Phase 1 requires:
- `public`
- `password`

## Source-of-truth model

- Repository config expresses the project owner's desired state.
- The database stores authoritative effective state.
- Repository-originated changes may affect only the repository's own project.
- Repository-originated changes must never affect other projects.
- This project-scope validation is a critical guardrail.

## Repository capabilities

Repositories may:
- declare project-local allow rules
- update their own requested allow list
- remove prior repository-derived allow entries by publishing a new desired list

Repositories may not:
- declare deny rules
- edit platform-wide policy
- affect any project other than their own bound project

## Repo-to-DB sync semantics

- On each publish, the system replaces the repository-derived desired allow set for that project with the newly declared allow set.
- This replacement applies only to repository-derived desired entries for that project.
- Admin-managed overrides must not be removed by publish.

## Admin/platform policy layers

The database must support policy layers for:
- platform whitelist
- platform blacklist
- project whitelist
- project blacklist

## Effective access precedence

The required precedence order is:

1. platform blacklist
2. platform whitelist
3. project blacklist
4. project whitelist
5. repository-declared allow
6. default deny

Additionally:
- any deny rule wins over any allow rule
- repository rules are allow-only

## Example behavior

### Global allow
If a user is globally whitelisted, they have access to all projects unless blocked by a deny rule.

### Project deny
If a user is denied on a specific project, they must not gain access through repository allow rules or broader allow rules.

### Repo allow
If a repository declares a user in its allow list, that user gains access only if no deny rule blocks them and no higher-priority rule overrides the result.

## Supported allow identity types

Repository-declared allow entries should support:
- exact email addresses
- domain-style wildcard declarations such as `*@example.com`

## Public projects

For projects with `public` access mode:
- no authentication is required
- the project path must remain readable without auth gates

## Password projects

For projects with `password` access mode in phase 1:
- authentication is required
- existing project title/login page may be shown before access

## Cloudflare enforcement model

- Access enforcement is path-scoped per project.
- The intended model is one Cloudflare Access app/policy per project path.
- Cloudflare is the enforcement layer, not the authoritative source of project access truth.
- Platform/database state should be reconciled into Cloudflare when needed.

## Sync timing

Cloudflare sync timing is hybrid:
- admin/database changes should sync promptly
- repository-originated changes should sync on publish
- a reconcile/self-heal process may exist later
