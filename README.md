# nrdocs

Serverless docs publishing from GitHub repos — keep docs with the code, control visibility separately.

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

```bash
npm install -g nrdocs
```

Verify:

```bash
$ nrdocs --version
nrdocs 0.1.0
```

For development from source:

```bash
git clone https://github.com/noam-r/nrdocs.git
cd nrdocs
pnpm install
pnpm build
pnpm setup && source ~/.bashrc
pnpm link --global --dir packages/cli
```

## Quick start

### 1. Deploy (operator)

```bash
nrdocs deploy
```

Prompts for instance name, Cloudflare account, domain, etc. Saves credentials locally.

### 2. Allow repos to publish (operator — required before first publish)

Before any repo can publish, the operator must add a rule that allows it:

```bash
nrdocs rules add 'myorg/*' --access password
```

This allows all repos under `myorg` to publish. Without this step, the first publish will fail with:

```
Error: Repository 'myorg/repo' is not allowed to publish to this instance.
The operator must add an auto-approval rule first.
Run: nrdocs rules add 'myorg/*' --access password
```

### 3. Set up a repo (repo owner)

```bash
nrdocs init
git add docs .github/workflows/nrdocs.yml
git commit -m "Add nrdocs"
git push
```

The GitHub Action runs automatically. If a matching rule exists, the repo is auto-approved. Otherwise it lands in `pending` state.

### 4. Approve the repo (operator — if not auto-approved)

```bash
nrdocs repos                                # see pending repos
nrdocs approve owner/repo --access public   # or --access password
```

Docs are now live at `https://your-domain.com/owner/repo/`.

## Publish allowlist

nrdocs only accepts publishes from repos that are either:

1. **Already known** — previously published (pending or approved)
2. **Matching an auto-approval rule** — e.g., `myorg/*` or `myorg/specific-repo`

This prevents unauthorized repos from uploading artifacts to your instance. The API URL alone is not enough to publish.

**If a publish fails with "not allowed":**

1. Ask the operator to add a rule:
   ```bash
   nrdocs rules add 'owner/*' --access password
   ```
2. Re-run the GitHub Action

## Instance naming

All Cloudflare resources use a `nrdocs-{instance}` prefix:

```
Instance name: prod
  → Worker:   nrdocs-prod
  → D1:       nrdocs-prod-db
  → R2:       nrdocs-prod-artifacts
```

Multiple instances on the same account:

```bash
nrdocs deploy --instance prod
nrdocs deploy --instance staging
```

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

# Auto-approval rules (also controls publish allowlist)
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

## Auto-approval rules

Rules serve two purposes:
1. **Publish allowlist** — only repos matching a rule (or already known) can upload
2. **Auto-approval** — matching repos are approved automatically on first publish

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
https://your-domain.com/owner/repo/
https://your-domain.com/owner/repo/getting-started/
https://your-domain.com/owner/repo/guides/setup/
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
pnpm -r test
```

## Specs

Full specification in `nrdocs-specs/`. Start with `17-implementation-decision-register.md`.
