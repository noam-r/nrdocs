# Onboarding a documentation repository (operator-approved)

This page is the **repo-owner path** for using nrdocs once the platform is already deployed.

In the current nrdocs development model, **registering a site on the control plane is operator-only**:

- Repo owners run **tokenless** `nrdocs init` to scaffold local files + the publish workflow.
- Platform operators run **`nrdocs admin register`** + **`nrdocs admin approve`** to create and approve the remote row that the repo is allowed to publish to.

There is intentionally **no bootstrap/onboarding-token** flow in the default product path.

---

## What you need

| Item | Why |
|------|-----|
| A GitHub repository | GitHub Actions OIDC is the supported CI publishing mechanism. |
| The `nrdocs` CLI | You install it locally (see [Install the CLI](#install-the-cli)). |
| Control Plane URL and repo id | Your operator provides: `NRDOCS_API_URL` and the repo UUID. These are not secrets. |

You do **not** need the platform admin API key (`NRDOCS_API_KEY`), `wrangler`, or Cloudflare dashboard access.

### Where does the repo id (UUID) come from?

- **Typical repo owner:** nowhere public inside your repo until someone registers the site on the control plane. Ask your operator for the UUID (same channel as the Control Plane URL).
- **Operator:** when you **`nrdocs admin register`** or call **`POST /repos`**, the API returns a record whose **`id`** field is that UUID; the CLI prints it after register. To find an existing site, run **`nrdocs admin list`** (add **`--all`** or **`--status awaiting_approval`** if needed); the first column is the id.
- **This checkout after `init`:** **`.nrdocs/status.json`** contains **`repo_id`**; **`nrdocs status`** displays it. That only helps after you already had the id once to run `init`.

---

## The flow in one minute

1. **Install `nrdocs`** and verify `nrdocs --help` works.
2. **Clone your repo**, `cd` into it, ensure `origin` points at GitHub (so repo identity can be inferred).
3. Ask your operator for:
   - Control Plane URL (example): `https://nrdocs-control-plane.example.workers.dev`
   - Repo id (UUID)
4. Run init:

```bash
nrdocs config set api-url 'https://<control-plane-worker>'
nrdocs init --repo-id '<repo-id>'
```

5. Commit and push to your publish branch (defaults to current branch; commonly `nrdocs` after import, or `main` when docs live on main):

```bash
git add -A
git commit -m "Initialize nrdocs"
git push
```

6. GitHub Actions runs the generated workflow, authenticates to the Control Plane using **OIDC**, and publishes.

---

## Password mode (recommended for private docs)

`nrdocs init` defaults projects to **`password`** access mode in the generated `docs/project.yml`.

To avoid any chance of publishing without a password configured, the operator should set the password **before your first publish**:

```bash
nrdocs admin set-password <repo-id>
```

Repo owners can also manage passwords using the repo-proof challenge flow:

```bash
nrdocs password set
```

---

## Install the CLI

Use the **[Installation](installation/index.html)** guide for release downloads, `install.sh`, `PATH`, and troubleshooting (including “command not found” and stale `/usr/local/bin` paths).

**Quick path from a clone** (Node.js 20+):

```bash
cd /path/to/nrdocs
npm install
npm run build:cli
mkdir -p "$HOME/.local/bin"
cp dist-cli/nrdocs.cjs "$HOME/.local/bin/nrdocs"
chmod +x "$HOME/.local/bin/nrdocs"
```

Put `$HOME/.local/bin` on your `PATH`, then run `nrdocs --help`.

---

## After onboarding

| Topic | Where to read more |
|--------|---------------------|
| Editing nav and pages | [Repository Setup](../repository-setup/index.html) |
| Flags for non-interactive / CI | [CLI Reference](../cli/index.html) |
| What publish sends and how URLs work | [Publishing](../publishing/index.html), [How it works](../../how-it-works/index.html) |
| Operator project creation | [Administrator guide](../administrator/index.html), [Admin quick guide](../admin-quick-guide/index.html) |

---

## Roles at a glance

| Role | What they do |
|------|----------------|
| **Platform operator** | Deploys nrdocs ([Installation](../installation/index.html)), registers sites with **`nrdocs admin register`**, approves with **`nrdocs admin approve`**, and (optionally) sets passwords with **`nrdocs admin set-password`**. |
| **Documentation repo owner** | Installs `nrdocs`, runs **`nrdocs config set api-url …`** once, then **`nrdocs init --repo-id …`** in the repo, commits, pushes — no Cloudflare dashboard required. |
