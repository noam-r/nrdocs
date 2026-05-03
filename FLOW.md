# How nrdocs works: operator and repository owner

This document is the **end-to-end product flow** for a single nrdocs deployment. It is **single-tenant**: one Control Plane, one Delivery Worker, and a **flat list of registered documentation sites** in D1. There are **no organizations** in the product surface.

**Default path:** the **repository owner** sets the Control Plane URL once, runs **`nrdocs init`** to scaffold the workflow and docs, and **pushes**. The CI run calls **`POST /oidc/register-project`** (GitHub OIDC, no API key), which creates an **`awaiting_approval`** row, then tries **`POST /oidc/publish-credentials`** once. If the repo is not approved yet, the job **exits successfully without polling** (no long Actions wait or extra billing). The **operator** approves asynchronously; after that, the owner **pushes again** or **re-runs the workflow** so a short second run can mint credentials and **publish** to Cloudflare.

An **operator-first** path (**`POST /repos`** with the admin API key) still exists for automation; owners may optionally pass **`--repo-id`** to **`nrdocs init`** to link **`.nrdocs/status.json`** when a UUID was created out of band.

**Reader URLs** look like:

```text
https://<delivery-host>/<site-slug>/…
```

The **site slug** comes from `docs/project.yml` and must match what was registered on the control plane.

---

## Roles

| Who | Needs | Must not need |
|-----|--------|----------------|
| **Platform operator** | `NRDOCS_API_URL`, `NRDOCS_API_KEY`, the `nrdocs` CLI (or `curl` to the API) | — |
| **Repository owner** | Control Plane base URL, the `nrdocs` CLI, a normal GitHub push | `NRDOCS_API_KEY`, Wrangler, Cloudflare dashboard access for publishing |

---

## Operator flow: list, approve (and optional operator-first registration)

The operator **approves** pending sites created by **owner pushes** (OIDC registration), or can **register** a row first via **`POST /repos`** / **`nrdocs admin register`**. OIDC publishing requires **`repo_identity`** `github.com/<owner>/<repo>` (set automatically for owner-initiated registration, or passed at operator register/approve).

### 1. Configure the CLI once

From a machine where secrets are allowed (never commit them):

```bash
# In .env or the shell:
export NRDOCS_API_URL='https://<your-control-plane>.workers.dev'
export NRDOCS_API_KEY='<your-admin-api-key>'
```

Optional: **`nrdocs config set api-url 'https://…'`** so you do not repeat the URL.

### 2. (Optional) Register the site operator-first

If you are **not** using owner-initiated OIDC registration, run from the **documentation repo** (or set **`NRDOCS_DOCS_DIR`**) so the CLI can read **`docs/project.yml`**:

```bash
nrdocs admin register
```

This calls **`POST /repos`** with **slug**, **title**, **access_mode**, **repo_url**, and **`repo_identity`**. On success, the API returns **`id`** (internal repo id for admin commands).

You can also register with **`curl`** against **`POST /repos`** (see [API Reference](docs/content/api-reference.md)).

Otherwise, skip this: owners register on **first CI run** via **`POST /oidc/register-project`**.

### 3. Approve (and bind identity if needed)

```bash
nrdocs admin approve <repo-id> --repo-identity github.com/<owner>/<repo>
```

This calls **`POST /repos/:id/approve`**. By default the CLI also **mints** a repo-publish JWT for operator use; OIDC CI does not rely on storing that token in GitHub.

If **`repo_identity`** was missing on an older row, you can backfill when minting:

```bash
nrdocs admin mint-publish-token <repo-id> --repo-identity github.com/<owner>/<repo>
```

### 4. Password-protected sites (optional)

If **`access_mode`** is **`password`**, set the shared reader password before or after the owner’s first publish:

```bash
nrdocs admin set-password <repo-id>
```

Repo owners can later rotate the password with **`nrdocs password set`** (repo-proof flow) where that is enabled.

### 5. Hand off to the repository owner

Send **only** the **Control Plane URL** (same as **`NRDOCS_API_URL`**). You do **not** need to send a **repo id** for the default flow.

Do **not** send **`NRDOCS_API_KEY`**.

---

## Repository owner flow: configure, init, push

The owner sets **`nrdocs config set api-url`** (or **`NRDOCS_API_URL`** / **`--api-url`**), runs **`nrdocs init`**, commits, and pushes. **No repo id** is required: CI registers the project with **`POST /oidc/register-project`** using **`docs/project.yml`** and GitHub OIDC.

**Checklist**

1. **`nrdocs config set api-url 'https://…'`** (once per machine), or set **`NRDOCS_API_URL`** / use **`--api-url`** when you run init.
2. **`nrdocs init`** (interactive or non-interactive with **`--slug`**, **`--title`**, **`--repo-identity`** as needed). Optional: **`--repo-id`** only if you are linking an existing Control Plane row (operator-first or copied from Actions).
3. Commit the generated files (including **`.github/workflows/publish-docs.yml`**, **`docs/`**, **`.nrdocs/status.json`**).
4. Push the **publish branch**. The workflow **registers** the site and attempts **one** OIDC publish-credentials exchange. If the repo is still **awaiting approval**, the job **ends without publishing** (by design — no polling loop). After the operator approves, **push again** or **re-run** the workflow to publish in a quick follow-up run.
5. **`nrdocs status`** shows remote state and the reader URL when the platform exposes them (easiest after you optionally link **`--repo-id`** or copy the id from the workflow summary).

### 1. Point the CLI at the Control Plane

Once per machine (or per shell session):

```bash
nrdocs config set api-url 'https://<your-control-plane>.workers.dev'
```

Alternatively set **`NRDOCS_API_URL`** in the environment or pass **`--api-url`** on each command.

### 2. Initialize the repository

From the repo root (or with **`--docs-dir`** if docs live in a subdirectory):

```bash
nrdocs init
```

Optional: **`--repo-id '<uuid>'`** (or **`NRDOCS_REPO_ID`**) to record an existing project id in **`.nrdocs/status.json`** for **`nrdocs status`**. **`--project-id`** is an alias for **`--repo-id`**.

This step:

- writes **`docs/project.yml`**, **`docs/nav.yml`**, starter content, and **`.github/workflows/publish-docs.yml`**
- writes **`.nrdocs/status.json`** with API URL and metadata (and **`repo_id`** when you passed one)
- configures the workflow to use **GitHub Actions OIDC** (no **`NRDOCS_PUBLISH_TOKEN`** secret in GitHub for the default path); the workflow calls **`/oidc/register-project`** then **`/oidc/publish-credentials`**

### 3. Commit and push

```bash
git add -A
git commit -m "Add nrdocs publishing"
git push origin <publish-branch>
```

The publish branch is whatever **`nrdocs init`** configured (often **`main`** or **`nrdocs`** after an import).

### 4. Confirm

- **GitHub Actions** — the run **registers**, tries credentials **once**; if already approved it **publishes** and prints **Reader URL** in the job log and **Summary** when the Control Plane has **`DELIVERY_URL`** set, or when the repo defines Actions variable **`NRDOCS_DELIVERY_URL`** (same value: public delivery worker base URL, no trailing slash). If still awaiting approval, the run exits without a long wait; **re-run or push after approval** to publish. Without either URL source, the summary still shows the **site slug** and configuration hints.
- Locally:

```bash
nrdocs status
```

Shows local metadata, remote approval/publish state when the Control Plane returns **`GET /status/:id`**, and the reader URL when **`DELIVERY_URL`** is configured server-side.

---

## What happens when CI runs (high level)

1. The job requests a **GitHub OIDC** token with **audience** = your Control Plane URL.
2. The workflow calls **`POST /oidc/register-project`** with that token and JSON from **`docs/project.yml`** (creates **`awaiting_approval`** or returns **200** idempotently).
3. The workflow calls **`POST /oidc/publish-credentials`** **once**. If the repo is **not approved** yet (**409**), the job **exits without polling** (saves Actions time). After approval, a **later** push or workflow run performs steps 3–5 again and receives **`repo_publish_token`** and **`repo_id`**.
4. When credentials succeed, the workflow **`POST`s** the rendered payload to **`/repos/:repo_id/publish`** with **`Authorization: Bearer <repo_publish_token>`** and **`X-Repo-Identity: github.com/<owner>/<repo>`**.
5. The Control Plane builds HTML, writes artifacts to R2 under **`publishes/<slug>/<publish-id>/`**, and updates the active pointer in D1.
6. Readers open **`https://<delivery-host>/<slug>/`** (shown in CI when **`DELIVERY_URL`** or repo var **`NRDOCS_DELIVERY_URL`** is set).

---

## Operator quick reference (CLI)

| Goal | Command |
|------|---------|
| List registered sites | **`nrdocs admin list`** (add **`--all`** or filters as needed) |
| Show remote details | **`nrdocs admin status <repo-id>`** |
| Manual publish (operator / break-glass) | Set **`NRDOCS_PUBLISH_TOKEN`**, then **`nrdocs admin publish <repo-id>`** |
| Disable site (404, data kept) | **`nrdocs admin disable <repo-id>`** |
| Remove registration and data | **`nrdocs admin delete <repo-id>`** |
| Operator cheat sheet | **`nrdocs admin quick-guide`** |

---

## Repository owner quick reference (CLI)

| Goal | Command |
|------|---------|
| Set API URL | **`nrdocs config set api-url '…'`** |
| Initialize | **`nrdocs init`** (optional **`--repo-id`** to link metadata) |
| Check setup and URL | **`nrdocs status`** |
| Update generated workflow from metadata | **`nrdocs upgrade`** (after operator/API changes) |
| Password changes (when supported) | **`nrdocs password set`** / **`nrdocs password disable`** |

---

## Design notes

Owner-initiated OIDC registration is specified in [design/10-owner-initiated-registration.md](design/10-owner-initiated-registration.md) (**`POST /oidc/register-project`**). Naming and API direction: [design/11-repo-centric-model.md](design/11-repo-centric-model.md).
