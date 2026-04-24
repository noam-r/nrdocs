# nrdocs

A serverless private documentation publishing platform built on Cloudflare Workers, D1, and R2. Serve Markdown-based documentation minisites from GitHub repositories under a single shared hostname (`docs.example.com/<slug>/`).

Each project maps to one repository, gets its own URL slug, and supports either public or password-protected access.

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

- **Delivery Worker** (`docs.example.com/*`) — routes requests by slug, handles authentication for password-protected projects, and serves static content from R2.
- **Control Plane Worker** — admin API for project registration, lifecycle management, publish orchestration, and access policy overrides. Protected by API key auth.

Both Workers are configured in a single `wrangler.toml` using Wrangler environments. D1 is the system of record. R2 stores the built HTML artifacts.

## Quick start

```bash
git clone https://github.com/example/nrdocs.git
cd nrdocs
./scripts/setup.sh        # installs deps, Wrangler, creates config files
wrangler login             # authenticate with Cloudflare
./scripts/deploy.sh        # creates D1/R2, sets secrets, deploys Workers
```

For local preview without Cloudflare: `npm run preview`

For full deployment details, see the [Installation guide](docs/content/guides/installation.md).

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

If your org admin has given you a bootstrap token, the standalone `nrdocs` CLI handles everything — project creation, file scaffolding, token minting, and CI secret installation:

```bash
nrdocs init --token <bootstrap-token>
```

This creates the docs structure, registers the project, mints a repo publish token, and configures GitHub Actions secrets via `gh`. Push to `main` to publish.

**Option B: Admin API (platform operators)**

```bash
# Edit .env with your API_URL and API_KEY
./scripts/nrdocs.sh init       # register + approve
./scripts/nrdocs.sh publish    # build and publish docs
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
```

This runs a 6-phase flow: preflight checks, token validation, interactive prompting, file scaffolding, remote project creation + token minting, and CI secret installation. See `nrdocs init --help` for all flags (`--slug`, `--title`, `--repo-identity`, `--docs-dir`, `--description`).

### nrdocs.sh (admin operations)

The `nrdocs.sh` shell CLI wraps the Control Plane admin API. Configure `.env` once, then manage projects:

```bash
./scripts/nrdocs.sh register   # register a new project
./scripts/nrdocs.sh approve    # approve it for publishing
./scripts/nrdocs.sh publish    # build and publish docs
./scripts/nrdocs.sh disable    # take it offline
./scripts/nrdocs.sh delete     # remove everything
./scripts/nrdocs.sh status     # show project details
./scripts/nrdocs.sh help       # all commands
```

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
npm run preview       # preview docs locally
npx tsc --noEmit      # type-check
```

## License

Private.
