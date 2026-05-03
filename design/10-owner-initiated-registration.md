# Owner-initiated registration (design)

**Status:** Implemented — **`POST /oidc/register-project`** on the Control Plane; see [FLOW.md](../FLOW.md) for the user-facing narrative.

This document pins decisions requested before implementation:

1. **`POST /oidc/register-project` (working name)** — body, idempotency, conflict rules.  
2. **How `project_id` reaches the human repo** after the first CI run (optional in the happy path).

## Happy path: no `--project-id` at init

**Default:** **`nrdocs init`** scaffolds the repo using only the **control plane URL** and repo-local config (slug, title, access mode). **No UUID** is required up front.

**Mental model:** almost every docs repo has **one** corresponding control-plane project. The internal **`project_id`** exists for the database and admin tools; **owners normally never paste it**. Binding is **`repo_identity`** from GitHub (OIDC registration + operator approval), not typing a project id into the CLI.

**Optional:** after registration, owners may **link** the checkout (e.g. **`nrdocs init --project-id`** or **`nrdocs link`**) so **`.nrdocs/status.json`** is populated for **`nrdocs status`**—quality of life, not required for CI.

---

## 1. OIDC registration endpoint

### Purpose

Allow a **GitHub Actions** workflow to create or refresh a **pending** (`awaiting_approval`) project **without** the platform API key, by presenting a valid **GitHub OIDC ID token**. Repository ownership is proven by the OIDC **`repository`** claim (same basis as [src/control-plane/index.ts](../src/control-plane/index.ts) `handleOidcPublishCredentials`).

### Route and auth

- **Method / path:** `POST /oidc/register-project` (exact path TBD; must be distinct from `/oidc/publish-credentials`).
- **Auth:** `Authorization: Bearer <github_oidc_token>` (Actions ID token with **audience** = control plane origin, identical to publish-credentials).
- **No** `X-API-Key` / admin bearer for this route.

### Repo identity (authoritative)

- **`repo_identity`** is **`github.com/${claims.repository}`** from the verified token.
- The client **must not** send a free-form `repo_identity` that overrides the token. Optional: accept `repo_identity` in the body only as a **check** that it equals the derived value; mismatch → **400**.

### Request body (JSON)

Minimum fields to seed the repo row (must match what [`POST /repos`](../src/control-plane/index.ts) accepts today where applicable):

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `slug` | string | yes | Lowercase slug; unique per org. |
| `title` | string | yes | |
| `description` | string | no | Default `""`. |
| `access_mode` | `"public"` \| `"password"` | yes | |
| `repo_url` | string | no | HTTPS URL for display/links; may default from `https://github.com/${owner}/${repo}`. |

The workflow should populate these from checked-in **`docs/project.yml`** (and validate consistency) so the registered project matches what the owner committed.

### Successful responses

- **201 Created** — New project row in `awaiting_approval`; body includes at least `id` (project UUID), `status`, `slug`, `repo_identity`.
- **200 OK** — Idempotent case (see below); same shape as GET project for the created row (non-secret fields only).

### Error responses

| Condition | HTTP | Notes |
|-----------|------|--------|
| Invalid / expired OIDC | 401 | Same style as publish-credentials. |
| Malformed JSON / missing required field | 400 | |
| `slug` invalid format | 400 | Align with existing slug validation. |
| **`repo_identity` already bound** to a project with **different** slug (or immutable mismatch) | 409 | Same repo cannot claim two slugs; operator must fix or delete. |
| **`slug` already used** in the org by **another** `repo_identity` | 409 | Slug squatting across repos. |
| Project exists for this `repo_identity` in **`approved`** | 200 | Idempotent “already registered”; optional `message` for CI. |
| Project exists for this `repo_identity` in **`disabled`** | 409 | Re-enable path is operator policy (out of scope here). |

### Idempotency rules

1. **Same OIDC repo, no existing row:** insert `awaiting_approval`, return **201**.
2. **Same OIDC repo, existing row `awaiting_approval`, same slug + compatible metadata:** return **200** with same `id` (optional: update `title`/`description`/`repo_url` if product allows mutable fields while pending).
3. **Same OIDC repo, existing row `awaiting_approval`, conflicting slug vs stored row:** **409** (owner changed `project.yml` slug without operator cleanup—document remediation).
4. **Same OIDC repo, row already `approved`:** return **200** with project id and `status: approved` (registration step is a no-op; publish flow handles builds).

### Relationship to existing routes

- **`POST /repos`** (API key) remains for **operator-first** registration and automation.
- **`POST /oidc/publish-credentials`** remains unchanged: still requires an **approved** project for that `repo_identity`.
- After approval, **mint-publish-token** / `repo_identity` backfill behavior stays as implemented today for operator tooling.

### Abuse / trust notes

OIDC proves control of **a** repository, not organizational trust. Policy for **slug collisions** and **operator override** remains a product decision; this endpoint should not weaken **admin-only** delete/disable.

---

## 2. CLI and CI: how `project_id` reaches the repo

**Happy path:** it **does not** need to reach the repo at all for publishing. CI resolves the project by **`repo_identity`** after OIDC registration and approval. Treat **no project id in the working tree** as normal.

### Options considered (when the id is useful)

| Option | Pros | Cons |
|--------|------|------|
| **A. Workflow-only** | No second local step; CI has `project_id` from API response | `.nrdocs/status.json` absent until owner runs a follow-up command |
| **B. Second local `nrdocs init --project-id`** | Matches today’s metadata file; good for `nrdocs status` | Owner must copy UUID once |
| **C. Bot opens PR updating `.nrdocs/status.json`** | Repo always has id in Git | Needs `contents: write`, token hygiene, more code |

### Decision (MVP)

1. **Registration job** in GitHub Actions calls `POST /oidc/register-project`, parses JSON, and writes **`project_id`** to **`$GITHUB_STEP_SUMMARY`** (and optionally `echo "project_id=…" >> "$GITHUB_OUTPUT"` for downstream jobs). Owners who want the UUID for support or local tooling can copy it from **Actions**; **most flows skip this**.

2. **Optional follow-up:** run **`nrdocs init --project-id <uuid>`** (or a future thin **`nrdocs link`**) to populate **`.nrdocs/status.json`**—**only** if local commands should know the id without querying the server.

3. **Publish job** does not require `status.json` on disk; it only needs OIDC + approved project. So CI stays functional even if the developer never runs step 2.

4. **Legacy:** operator-handoff **`nrdocs init --project-id`** remains valid when registration happened out of band.

5. **Future:** unauthenticated **repo-scoped lookup** (e.g. repo-proof or OIDC-only `GET`) could eliminate the copy-paste step for those who want `.nrdocs/status.json` without reading Actions logs; defer until demand is clear.

---

## 3. Reject semantics (recommended default)

For a **pending** application, **reject** = **`DELETE /repos/:id`** (or `nrdocs admin delete`), removing the row so the repo can re-register after fixing `project.yml`. Persistent “rejected” state is optional if audit requirements demand it; if added, use a dedicated status and exclude from slug reuse rules explicitly.

---

## 4. References

- [FLOW.md](../FLOW.md) — Owner vs operator steps and UX expectations.
- [11-repo-centric-model.md](11-repo-centric-model.md) — Dropping “project” from the mental model; repos as the primary unit.
- [02-project-model.md](02-project-model.md) — Lifecycle and immutability.
- [06-publish-flow.md](06-publish-flow.md) — Registration vs publish responsibilities.
