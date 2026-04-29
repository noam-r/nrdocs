# nrdocs

A serverless private documentation publishing platform built on Cloudflare Workers, D1, and R2. Serve Markdown-based documentation minisites from GitHub repositories under a single shared hostname. Reader URLs use a path prefix derived from **organization** and **project** slugs:

- **Default organization** (typical single-tenant / admin-registered projects): `docs.example.com/<project-slug>/…`
- **Named organizations** (multi-tenant): `docs.example.com/<org-slug>/<project-slug>/…`

Project slugs are **unique per organization**, not globally.

Each project maps to one repository, gets its own URL slug (within its org), and supports either public or password-protected access.

## How it works

```
GitHub Repo ──push──▶ GitHub Actions ──POST──▶ Control Plane Worker
                                                    │
                                          build site from Markdown
                                          upload artifacts to R2
                                          update D1 state
                                                    │
User ──GET──▶ Delivery Worker ──lookup D1──▶ serve from R2
```

Two Cloudflare Workers run the platform:

- **Delivery Worker** (`docs.example.com/*`) — resolves org + project from the URL path, handles authentication for password-protected projects, and serves static content from R2.
- **Control Plane Worker** — admin API for project registration, lifecycle management, publish orchestration, and access policy overrides. Protected by API key auth.

Both Workers are configured in a single `wrangler.toml` using Wrangler environments. D1 is the system of record. R2 stores the built HTML artifacts.

## Quick start

```bash
git clone https://github.com/noam-r/nrdocs.git
cd nrdocs
./scripts/setup.sh        # installs deps, Wrangler, creates config files
wrangler login             # authenticate with Cloudflare
./scripts/deploy.sh        # creates D1/R2, sets secrets, deploys Workers
```

For local preview without Cloudflare: `npm run preview`

For full deployment details, see the [Installation guide](docs/content/guides/installation.md).

## Two personas: who does what

### Repo owners (authors): publish docs from your repo

- **You do**: get a bootstrap token from your operator, run `nrdocs init`, commit, push.
- **You do not**: run `nrdocs admin` or handle the platform `NRDOCS_API_KEY`.

```bash
nrdocs init --token '<bootstrap-token>'
git add -A
git commit -m "Initialize nrdocs"
git push
```

Docs:
- [Onboarding (bootstrap token)](docs/content/guides/onboarding-bootstrap.md)
- [OIDC publishing (secretless)](docs/content/guides/oidc-publishing.md)

### Platform operators (admins): run the platform

- **You do**: deploy Workers/D1/R2, keep `NRDOCS_API_KEY` private, issue bootstrap tokens.
- **You do not**: ask repo owners for `NRDOCS_API_KEY`.

Docs:
- [Administrator guide](docs/content/guides/administrator.md)

## Setup

### 1. Run the setup script

```bash
./scripts/setup.sh
```

This installs Node dependencies, Wrangler, jq, and creates `wrangler.toml` and `.env` from their `.example` templates.

### 2. Deploy to Cloudflare

```bash
wrangler login
./scripts/deploy.sh
```

The deploy script handles everything: D1 database creation, R2 bucket creation, wrangler.toml patching, database migrations, secret generation, Worker deployment, and `.env` configuration. No manual copy-paste needed.

### 3. Register and publish

**Option A: Bootstrap token onboarding (recommended)**

If your org admin has given you a bootstrap token, the standalone `nrdocs` CLI handles everything — remote project creation, local file scaffolding, and a secretless GitHub Actions workflow (OIDC):

```bash
nrdocs init --token <bootstrap-token>
nrdocs status
```

This creates the docs structure, registers the project, and generates a workflow that publishes via **GitHub Actions OIDC** (no per-repo secrets/variables). `nrdocs status` shows whether the project is approved/published and which URL to visit. Push to the configured publish branch to publish.

Repo owners normally stop here. They should not need **`nrdocs admin`** or the platform **`NRDOCS_API_KEY`**.

**Step-by-step for authors (after the platform is already deployed):** see the docs page [Onboarding (bootstrap token)](docs/content/guides/onboarding-bootstrap.md) (built site: *Guides → Onboarding (bootstrap token)*).

**Option B: Admin API (platform operators)**

```bash
# Edit .env with your API_URL and API_KEY
nrdocs admin init       # register + approve
nrdocs admin publish    # build and publish docs (repo publish JWT)
```

## Configuration

Both Workers are defined in a single `wrangler.toml`:

- Shared config (account ID, D1, R2) at the top level
- `[env.delivery]` — Delivery Worker settings, routes, and vars
- `[env.control-plane]` — Control Plane Worker settings

### Environment variables

Set in `wrangler.toml` under `[env.delivery.vars]`:

| Variable | Default | Description |
|---|---|---|
| `SESSION_TTL` | `28800` | Session cookie lifetime in seconds (8 hours) |
| `CACHE_TTL` | `300` | `Cache-Control` max-age in seconds (5 minutes) |
| `RATE_LIMIT_MAX` | `5` | Failed login attempts before lockout |
| `RATE_LIMIT_WINDOW` | `300` | Rate limit window in seconds (5 minutes) |

### Secrets

| Secret | Used by | Description |
|---|---|---|
| `HMAC_SIGNING_KEY` | Both Workers | Signs and verifies session tokens. Must be the same value in both. |
| `API_KEY` | Control Plane only | Authenticates admin API requests. |
| `TOKEN_SIGNING_KEY` | Control Plane only | Signs bootstrap and repo publish JWTs. |

## CLI

### nrdocs binary (bootstrap onboarding)

The standalone `nrdocs` CLI handles end-to-end onboarding for developers with a bootstrap token:

```bash
nrdocs init --token <bootstrap-token>
nrdocs status
```

This runs a flow of: preflight checks, token validation, interactive prompting (or flags in CI), **remote project creation**, **local file scaffolding**, and non-secret status metadata. The generated workflow publishes via **GitHub Actions OIDC**, so no `gh` secret/variable installation is required.

**Getting the `nrdocs` command onto your machine**

- **`sh install.sh`** (from this repo) downloads a release asset from GitHub (`nrdocs-linux-x64`, `nrdocs-darwin-arm64`, …). That returns **404** until a Release exists with those exact filenames, or you point at another fork: `NRDOCS_RELEASES_REPO=owner/repo sh install.sh` or `sh install.sh --repo owner/repo`.
- **From a git clone** (Node.js 20+): `npm install && npm run build:cli`, then `sudo cp dist-cli/nrdocs.cjs /usr/local/bin/nrdocs` (or copy into `~/.local/bin/nrdocs`). Same onboarding flow; the script is a bundled Node entrypoint.

After **git pull** CLI changes, run **`npm run build:cli`** again and **overwrite** the file **`command -v nrdocs`** prints (usually **`~/.local/bin/nrdocs`** or **`/usr/local/bin/nrdocs`**). If you see **`bash: /usr/local/bin/nrdocs: No such file or directory`** after copying to **`~/.local/bin`**, run **`hash -r`** (Bash) or **`rehash`** (zsh), or remove the stale **`/usr/local/bin/nrdocs`**. Verify with **`command -v nrdocs`**. Bare **`nrdocs`** vs **`nrdocs --help`** differ, and the first line includes **`nrdocs CLI <version>`**. To try without rebuilding: **`npm run nrdocs:cli -- --help`**.

### `nrdocs admin` (operator commands)

The same **`nrdocs`** binary includes Control Plane operator commands. These are for platform operators, not repo owners. Configure **`.env`** once, then:

```bash
nrdocs admin register    # register a new project
nrdocs admin list        # list approved projects; add --all or --status disabled
nrdocs admin approve <project-id> --repo-identity github.com/org/repo  # approve project for publishing
nrdocs admin mint-publish-token <project-id>   # mint a repo publish JWT (legacy/manual publish)
nrdocs admin publish <project-id>     # build and publish (uses repo publish JWT)
nrdocs admin disable <project-id>     # take it offline
nrdocs admin delete <project-id>      # remove everything
nrdocs admin status <project-id>      # show project details
nrdocs status                         # repo-owner setup/publish status, no admin key
nrdocs admin quick-guide # shortest common operator workflows
nrdocs admin --help      # all operator commands
```

From a git clone you can also run **`./scripts/nrdocs.sh`** (same entrypoint: built bundle or `tsx`). API-only admin commands can run from any operator workspace with the right env. Docs-reading admin commands (**`register`**, **`init`**, **`publish`**) are operator-managed/manual paths; run them from the docs repo root, or with **`NRDOCS_DOCS_DIR`** pointing at that docs directory. **`admin publish`** uses the **repo publish JWT**, not **`NRDOCS_API_KEY`**. In CI, **`nrdocs admin`** refuses unless **`NRDOCS_ALLOW_ADMIN_IN_CI=1`** (avoid putting the platform API key in doc-repo workflows).

## Repository setup (for project owners)

The fastest way to set up a new repo is with a bootstrap token:

```bash
nrdocs init --token <bootstrap-token>
```

This scaffolds the full structure, creates the project on the control plane, and configures CI secrets automatically.

If setting up manually, each documentation project needs this structure:

```
my-project-docs/
├── project.yml               # slug, title, description
├── nav.yml                   # sidebar navigation
├── content/                  # Markdown pages
│   ├── getting-started.md
│   └── guides/
│       └── installation.md
└── .github/workflows/
    └── publish-docs.yml      # generated by nrdocs init, or copy from templates/
```

Pages are plain Markdown — no frontmatter required. Page titles come from `nav.yml` labels. See the [Repository Setup guide](docs/content/guides/repository-setup.md) for details.

## Development

```bash
npm test              # run tests
npm run build:cli     # bundle standalone `nrdocs` CLI to dist-cli/nrdocs.cjs
npm run nrdocs:cli -- --help   # run author CLI from source (no rebuild)
npm run preview       # preview docs locally
npx tsc --noEmit      # type-check
```

## License

Private.
