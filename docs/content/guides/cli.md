# CLI Reference

There is **one** `nrdocs` program (bundled Node binary or `tsx cli/src/main.ts` from a clone). It exposes:

- **`nrdocs init`** — bootstrap-token onboarding for documentation authors
- **`nrdocs import`** — convert existing docs platforms into nrdocs local files
- **`nrdocs status`** — show local setup, approval, publish state, and docs URL
- **`nrdocs admin`** — Control Plane operator commands (API key in `.env`; see below)

If you own a documentation repo but do not operate the nrdocs control plane, the path is:

1. If you already have MkDocs content, optionally run **`nrdocs import mkdocs`** first.
2. Run **`nrdocs init --token '<bootstrap-token>'`** once from your repo.
3. Run **`nrdocs status`** to confirm setup and see the publication URL.
4. Publish by pushing to GitHub. The generated workflow runs the publish.

There is no repo-owner **`nrdocs publish`** command, and repo owners should not need **`nrdocs admin`** or **`NRDOCS_API_KEY`**.

From this repository you can run the same entrypoint as **`nrdocs`** via **`nrdocs`** (delegates to `dist-cli/nrdocs.cjs` after `npm run build:cli`, or to `tsx` before that).

## Top-level usage

With **no arguments**, `nrdocs` prints a **short** repo-owner hint. **`nrdocs --help`** (or **`nrdocs -h`**, **`nrdocs help`**) prints the full “what are you trying to do?” help. Operator details are under **`nrdocs admin --help`**. For the shortest operator cheat sheet, run **`nrdocs admin quick-guide`**.

#### Troubleshooting: wrong path or “No such file or directory”

1. See what runs: **`command -v nrdocs`** and **`type -a nrdocs`** (Bash) or **`whence -a nrdocs`** (zsh).
2. If you copied a new binary to **`~/.local/bin/nrdocs`** but the shell still mentions **`/usr/local/bin/nrdocs`**, Bash is using a **cached path**. Run **`hash -r`** (Bash) or **`rehash`** (zsh), or open a **new** terminal. Remove a stale system binary with **`sudo rm -f /usr/local/bin/nrdocs`** if you intend to use only **`~/.local/bin`**.
3. Put **`~/.local/bin` before `/usr/local/bin`** in `PATH` if both exist and you want the user install to win.

### init

Onboard a repository using a bootstrap token. Runs a flow: preflight checks, token validation, interactive prompting (or non-interactive flags), **remote project creation**, **local file scaffolding**, and non-secret status metadata. The generated publish workflow uses **GitHub Actions OIDC** (no per-repo secrets/variables required).

```bash
nrdocs init --token <bootstrap-token>
```

**Flags:**

| Flag | Required | Description |
|---|---|---|
| `--token <token>` | yes | Bootstrap token issued by your organization admin |
| `--slug <value>` | no | Project slug (for non-interactive use) |
| `--title <value>` | no | Project title (for non-interactive use) |
| `--repo-identity <value>` | no | Repository identity in format `github.com/owner/repo` (for non-interactive use) |
| `--docs-dir <value>` | no | Documentation directory (default: `docs`) |
| `--publish-branch <value>` | no | Git branch that triggers publishing (default: current checked-out branch, falling back to `main`). Use `nrdocs` after `nrdocs import mkdocs`, or `main` when docs live on `main`. |
| `--description <value>` | no | Project description |
| `--skip-gh-permission-check` | no | Skip preflight check for optional `gh` configuration access (advanced) |

In interactive mode, the CLI infers values from the git remote and prompts for confirmation. In non-interactive mode (piped stdin), `--slug`, `--title`, and `--repo-identity` are required.

**What it does:**

1. Verifies you're in a git repo and the token is a valid bootstrap token
2. (Optional) If `gh` is installed and authenticated, runs a preflight for GitHub API access used by some optional flows
3. Validates the token against the control plane, displays org name and remaining quota
4. Infers repo identity, slug, and title from the git remote; prompts for confirmation
5. Creates the project on the control plane (quota is reserved atomically; DB writes are transactional)
6. Generates `project.yml`, `nav.yml`, `content/home.md`, and `.github/workflows/publish-docs.yml`
7. The generated workflow publishes using GitHub Actions OIDC and a Control Plane exchange endpoint (`POST /oidc/publish-credentials`)

If local scaffolding fails after the project was created remotely, the project already exists on the server; the CLI prints a short note so you can clean up if needed.

**Generated workflow:** The generated `publish-docs.yml` requests a GitHub OIDC token (`id-token: write`), exchanges it at `POST /oidc/publish-credentials`, then publishes using the returned short-lived repo publish token. The workflow still sends the `X-Repo-Identity` header (`github.com/${{ github.repository }}`) to bind publishes to the repo identity. The API URL is embedded directly in the workflow file. It runs on pushes to the configured publish branch. During interactive init, the default is the current checked-out branch, so after `nrdocs import mkdocs` it is usually **`nrdocs`**; for ordinary repos where docs live on the default branch, use **`main`**.

**Interrupted init:** If init was interrupted after the Control Plane created the project, rerun the same command with the same token from the same repo. For the same unpublished project and repo identity, the Control Plane recovers the existing project and mints a replacement publish token without consuming another bootstrap quota slot.

### publish

There is no local **`nrdocs publish`** command for documentation repo owners. After **`nrdocs init`**, publishing is intentionally handled by GitHub Actions on pushes to the configured publish branch, using the generated workflow and repository secret.

```bash
git push
```

If you run **`nrdocs publish`**, the CLI explains this and points platform operators to **`nrdocs admin publish`** for manual recovery or operator-managed publishes.

### status

Shows whether the current repository is initialized for nrdocs, whether the Control Plane project is approved, whether a successful publish exists, and the final docs URL.

```bash
nrdocs status
```

`nrdocs init` writes non-secret metadata to **`.nrdocs/status.json`** so this command can check remote status without requiring **`NRDOCS_API_KEY`**. Existing repositories can also set **`NRDOCS_API_URL`** and **`NRDOCS_PROJECT_ID`** in the shell or a local `.env`.

Useful flags and environment:

- **`--docs-dir <dir>`**: read project config from a non-default docs directory.
- **`NRDOCS_DOCS_DIR`**: fallback docs directory when the flag is omitted.
- **`NRDOCS_API_URL`** and **`NRDOCS_PROJECT_ID`**: override the Control Plane URL/project ID used for the remote status check.

### import

Convert an existing documentation platform into local nrdocs files. Import is local-only: it does not create a remote project, mint tokens, or install GitHub secrets.

```bash
nrdocs import mkdocs
```

The MkDocs importer reads **`mkdocs.yml`**, snapshots the MkDocs docs directory, creates or switches to a generated branch, **`nrdocs`** by default, and writes the nrdocs source under **`docs/`** there. This keeps the original MkDocs source on the development branch instead of duplicating both formats side by side.

After you push the generated branch, GitHub may suggest opening a pull request. That PR is not required for publishing. The generated workflow runs on pushes to the configured publish branch, usually **`nrdocs`**, so merging back to **`main`** is not part of the normal flow.

Common flags:

- **`--mkdocs-file <path>`**: MkDocs config file, default **`mkdocs.yml`**.
- **`--docs-dir <path>`**: override MkDocs **`docs_dir`**.
- **`--branch <branch>`**: generated nrdocs branch, default **`nrdocs`**.
- **`--out-dir <path>`**: generated nrdocs directory on that branch, default **`docs`**.
- **`--publish-branch <branch>`**: branch that triggers publishing, defaulting to **`--branch`**.
- **`--slug`**, **`--title`**, **`--description`**: metadata overrides.
- **`--accept-unsupported-customizations`**: continue when MkDocs customizations cannot be imported.
- **`--force`**: switch to an existing target branch and overwrite generated files that differ.

After import, review the generated files and run **`nrdocs init --token '<bootstrap-token>' --docs-dir <out-dir>`** from the generated branch to complete onboarding. The publish branch prompt should default to that branch, usually **`nrdocs`**. See [Importing MkDocs](./import-mkdocs/index.html) for the full guide.

---

## `nrdocs admin` (operator commands)

Platform operators manage projects with **`nrdocs admin <command>`**. Most calls use **`NRDOCS_API_KEY`** (Bearer) against the Control Plane.

**`nrdocs admin publish`** is different: the publish endpoint accepts a **repo publish JWT** only. Set **`NRDOCS_PUBLISH_TOKEN`** (and optionally **`NRDOCS_REPO_IDENTITY`** if the token is bound to a repository). Repo owners normally publish via GitHub Actions **OIDC exchange** (no per-repo secret). In the manual admin flow, **`nrdocs admin mint-publish-token <project-id>`** mints a JWT for operator-driven publishing.

**CI:** if **`CI`** or **`GITHUB_ACTIONS`** is set, **`nrdocs admin`** refuses unless **`NRDOCS_ALLOW_ADMIN_IN_CI=1`**, except **`nrdocs admin --help`**, which always works.

### Who runs `nrdocs admin`

Repo owners should not run **`nrdocs admin`** in the normal product flow. The platform operator gives the repo owner a bootstrap token; the repo owner runs:

```bash
nrdocs init --token '<bootstrap-token>'
```

After that, publishing happens from the generated GitHub Actions workflow when the repo owner pushes changes.

**`nrdocs admin` is for platform operators only.** It exists for operating the control plane: approving, disabling, deleting, inspecting projects, minting/rotating publish tokens, or doing a manual operator publish.

### Where operators run `nrdocs admin`

`nrdocs admin` is not tied to a special “admin repo.” It runs wherever the operator has installed the CLI, and it reads:

- Configuration from environment variables, plus the first **`.env`** found by walking upward from the current directory.
- Documentation files from **`NRDOCS_DOCS_DIR`**, resolved relative to the current directory (default: **`docs`**).

Operators use this rule:

- Run API-only commands (**`init`**, **`status`**, **`approve`**, **`disable`**, **`delete`**, **`set-password`**, **`mint-publish-token`**) from any operator workspace that has the right environment values.
- Run docs-reading admin commands (**`register`**, **`project-init`**, **`publish`**) only when doing an operator-managed or manual path. Run them from the documentation repo root, where **`docs/project.yml`**, **`docs/nav.yml`**, and **`docs/content/`** live. Or run them from another directory and set **`NRDOCS_DOCS_DIR`** to the docs directory path.

Recommended operator setup: keep a private, uncommitted **`.env`** in the nrdocs platform checkout or another operator-only workspace for API-only commands. If an operator needs to manually register or publish a specific docs repo, either run from that docs repo with secrets supplied via the shell, or point **`NRDOCS_DOCS_DIR`** at that repo’s docs directory. Never commit **`.env`** or put **`NRDOCS_API_KEY`** in docs-repo CI.

## Prerequisites

- Node.js 20+ (when running from a git clone without a prebuilt binary)
- A deployed Control Plane Worker (see [Installation](../installation/index.html))

## Setup

### 1. Create your .env file

```bash
cp .env.example .env
```

### 2. Fill in the values

Open `.env` in your editor:

```
NRDOCS_API_URL=https://nrdocs-control-plane.YOUR_SUBDOMAIN.workers.dev
NRDOCS_API_KEY=your-api-key-here
NRDOCS_PROJECT_ID=
NRDOCS_DOCS_DIR=docs
```

| Variable | Required | Description |
|---|---|---|
| `NRDOCS_API_URL` | yes | The URL of your deployed Control Plane Worker. Wrangler prints this when you run `wrangler deploy --env control-plane`. |
| `NRDOCS_API_KEY` | yes | The admin API key you generated during installation and set via `wrangler secret put API_KEY`. This is not a Cloudflare-provided key — it's a secret you created yourself. |
| `NRDOCS_PROJECT_ID` | optional fallback | The project UUID. Prefer passing project IDs directly to commands, e.g. **`nrdocs admin approve <project-id>`**. Set this only for repeated commands against the same project. |
| `NRDOCS_DOCS_DIR` | no | Path to your docs directory relative to the **current working directory**. Defaults to `docs`. |
| `NRDOCS_PUBLISH_TOKEN` | for **`admin publish` only** | Repo publish JWT (`nrdocs init`, docs-repo secret, **`nrdocs admin approve <project-id>`**, or **`nrdocs admin mint-publish-token`**). Not the admin API key. |
| `NRDOCS_REPO_IDENTITY` | no | Sent as **`X-Repo-Identity`** on publish if your token enforces repo binding (for example `github.com/org/repo`). |
| `NRDOCS_SITE_URL` | no | After a successful publish, the CLI prints **`${NRDOCS_SITE_URL}/<slug>/`**. |
| `NRDOCS_REPO_URL` | no | Optional override for **`admin register`** `repo_url` (default `https://github.com/local/<slug>`). |
| `NRDOCS_NEW_PASSWORD` | no | Non-interactive **`admin set-password`** (otherwise TTY reads the password). |

The `.env` file is gitignored — your secrets stay local. The CLI loads the first **`.env`** found walking **upward** from the current working directory (without overriding variables already set in the environment).

For repo-owner onboarding, **`nrdocs init`** prints the final reader URL when the Control Plane has `DELIVERY_URL` configured. Default org projects publish at **`<DELIVERY_URL>/<slug>/`**; named org projects publish at **`<DELIVERY_URL>/<org-slug>/<slug>/`**.

## `nrdocs admin` subcommands

### admin init

Creates a bootstrap token for repo-owner onboarding. Run this from an operator workspace with `NRDOCS_API_URL` and `NRDOCS_API_KEY`, then send the printed token to the repo owner over a secure channel.

```bash
nrdocs admin init --org default
```

Options:

| Flag | Description |
|---|---|
| `--org <slug>` | Organization slug, default `default` |
| `--max-repos <n>` | Number of repositories this token may onboard, default `1` |
| `--expires-in-days <n>` | Token lifetime, default `7` |
| `--created-by <label>` | Audit label, default `admin_cli` |
| `--json` | Print raw JSON response |

The repo owner then runs:

```bash
nrdocs init --token '<bootstrap-token>'
```

### admin project-init

Advanced/manual shortcut for operator-managed projects. Registers a project from local docs files, approves it, and mints a publish token. Prefer bootstrap onboarding for normal repo-owner setup.

```bash
nrdocs admin project-init
```

Reads from: `.env` (`NRDOCS_API_URL`, `NRDOCS_API_KEY`) and `docs/project.yml` (slug, title, access_mode).

### admin register

Registers a new project with the Control Plane. The project starts in `awaiting_approval` status.

```bash
nrdocs admin register
```

Reads from:
- `.env` — `NRDOCS_API_URL`, `NRDOCS_API_KEY`
- `docs/project.yml` — `slug`, `title`, `description`, `access_mode`

The command parses your `project.yml` and sends a registration request to the Control Plane. On success, it prints the new project UUID:

```
Registering project: nrdocs
Success (201)
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "slug": "nrdocs",
  "status": "awaiting_approval",
  ...
}

Project ID: 550e8400-e29b-41d4-a716-446655440000
Use it directly:
  nrdocs admin approve 550e8400-e29b-41d4-a716-446655440000

Or keep it in your private .env for repeated commands:
  NRDOCS_PROJECT_ID=550e8400-e29b-41d4-a716-446655440000
```

Use the ID directly for the next command, or copy it into your private `.env` if you will run many commands against the same project.

### admin list

Lists projects. By default, this shows only **approved** projects.

```bash
nrdocs admin list
nrdocs admin list --all
nrdocs admin list --status awaiting_approval
nrdocs admin list --name customer
nrdocs admin list --slug docs
nrdocs admin list --repo-identity github.com/org/repo
nrdocs admin list --json
```

Filters:

| Flag | Description |
|---|---|
| `--all` | Include all statuses instead of defaulting to `approved` |
| `--status <value>` | Filter by `awaiting_approval`, `approved`, or `disabled` |
| `--name <value>` | Search slug or title |
| `--slug <value>` | Search slug |
| `--title <value>` | Search title |
| `--repo-identity <value>` | Search repo identity |
| `--access-mode <value>` | Filter by `public` or `password` |
| `--json` | Print raw JSON for scripts |

### admin approve

Approves a registered project, transitioning it from `awaiting_approval` to `approved`, then mints a repo publish token by default. Only approved projects can accept publishes and serve content.

```bash
nrdocs admin approve <project-id>
nrdocs admin approve <project-id> --repo-identity github.com/myorg/myrepo
```

Reads from: `.env` — `NRDOCS_API_URL`, `NRDOCS_API_KEY`. The project ID is positional, with `NRDOCS_PROJECT_ID` as an optional fallback.

If the project already has **`repo_identity`**, no extra flag is needed. Otherwise pass **`--repo-identity`** so the token is bound to the correct GitHub repo. Use **`--no-mint-publish-token`** only for the rare status-only approval case.

### admin mint-publish-token

Calls **`POST /projects/:id/publish-token`** with **`NRDOCS_API_KEY`**. Creates a **repo publish** JWT in the control plane (same kind CI uses) so you can set **`NRDOCS_PUBLISH_TOKEN`** for **`admin publish`**.

You normally do **not** need this immediately after **`approve`**, because **`approve`** mints the first publish token by default. Use this command for token rotation or recovery.

```bash
nrdocs admin mint-publish-token <project-id>
nrdocs admin mint-publish-token <project-id> --repo-identity github.com/myorg/myrepo
```

If the project row already has **`repo_identity`**, you can use an empty JSON body (the CLI sends `{}`). Otherwise pass **`--repo-identity`** or set **`NRDOCS_REPO_IDENTITY`**. The project must be **`approved`**.

### admin publish

Reads all files from your docs directory, packages them into a JSON payload, and sends it to the Control Plane's publish endpoint. The Control Plane then builds the HTML and uploads it to R2.

```bash
nrdocs admin publish <project-id>
```

Reads from:
- `.env` — `NRDOCS_API_URL`, `NRDOCS_PUBLISH_TOKEN`, `NRDOCS_DOCS_DIR` (and optional `NRDOCS_PROJECT_ID`, `NRDOCS_REPO_IDENTITY`, `NRDOCS_SITE_URL`)
- `docs/project.yml` — sent as-is to the Control Plane
- `docs/nav.yml` — sent as-is to the Control Plane
- `docs/allowed-list.yml` — sent if present, otherwise null
- `docs/content/**/*.md` — every Markdown file is read and included in the payload

The command:
1. Validates that `project.yml`, `nav.yml`, and `content/` exist in the docs directory
2. Reads all files and constructs the JSON payload
3. POSTs it to `$NRDOCS_API_URL/projects/<project-id>/publish`
4. Prints the result (success with publish ID, or failure with error details)

The project must be in `approved` status. If it's still `awaiting_approval` or has been `disabled`, the publish will be rejected.

### admin status

Fetches and displays the current project details from the Control Plane.

```bash
nrdocs admin status <project-id>
```

Reads from: `.env` — `NRDOCS_API_URL`, `NRDOCS_API_KEY`. The project ID is positional, with `NRDOCS_PROJECT_ID` as an optional fallback.

### admin set-password

Sets or updates the password for a **`password`** access-mode project.

```bash
nrdocs admin set-password <project-id>
```

Uses **`NRDOCS_API_KEY`**. On a TTY, reads the password without echoing; in automation, set **`NRDOCS_NEW_PASSWORD`**.

### admin disable

Disables a project. Disabled projects return 404 to all readers and reject publish requests. All data (D1 records, R2 artifacts) is preserved — you can re-approve the project later.

```bash
nrdocs admin disable <project-id>
```

Reads from: `.env` — `NRDOCS_API_URL`, `NRDOCS_API_KEY`. The project ID is positional, with `NRDOCS_PROJECT_ID` as an optional fallback.

### admin delete

Permanently deletes a project and all associated data: D1 records, R2 artifacts, and access configuration. This cannot be undone.

```bash
nrdocs admin delete <project-id>
```

Reads from: `.env` — `NRDOCS_API_URL`, `NRDOCS_API_KEY`. The project ID is positional, with `NRDOCS_PROJECT_ID` as an optional fallback.

Prompts for confirmation before proceeding:

```
Are you sure you want to delete project 550e8400-...? This removes all data. [y/N]
```

### help

Shows operator usage (same as **`nrdocs admin --help`**).

```bash
nrdocs admin --help
```

## Typical workflow

### First time

```bash
# 1. Set up your .env
cp .env.example .env
# Edit .env: set NRDOCS_API_URL and NRDOCS_API_KEY

# 2. Register the project
nrdocs admin register
# Copy the project ID from the output

# 3. Approve it
nrdocs admin approve <project-id> --repo-identity github.com/myorg/myrepo

# 4. Publish
nrdocs admin publish <project-id>
```

### Subsequent publishes

After the initial setup, publishing is a single command:

```bash
nrdocs admin publish <project-id>
```

Edit your Markdown files, run publish, and the live site updates.

### Using npm

You can also run the CLI through npm:

```bash
npm run nrdocs -- admin publish <project-id>
npm run nrdocs -- admin status <project-id>
npm run nrdocs -- admin --help
```

## Error messages

| Error | Cause | Fix |
|---|---|---|
| `NRDOCS_API_URL is not set` | `.env` is missing or `NRDOCS_API_URL` is empty | Create `.env` from `.env.example` and fill in the URL |
| `NRDOCS_API_KEY is not set` | `NRDOCS_API_KEY` is empty in `.env` | Add your API key to `.env` |
| Missing project id | You did not pass a project ID and `NRDOCS_PROJECT_ID` is empty | Run **`admin register`** first, then pass the printed ID, e.g. **`nrdocs admin approve <project-id>`** |
| Refusing admin CLI in CI | `GITHUB_ACTIONS` or `CI` is set | Do not use the platform API key in doc-repo workflows; for platform-repo jobs only, set **`NRDOCS_ALLOW_ADMIN_IN_CI=1`** |
| `NRDOCS_PUBLISH_TOKEN is not set` | **`admin publish`** needs the repo publish JWT | Run **`nrdocs admin approve <project-id>`** for new projects, **`nrdocs admin mint-publish-token <project-id>`** for rotation/recovery, or copy from **`nrdocs init`** / docs repo **`NRDOCS_PUBLISH_TOKEN`** secret |
| `project.yml not found` | The docs directory doesn't have a `project.yml` | Check `NRDOCS_DOCS_DIR` in `.env` and make sure the file exists |
| `Failed (409)` on register | A project with that slug already exists **in the same organization** | Use a different slug in `project.yml`, or delete the existing project first |
| `Failed (409)` on publish | Project is not in `approved` status | Run **`admin approve <project-id>`** first |
