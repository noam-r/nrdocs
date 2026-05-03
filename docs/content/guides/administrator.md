# Administrator guide

This page is for **platform operators**: people who run the nrdocs control plane and decide **which GitHub repositories may publish** to which registered sites.

Authors who only run `nrdocs init` should use [Onboarding a repository](onboarding-bootstrap/index.html) instead.

Repo owners should not need **`nrdocs admin`**. Their normal path is: receive the Control Plane URL + **repo id** from an operator, set the URL once with **`nrdocs config set api-url`** (or pass **`--api-url`** per run), run **`nrdocs init --repo-id …`**, then publish by pushing to GitHub. **`nrdocs admin`** is for the people operating the nrdocs platform.

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

Operators use the same **`nrdocs`** program as authors, with the **`admin`** subcommand. It reads **`NRDOCS_API_KEY`** from **`.env`** for most routes (never commit that file). **`NRDOCS_API_URL`** may also live in that `.env` file, or operators can rely on **`nrdocs config set api-url`** (`~/.nrdocs/config.json`) the same way authors do. **`nrdocs admin publish`** uses a **repo publish JWT** (legacy/manual path). CI publishing is typically **OIDC-based** (no per-repo secret).

From a git clone you can run **`nrdocs`** after **`npm run build:cli`**, **`npm run nrdocs -- admin …`**, or **`./scripts/nrdocs.sh …`** (thin launcher to the same entrypoint).

- **Explicit `admin` subcommand:** run **`nrdocs admin <command>`** (for example **`admin approve`**, **`admin register`**). **True access control** is still the control plane: admin routes reject requests without a valid API key.
- **Working directory:** API-only commands can run from any operator workspace with the right environment. Docs-reading admin commands (**`register`**, **`publish`**) are operator-managed/manual paths; run them from the docs repo root, or with **`NRDOCS_DOCS_DIR`** pointing at that docs directory.
- **CI:** if **`CI`** or **`GITHUB_ACTIONS`** is set, **`nrdocs admin`** **refuses** unless **`NRDOCS_ALLOW_ADMIN_IN_CI=1`** — documentation repositories must not store the platform admin key.

Full command list: **`nrdocs admin --help`**. See also [CLI Reference](../cli/index.html).

---

## How “allowed to publish” works

Publishing is **not** controlled by `allowed-list.yml` in a docs repo. That file is for **reader access** (who may view the site). See [Repository Setup](../repository-setup/index.html).

**Who may call `POST /repos/:id/publish` from CI** is enforced like this:

1. The workflow requests a **GitHub Actions OIDC token**, then exchanges it at **`POST /oidc/publish-credentials`** to obtain a short-lived **repo publish JWT** and the target **`repo_id`**.
2. The publish call sends **`Authorization: Bearer <repo publish JWT>`** (short-lived), not the admin API key.
3. The control plane loads the **`repo_publish_tokens`** row for that JWT’s **`jti`**. The row must be **`status = active`**.
4. The row’s **`repo_identity`** must match the **`X-Repo-Identity`** header (canonical form **`github.com/<owner>/<repo>`**, lowercase host, no `https://`).
5. The JWT must be bound to the same **`repo_id`** as in the URL, and the site must be **`approved`**.

So “adding an allowed repo” means: **create or reuse a registration** and ensure there is an **active repo publish token** whose **`repo_identity`** is exactly that repository. “Removing” means **revoking** that token and/or **disabling** the site.

---

## Add a repository that may publish (recommended path)

Operator-only flow ties **one GitHub repo** to **one registered site** by calling **`POST /repos`** (or **`nrdocs admin register`**) with a `repo_identity`, approving it, then letting CI publish via OIDC exchange.

1. From a checkout of the docs repo (or with `NRDOCS_DOCS_DIR` pointing at its docs directory), register the site:

```bash
nrdocs admin register --repo-identity github.com/owner/repo
```

2. Approve it (minting a publish token for manual operator publishing if needed):

```bash
nrdocs admin approve <repo-id> --repo-identity github.com/owner/repo
```

3. Give the repo owner the Control Plane URL and the repo id (not secrets). They run:

```bash
nrdocs init --api-url '<control-plane-url>' --repo-id '<repo-id>'
git push
```

---

## Add a site via the admin API

You can register with **`POST /repos`** using the admin API key. You may include optional **`repo_identity`** so the row matches the GitHub repo you expect (same canonical format as above). See [API Reference — POST /repos](../api-reference/index.html).

After registration, call **`POST /repos/:id/approve`** so the site can receive publishes.

**Important:** For OIDC-based CI publishing, the Control Plane must support **`POST /oidc/publish-credentials`**, the row must be **`approved`**, and **`repo_identity`** must match `github.com/<owner>/<repo>`. Set `repo_identity` when creating the site (`POST /repos` or **`nrdocs admin register`**). If a legacy row is missing it, **`nrdocs admin mint-publish-token <repo-id> --repo-identity …`** can backfill on mint. You still need to approve new registrations before CI can publish.

For **one-off** uploads from an operator machine, you must call **`POST /repos/:id/publish`** with a **valid repo publish JWT** in `Authorization` and the matching **`X-Repo-Identity`** header; the admin API key alone is **not** accepted on the publish endpoint.

---

## Inspect repos and bindings

- **`GET /repos/:id`** returns the repo record, including **`repo_identity`** when set ([API Reference](../api-reference/index.html)).
- **`GET /repos`** lists repos (operator auth required). The operator CLI wraps this as **`nrdocs admin list`**.

To list repos from the shell:

```bash
nrdocs admin list --all
```

If you need direct DB inspection, you can also use D1 (table name may still be `repos` in your migration):

```bash
wrangler d1 execute nrdocs --remote --command "SELECT id, slug, status, repo_identity, repo_url FROM repos ORDER BY created_at DESC"
```

(Replace **`nrdocs`** with your database name if different.)

To list active publish tokens:

```bash
wrangler d1 execute nrdocs --remote --command "SELECT id, repo_id, repo_identity, status, expires_at FROM repo_publish_tokens ORDER BY created_at DESC"
```

---

## Stop publishing from a repository (keep the registration)

### Disable the site (quickest)

Disabling stops readers from seeing the site and blocks normal publish flow:

```bash
curl -sS -X POST "$NRDOCS_API_URL/repos/$REPO_ID/disable" \
  -H "Authorization: Bearer $NRDOCS_API_KEY"
```

See also [Publishing — Disable or delete](../publishing/index.html#disable-or-delete-a-registration).

### Revoke only the CI token (repo still exists)

If you want the **site** to stay live but **CI from that repo** must stop working, mark the repo publish token **revoked** in D1. JWTs already minted will fail validation once the row is no longer **`active`**.

Example (replace UUIDs with values from your `repo_publish_tokens` query):

```bash
wrangler d1 execute nrdocs --remote --command \
  "UPDATE repo_publish_tokens SET status = 'revoked' WHERE repo_id = 'PASTE-REPO-UUID-HERE' AND status = 'active'"
```

To revoke a **single** token by id:

```bash
wrangler d1 execute nrdocs --remote --command \
  "UPDATE repo_publish_tokens SET status = 'revoked' WHERE id = 'PASTE-TOKEN-ROW-ID-HERE'"
```

If the repository previously used the legacy secret-based workflow, ask the team to **remove** the old **`NRDOCS_PUBLISH_TOKEN`** secret and any **`NRDOCS_REPO_ID`** GitHub variable after switching to the OIDC workflow (OIDC does not need that variable).

**Rotating** long-lived **operator** publish tokens: revoke the old **`repo_publish_tokens`** row, then run **`nrdocs admin mint-publish-token <repo-id> --repo-identity github.com/<owner>/<repo>`** to mint a replacement for **`nrdocs admin publish`**. OIDC CI does **not** use that long-lived token; each GitHub Actions run exchanges OIDC for a short-lived JWT automatically.

---

## Remove a site entirely

**`DELETE /repos/:id`** (admin API key) removes the registration from D1, clears R2 content for that site, and related delivery configuration, as described in [Publishing](../publishing/index.html). Use this when the documentation site should no longer exist at all.

If **`DELETE /repos/:id`** fails with a **foreign key** error, remove or revoke **`repo_publish_tokens`** rows for that **`repo_id`** first (see [Revoke only the CI token](#revoke-only-the-ci-token-repo-still-exists)), then retry the delete.

---

## Move publishing to a different GitHub repository

There is **no** `PATCH /repos` to change **`repo_identity`** as a standalone admin API today. Practical options:

1. **Disable** or **delete** the old registration (or revoke its tokens so CI stops), then **register** the new repository as a **new** site and have the repo owner run **`nrdocs init --repo-id`** with the new id.
2. If the slug can stay the same but **`repo_identity` was never set**, **`nrdocs admin mint-publish-token <repo-id> --repo-identity github.com/<owner>/<repo>`** may be enough to bind the row (see [Publishing](../publishing/index.html)).

Coordinate slug and URLs with readers so bookmarks stay understandable.

---

## Related guides

| Topic | Page |
|--------|------|
| Deploy platform | [Installation](../installation/index.html) |
| Author onboarding | [Onboarding a repository](onboarding-bootstrap/index.html) |
| Publish payload & workflow | [Publishing](../publishing/index.html) |
| REST endpoints | [API Reference](../api-reference/index.html) |
| Secrets & tuning | [Configuration](../configuration/index.html) |
