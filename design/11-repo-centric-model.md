# Repo-centric model (direction)

**Status:** Product / architecture direction — not implemented. The live system still uses a **`projects`** table, UUID **`project_id`**, and “project” language in APIs and CLI.

This note clarifies what **“remove projects from the hierarchy”** can mean without pretending state can disappear: the platform must still persist **per-repo** approval, access mode, and artifacts. The win is **fewer concepts and addresses** in operator and author flows.

---

## What “project” is today

In code, a **project** row is already the **unit of publish and URL routing**: one **immutable `repo_identity`** (e.g. `github.com/org/repo`), one **slug** (path under the org), lifecycle **status**, **access mode**, and publish metadata.

For OIDC, the control plane already resolves **`github.com/${repository}` → row**. The extra **UUID** exists mainly for stable foreign keys (`repo_publish_tokens`, events) and REST paths (`/repos/:id/...`).

So the hierarchy is not really “org → abstract project → repo” in practice; it is **org → (row that *is* the repo binding + site settings)**. The complexity users feel is often **naming** (“project” vs “this repo”) and **carrying a UUID** that duplicates what Git already identifies.

---

## Target mental model: nrdocs publishes **repos**

**User-facing language:** only **repositories** (and **sites** / **docs URLs**). Avoid “project” in CLI help, operator guides, and status output where **“repo”** or **`repo_identity`** is clearer.

**Operator work:** approve or disable a **repo registration**, not an abstract project id. Listing and admin actions default to **`github.com/owner/repo`** as the primary column; any internal id is for support and APIs only.

**Author work:** **`nrdocs init`** never asks for a UUID. Binding is **the GitHub repo** (remote + OIDC), same as the [happy path in FLOW.md](../FLOW.md).

---

## What can be removed or simplified

| Area | Today | Repo-centric direction |
|------|--------|---------------------------|
| **Identity in UX** | `project_id` (UUID) in init, env, some URLs | **`repo_identity`** (or slug on your hostname) as the human-stable handle; UUID internal or dropped from UX entirely |
| **HTTP API** | **`/repos/:id/...`** (current) | Optional future: **`/repos/by-url`** patterns for convenience |
| **Database** | Table name `projects` | Optional rename to **`repos`** if it helps clarity; schema still one row per published repo |
| **Organization** | Every row has `org_id` | For **single-tenant** or “one docs host” installs, hide org in UI; for multi-tenant SaaS, keep **org** as billing/namespace boundary but avoid saying “project” under it |

---

## Flat model: no organizations (direction)

**Idea:** the only thing users and operators see is a **flat list of registered repos** (plus site URL / slug). No **org** object, no **`/org/slug/`** mental model in the product.

### What organizations do today (why they exist)

In this codebase, an **organization** row:

- **Namespaces slugs** — Project slug is unique **per org**, not globally (`docs.example.com/<org>/<project-slug>` for named orgs vs default org).
- **Scopes multi-tenant data** — Bootstrap tokens, quotas, and FKs (`org_id` on projects and tokens) separate one customer’s data from another’s on **shared** infrastructure.
- **Supports multiple “sites” on one control plane** without slug collisions between unrelated teams.

So **“remove orgs”** is not a rename; it changes **uniqueness rules** and **isolation**.

### When a flat repo hierarchy is a good fit

- **One deployment per company / open-source project** (private Workers + D1 per operator): there is effectively **one tenant**. You can treat the whole installation as a **single implicit scope** — all site slugs **globally unique on that hostname**, routing is **`https://docs.company.com/<slug>/...`** only.
- **Operators and authors** never hear “organization”; they only register **repos** and pick **slugs** that must not collide on that host.

This matches “nrdocs as internal docs for our GitHub org” or “we run our own instance.”

### When you still need *something* like an org

If **one** nrdocs **SaaS** serves **many unrelated customers** on shared D1:

- You still need a **tenant boundary** (billing, data isolation, slug collision avoidance). Options:
  - **Subdomain per tenant** — `acme.docs.service.com` vs `contoso.docs.service.com`; each subdomain is a flat repo list (orgs gone from UX; **tenant = hostname**).
  - **Hidden tenant id** — Keep `org_id` (or rename to `tenant_id`) in the DB **only**; never expose it in CLI/docs.
  - **Prefix slugs** — `acme-handbook`, `contoso-handbook` on one host; fragile for authors.

So **flat repo UX** and **multi-tenant backend** can coexist: **flat for humans**, **scoped row** in the database.

### Product implications of truly flat (single-tenant) semantics

| Topic | Change |
|--------|--------|
| **Slug uniqueness** | **Global** within the deployment (or within one hostname), not “per org.” |
| **URLs** | Single pattern: **`/<site-slug>/...`** on the delivery host; no `/<org-slug>/...` in user-facing docs. |
| **Bootstrap / quotas** | Either drop org-scoped quotas or attach quotas to the **whole installation** (or to the hidden tenant row). |
| **Default org** | Today’s “default organization” becomes an **implementation detail** or disappears in favor of a single tenant row. |

### Persistence (unchanged)

- One **database row per registered repo** (whatever the table is called).
- With **global** slugs on one host, name clashes between teams are possible — operators need remediation (change slug in `project.yml`, etc.).

---

## What does **not** go away

- **Lifecycle:** Something must represent *awaiting approval → approved → disabled* per repo.
- **Slug vs repo:** The **URL path** (`/my-slug/...`) may still differ from the GitHub repo name; that can stay in **`project.yml`** as **site slug**, stored on the same row as the repo binding.
- **Secrets and tokens:** Repo-publish JWTs and OIDC exchange still attach to **one registered repo record**; only naming and FK shapes change.
- **Multi-tenant SaaS:** If many customers share one control plane, some **tenant boundary** usually remains in storage (even if users never see “org”) — see [Flat model: no organizations](#flat-model-no-organizations-direction) above.

---

## Implementation spectrum (incremental)

1. **Docs + CLI copy** — Say “repo” everywhere; treat UUID as implementation detail. Low risk.
2. **API evolution** — Optional routes keyed by `repo_identity` for operator ergonomics; core **`/repos/:id`** remains canonical.
3. **Schema** — Optional: natural key `repo_identity` as PRIMARY KEY (with care for renames/transfers); or keep surrogate UUID internally forever and only **never expose it** in happy paths.

---

## Risks to design for

- **GitHub repo renames / transfers** — `repo_identity` string changes; today that effectively forces a **new** registration (same as “new project” in [02-project-model.md](02-project-model.md)). Repo-centric naming should still document **migration / operator retarget** flows.
- **Slug collisions** — Unrelated repos cannot share the same site slug; with orgs, uniqueness is per org; in a **flat single-tenant** model, slugs are **global on the host** — collisions are rarer per team but still require operator policy when they happen.
- **Forks** — OIDC identity is the fork’s repo, not upstream; unchanged.

---

## References

- [02-project-model.md](02-project-model.md) — Current lifecycle (wording will evolve if this direction is adopted).
- [FLOW.md](../FLOW.md) — Owner-initiated, no UUID happy path.
- [10-owner-initiated-registration.md](10-owner-initiated-registration.md) — OIDC registration keyed by repo.
