# NRDocs Prerequisite Spec: Add Organization Support

## Status

Draft, Phase 0 prerequisite for token-based onboarding.

## Purpose

This spec defines the minimum **organization ("org") model** that NRDocs must add before implementing token-based onboarding and repo-scoped publish tokens.

The current system models **projects** but does not model **organizations**. The proposed bootstrap-token flow assumes a higher-level ownership and policy boundary above projects. Introducing org support first reduces the impact and ambiguity of the later token/auth redesign.

---

## Goals

Add a minimal organization model that:

- groups projects under a stable tenant boundary
- provides a scope for admin-issued bootstrap tokens
- provides a scope for repo publish tokens
- provides a place for future org-level policy
- minimizes Phase 0 complexity by avoiding premature multi-user RBAC design

---

## Non-Goals

This phase does **not** include:

- full user / member / role management
- self-serve org creation
- org-level UI polish
- project migration across orgs
- cross-control-plane org federation
- backward compatibility guarantees for alpha deployments

---

## Design Principles

1. **Org is the top-level ownership boundary.**
2. **Every project belongs to exactly one org.**
3. **Org support must be minimal, not a full permissions system.**
4. **The data model should leave room for later policy and membership expansion.**
5. **Breaking changes are acceptable in alpha.**

---

## Concepts

### Organization

An organization is the top-level tenant boundary for a single NRDocs control plane installation.

An org owns:

- projects
- bootstrap tokens
- repo publish tokens
- future org-level policy/settings

### Project

A project remains the publishable docs unit, but is now owned by exactly one org.

### Control Plane

A control plane manages one or more orgs. Tokens are valid only for the issuing control plane.

---

## Proposed Data Model

## organizations

New table.

Suggested fields:

- `id` (string / uuid / internal id)
- `slug` (unique within control plane)
- `name`
- `status` (`active`, `disabled`)
- `created_at`
- `updated_at`

Optional future fields, not required now:

- `settings_json`
- `default_access_mode`
- `metadata_json`

### Notes

- `slug` should be human-readable and unique within the control plane.
- The control plane may start with exactly one default org; the schema should still support multiple orgs.

---

## projects

Existing table must be updated.

### New required field

- `org_id` → foreign key to `organizations.id`

### Constraints

- every project must have a non-null `org_id`
- slug uniqueness must be clarified:
  - **recommended:** keep `project.slug` globally unique within the control plane for now
  - do **not** weaken uniqueness to per-org unless there is a concrete need

### Why keep global slug uniqueness now?

Because it simplifies:

- routing
- site URLs
- project lookup
- later migration of existing data

Per-org slug uniqueness can be revisited later if required.

---

## bootstrap_tokens

New table.

Represents admin-issued org bootstrap tokens used for onboarding and minting repo publish tokens.

Suggested fields:

- `id`
- `jti` (unique token identifier)
- `org_id` (fk)
- `status` (`active`, `revoked`, `expired`)
- `created_by`
- `created_at`
- `expires_at`
- `max_repos`
- `repos_issued_count`
- `last_used_at`

Notes:

- `max_repos` is authoritative in the DB, not in the token payload.
- `repos_issued_count` is authoritative in the DB.
- The token itself carries only signed public metadata and a `jti`.

---

## repo_publish_tokens

New table.

Represents repo-scoped tokens used by CI publishing.

Suggested fields:

- `id`
- `jti`
- `org_id` (fk)
- `project_id` (fk)
- `repo_identity`
- `status` (`active`, `revoked`, `expired`)
- `created_from_bootstrap_jti`
- `created_at`
- `expires_at`
- `last_used_at`

Constraints:

- one repo publish token must be bound to exactly one org
- one repo publish token must be bound to exactly one project
- one repo publish token must be bound to exactly one repo identity

---

## repo bindings

This may live directly on `projects` or as a separate table.

### Recommended Phase 0 choice

Add repo binding directly to `projects` unless there is a concrete need for many-to-one repo/project relations.

Suggested field on `projects`:

- `repo_identity` (nullable initially, then required for token onboarding-created projects)

Canonical repo identity format:

```text
github.com/<owner>/<repo>
```

Example:

```text
github.com/noam-r/nrdocs
```

If later NRDocs needs multiple providers or more complex mappings, this can evolve into a separate table.

---

## Minimum API Changes

The API must become org-aware internally, even if org identifiers are not yet heavily exposed in all endpoints.

### Required changes

- project create operations must assign an `org_id`
- project fetch/mutation paths must resolve project ownership via `org_id`
- token issuance endpoints must bind tokens to an `org_id`
- token validation paths must validate `org_id` from DB state
- future bootstrap endpoints will operate primarily in org context

### Not required yet

- org CRUD for end users
- org member management
- org-scoped user auth flows

---

## Migration Plan

Because alpha breaking changes are acceptable, the migration can be direct and simple.

## Step 1: add organizations table

Create `organizations`.

## Step 2: create a default org

Create one default org for the installation.

Suggested provisional values:

- slug: `default`
- name: `Default Organization`

This is a migration convenience, not a product decision.

## Step 3: backfill all existing projects

Set every existing project's `org_id` to the default org.

## Step 4: enforce non-null org_id

After backfill, make `projects.org_id` non-null.

## Step 5: add token tables

Create:

- `bootstrap_tokens`
- `repo_publish_tokens`

These tables may remain unused until the token-bootstrap feature is implemented.

---

## Constraints and Validation

### Organization constraints

- `organizations.slug` must be unique
- `organizations.status` must be valid enum
- disabled orgs must not mint new bootstrap or repo tokens

### Project constraints

- `projects.org_id` must exist
- `projects.slug` should remain globally unique for now
- if `repo_identity` is set, it should be normalized before storage

### Token constraints

- `bootstrap_tokens.jti` must be unique
- `repo_publish_tokens.jti` must be unique
- a revoked token must fail validation regardless of token metadata
- expired tokens must fail validation even if DB row still exists

---

## Security Boundaries

This phase introduces the org as a security boundary, but does not yet introduce user-level authorization complexity.

### Phase 0 security model

- control plane trusts server DB state
- every project belongs to exactly one org
- bootstrap tokens are scoped to one org
- repo publish tokens are scoped to one org and one project
- future token signing and validation will build on this model

---

## Open Decisions

These do not block Phase 0, but should be recorded.

### 1. Single-org vs multi-org control plane UX

The schema should support multiple orgs, even if the initial UX only exposes one default org.

### 2. Project slug uniqueness

Recommended Phase 0 answer: keep globally unique project slugs.

### 3. Repo identity storage

Recommended Phase 0 answer: store canonical repo identity on `projects`.

### 4. User/member model

Out of scope for now.

---

## Acceptance Criteria

This prerequisite is complete when:

- `organizations` table exists
- `projects.org_id` exists and is non-null
- all existing projects are backfilled to a default org
- `bootstrap_tokens` table exists
- `repo_publish_tokens` table exists
- project creation paths can assign an `org_id`
- project reads/mutations are org-aware internally

---

## Follow-up Specs

After this prerequisite lands, the next spec should define:

1. token signing and token formats
2. bootstrap onboarding flow
3. repo publish token auth flow
4. CLI packaging and installation

---

# Appendix: Phase 1 Decisions Already Chosen

These are adjacent decisions already agreed for the next phase:

- token signing will use **HMAC with a dedicated token-signing key**
- control-plane URL migration is **out of scope**
- backward compatibility with the old API-key flow is **not required**
- `nrdocs doctor` is postponed to **Phase 2**
- CLI packaging/distribution still needs its own dedicated spec
