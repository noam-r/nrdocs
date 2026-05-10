# nrdocs

Serverless docs publishing for private GitHub repos. Protected-first — nothing is public until an operator says so.

## How it works

```
Repo owner: writes docs → pushes to GitHub → artifacts uploaded automatically
Operator:   approves repo → docs become visible
Reader:     visits URL → sees docs (if allowed)
```

Repos are invisible by default. An operator must explicitly approve each repo and choose whether it's public or password-protected.

## Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- A Cloudflare account (free tier works)
- A GitHub repo with Actions enabled

## Install

The package is not yet published to npm. Install from source:

```bash
git clone <this-repo>
cd nrdocs
pnpm install
pnpm build
```

Make the `nrdocs` command available:

```bash
pnpm setup   # creates ~/.local/share/pnpm and adds it to PATH
source ~/.bashrc  # or restart your terminal
pnpm link --global --dir packages/cli
```

Verify:

```bash
$ nrdocs --version
nrdocs 0.1.0
```

> **Repo owners** don't need to install nrdocs locally. The GitHub Action workflow handles everything via `npx nrdocs publish` once the package is published.

## Quick start

### 1. Deploy (operator)

```bash
nrdocs deploy
```

Prompts for instance name, Cloudflare account, domain, etc. Saves credentials locally — no env vars needed after this.

All Cloudflare resources are named with a `nrdocs-{instance}` prefix:

```
Instance name: prod
  → Worker:   nrdocs-prod
  → D1:       nrdocs-prod-db
  → R2:       nrdocs-prod-artifacts
```

Default instance name is `default`. You can run multiple instances on the same account:

```bash
nrdocs deploy --instance prod    # nrdocs-prod, nrdocs-prod-db, nrdocs-prod-artifacts
nrdocs deploy --instance staging # nrdocs-staging, nrdocs-staging-db, nrdocs-staging-artifacts
```

### 2. Set up a repo (repo owner)

```bash
nrdocs init
git add docs .github/workflows/nrdocs.yml
git commit -m "Add nrdocs"
git push
```

The GitHub Action runs automatically. Docs are uploaded but not visible yet.

### 3. Approve the repo (operator)

```bash
nrdocs repos                              # see pending repos
nrdocs approve owner/repo --access password
nrdocs password set owner/repo            # set the reader password
```

Docs are now live at `https://docs.example.com/owner/repo/`.

## Operator commands

```bash
# List repos
nrdocs repos
nrdocs repos --pending
nrdocs repos --approved

# Approve
nrdocs approve owner/repo --access public
nrdocs approve owner/repo --access password

# Set password
nrdocs password set owner/repo

# Change access
nrdocs access set owner/repo public
nrdocs access set owner/repo password

# Disable
nrdocs disable owner/repo

# Auto-approval rules
nrdocs rules add 'myorg/*' --access password
nrdocs rules add 'myorg/public-docs' --access public
nrdocs rules list
nrdocs rules remove RULE_ID

# Status
nrdocs status owner/repo
```

## Repo owner commands

```bash
# Initialize docs in your repo
nrdocs init

# Publish (runs in GitHub Actions, not locally)
nrdocs publish

# Check setup
nrdocs doctor
```

## Auth & profiles

```bash
# First time (after deploy, this is automatic)
nrdocs auth login

# Check current auth
nrdocs auth status

# Switch profiles
nrdocs profiles list
nrdocs profiles use staging

# Logout
nrdocs auth logout
```

For CI/automation, use env vars:

```bash
NRDOCS_API_URL=https://docs.example.com \
NRDOCS_OPERATOR_TOKEN=nrdocs_op_... \
nrdocs repos
```

## Auto-approval

Skip manual approval for trusted namespaces:

```bash
# All repos under myorg get password-protected access
nrdocs rules add 'myorg/*' --access password

# One specific repo gets public access
nrdocs rules add 'myorg/public-docs' --access public
```

Rules apply to future publishes. To also approve existing pending repos:

```bash
nrdocs rules add 'myorg/*' --access password --apply-existing
```

## Access modes

| Mode | Behavior |
|---|---|
| `public` | Anyone can read |
| `password` | Requires operator-set password |
| `none` | Not visible (default for new repos) |

## Docs format

nrdocs renders Markdown to HTML. No build tools needed.

```
docs/
  nrdocs.yml      # config
  index.md        # homepage
  getting-started.md
  guides/
    setup.md
```

Minimal `docs/nrdocs.yml`:

```yaml
site:
  title: My Project Docs

content:
  source_dir: .
  index: index.md
  nav: auto
```

Supported content:
- Markdown with GFM tables
- Images (png, jpg, svg, gif, webp)
- PDFs
- No JavaScript, no raw HTML (escaped for security)

## URLs

Docs are served at:

```
https://docs.example.com/owner/repo/
https://docs.example.com/owner/repo/getting-started/
https://docs.example.com/owner/repo/guides/setup/
```

## Architecture

- **Runtime**: Cloudflare Workers (serverless)
- **Storage**: R2 (artifacts), D1 (metadata)
- **Auth**: GitHub OIDC (publish), operator token (admin)
- **No persistent server** — everything is request-driven

## Project structure

```
packages/
  shared/   — Types and constants
  worker/   — Cloudflare Worker (API + serving)
  cli/      — nrdocs CLI
```

## Development

```bash
pnpm install
pnpm build
pnpm -r test    # 424 tests
```

## Specs

Full specification in `nrdocs-specs/`. Start with `17-implementation-decision-register.md`.
