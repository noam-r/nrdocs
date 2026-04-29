# Administrator guide

This page is for **platform operators**: people who run the nrdocs control plane, manage organizations, and decide **which GitHub repositories may publish** to which projects.

Authors who only run `nrdocs init` should use [Onboarding (bootstrap token)](onboarding-bootstrap/index.html) instead.

Repo owners should not need **`nrdocs admin`**. Their normal path is: receive a bootstrap token, run **`nrdocs init --token '…'`** from their repo, then publish by pushing to GitHub. **`nrdocs admin`** is for the people operating the nrdocs platform.

---

## Prerequisites

- Control Plane deployed and **`API_KEY`** available ([Installation](../installation/index.html)).
- Optional: **`wrangler`** and D1 access if you will run SQL maintenance ([Installation](../installation/index.html), database migrations).

REST details: [API Reference](../api-reference/index.html).

For the short command cheat sheet, see [Admin quick guide](admin-quick-guide/index.html) or run:

```bash
nrdocs admin quick-guide
```

---

## Operator CLI (`nrdocs admin`)

Operators use the same **`nrdocs`** program as authors, with the **`admin`** subcommand. It reads **`NRDOCS_API_KEY`** from **`.env`** for most routes (never commit that file). **`nrdocs admin publish`** uses a **repo publish JWT** (legacy/manual path). CI publishing is now typically **OIDC-based** (no per-repo secret).

From a git clone you can run **`nrdocs`** after **`npm run build:cli`**, **`npm run nrdocs -- admin …`**, or **`./scripts/nrdocs.sh …`** (thin launcher to the same entrypoint).

- **Explicit `admin` subcommand:** run **`nrdocs admin <command>`** (for example **`admin approve`**, **`admin register`**). **True access control** is still the control plane: admin routes reject requests without a valid API key.
- **Working directory:** API-only commands can run from any operator workspace with the right environment. Docs-reading admin commands (**`register`**, **`init`**, **`publish`**) are operator-managed/manual paths; run them from the docs repo root, or with **`NRDOCS_DOCS_DIR`** pointing at that docs directory.
- **CI:** if **`CI`** or **`GITHUB_ACTIONS`** is set, **`nrdocs admin`** **refuses** unless **`NRDOCS_ALLOW_ADMIN_IN_CI=1`** — documentation repositories must not store the platform admin key.

Full command list: **`nrdocs admin --help`**. See also [CLI Reference](../cli/index.html).

---

## How “allowed to publish” works

Publishing is **not** controlled by `allowed-list.yml` in a docs repo. That file is for **reader access** (who may view the site). See [Repository Setup](../repository-setup/index.html).

**Who may call `POST /projects/:id/publish` from CI** is enforced like this:

1. The workflow requests a **GitHub Actions OIDC token**, then exchanges it at **`POST /oidc/publish-credentials`** to obtain a short-lived **repo publish JWT** and the target **project id**.
2. The publish call sends **`Authorization: Bearer <repo publish JWT>`** (short-lived), not the admin API key.
3. The control plane loads the **`repo_publish_tokens`** row for that JWT’s **`jti`**. The row must be **`status = active`**.
4. The row’s **`repo_identity`** must match the **`X-Repo-Identity`** header (canonical form **`github.com/<owner>/<repo>`**, lowercase host, no `https://`).
5. The JWT must be bound to the same **`project_id`** as in the URL, and the project must be **`approved`**.

So “adding an allowed repo” means: **create or reuse a project** and ensure there is an **active repo publish token** whose **`repo_identity`** is exactly that repository. “Removing” means **revoking** that token and/or **disabling** the project.

---

## Add a repository that may publish (recommended path)

**Bootstrap onboarding** is the supported way to tie **one GitHub repo** to **one project** and mint a repo publish token in one step:

1. Issue a bootstrap token for the right organization:
   ```bash
   nrdocs admin init --org default
   ```
2. Give the JWT to the repo owner; they run **`nrdocs init --token '…'`** from a clone of **that** repo (so `origin` matches the intended **`github.com/owner/repo`**).
3. The control plane creates an **approved** project and binds it to the normalized **`repo_identity`**. CI publishing uses OIDC exchange on each run (no repo secret).

Each successful onboard consumes **one** repo slot on that bootstrap token until you [revoke](#revoke-only-the-ci-token-repo-still-exists) or rotate tokens.

---

## Add a project via the admin API (no bootstrap)

You can register a project with **`POST /projects`** using the admin API key. You may include optional **`repo_identity`** so the project record matches the GitHub repo you expect (same canonical format as above). See [API Reference — POST /projects](../api-reference/index.html).

After registration, call **`POST /projects/:id/approve`** so the project can receive publishes.

**Important:** For OIDC-based CI publishing, the Control Plane must support **`POST /oidc/publish-credentials`** and the project must have `repo_identity` set and be `approved`. Bootstrap onboarding sets this up automatically. The admin `POST /projects` flow may set `repo_identity`, but you still need to approve the project.

For **one-off** uploads from an operator machine, you must call **`POST /projects/:id/publish`** with a **valid repo publish JWT** in `Authorization` and the matching **`X-Repo-Identity`** header; the admin API key alone is **not** accepted on the publish endpoint.

---

## Inspect projects and bindings

- **`GET /projects/:id`** returns the project record, including **`repo_identity`** when set ([API Reference](../api-reference/index.html)).

There is no public **`GET /projects`** list endpoint today. To list all projects from the shell, use D1, for example:

```bash
wrangler d1 execute nrdocs --remote --command "SELECT id, slug, status, repo_identity, repo_url FROM projects ORDER BY created_at DESC"
```

(Replace **`nrdocs`** with your database name if different.)

To list active publish tokens:

```bash
wrangler d1 execute nrdocs --remote --command "SELECT id, project_id, repo_identity, status, expires_at FROM repo_publish_tokens ORDER BY created_at DESC"
```

---

## Stop publishing from a repository (keep the project)

### Disable the project (quickest)

Disabling stops readers from seeing the site and blocks normal publish flow for that project:

```bash
curl -sS -X POST "$NRDOCS_API_URL/projects/$PROJECT_ID/disable" \
  -H "Authorization: Bearer $NRDOCS_API_KEY"
```

See also [Publishing — Disable or delete](../publishing/index.html#disable-or-delete-a-project).

### Revoke only the CI token (repo still exists)

If you want the **site** to stay live but **CI from that repo** must stop working, mark the repo publish token **revoked** in D1. JWTs already minted will fail validation once the row is no longer **`active`**.

Example (replace UUIDs with values from your `repo_publish_tokens` query):

```bash
wrangler d1 execute nrdocs --remote --command \
  "UPDATE repo_publish_tokens SET status = 'revoked' WHERE project_id = 'PASTE-PROJECT-UUID-HERE' AND status = 'active'"
```

To revoke a **single** token by id:

```bash
wrangler d1 execute nrdocs --remote --command \
  "UPDATE repo_publish_tokens SET status = 'revoked' WHERE id = 'PASTE-TOKEN-ROW-ID-HERE'"
```

If the repository previously used the legacy secret-based workflow, ask the team to **remove** the old **`NRDOCS_PUBLISH_TOKEN`** secret and **`NRDOCS_PROJECT_ID`** variable after switching to the OIDC workflow.

**Rotating** access for the same repo usually means: revoke old token, then mint a **new** repo publish token bound to the same **`repo_identity`** (today that implies running **`nrdocs init`** again with a fresh bootstrap slot or an internal issuance process you control).

---

## Remove a project entirely

**`DELETE /projects/:id`** (admin API key) removes the project from D1, clears R2 content for that project, and related delivery configuration, as described in [Publishing](../publishing/index.html). Use this when the documentation project should no longer exist at all.

If **`DELETE /projects/:id`** fails with a **foreign key** error, remove or revoke **`repo_publish_tokens`** rows for that **`project_id`** first (see [Revoke only the CI token](#revoke-only-the-ci-token-repo-still-exists)), then retry the delete.

---

## Move publishing to a different GitHub repository

There is **no** `PATCH /projects` to change **`repo_identity`** in the API today. The practical approach is:

1. **Disable** or **delete** the old project (or revoke its token so CI stops).
2. **Onboard** the new repository as a **new** project (new slug if required by org uniqueness), via **`nrdocs init --token`** or your operator process.

Coordinate slug and URLs with readers so bookmarks stay understandable.

---

## Bootstrap token quota and many repos

Each **bootstrap token** has **`max_repos`** and **`repos_issued_count`**. When the quota is exhausted, **`POST /bootstrap/onboard`** returns **403**. Operators can issue another token with **`nrdocs admin init --max-repos <n>`** before more repos onboard through that path.

---

## Related guides

| Topic | Page |
|--------|------|
| Deploy platform | [Installation](../installation/index.html) |
| Author onboarding | [Onboarding (bootstrap token)](onboarding-bootstrap/index.html) |
| Publish payload & workflow | [Publishing](../publishing/index.html) |
| REST endpoints | [API Reference](../api-reference/index.html) |
| Secrets & tuning | [Configuration](../configuration/index.html) |
