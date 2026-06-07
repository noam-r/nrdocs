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

On first run, prompts for instance name, public URL, and operator token, then saves an operator profile locally.

On later runs, `nrdocs deploy` reuses that profile (same instance and URL) with no prompts — migrations and Worker deploy only. Pass flags such as `--instance` or `--base-url` when you need to override.

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
nrdocs rules update RULE_ID --allow-unlisted-files false

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

## Markdown export (readers)

Published sites can offer an **Export** menu (page `.md` or site `.zip`) in the right panel, above “On this page” (same access rules as viewing docs). Controlled in `docs/nrdocs.yml`:

```yaml
export: true   # default when omitted
```

Set `export: false` to hide the buttons and omit source files from the artifact. Republish after changing this flag.

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

### Non-whitelisted asset files (operator opt-in)

By default, only **whitelisted** extensions may appear in published docs (images, PDF, `.json`, `.yaml`, `.yml`, `.txt`, `.xml`, etc.). Other files (for example `.zip`) are rejected unless the matching auto-approval rule explicitly allows them:

```bash
nrdocs rules add 'myorg/data-docs' --access password --allow-unlisted-files true
```

To revoke consent without deleting the rule:

```bash
nrdocs rules update RULE_ID --allow-unlisted-files false
```

Omitting `--allow-unlisted-files` on `rules add` means unlisted files are **not** allowed. Executable/script extensions (`.js`, `.mjs`, `.cjs`) are always forbidden except platform runtime under `_nrdocs/`.

## Access modes

| Mode | Behavior |
|---|---|
| `public` | Anyone can read |
| `password` | Requires operator-set password |
| `none` | Not visible (default for new repos) |

## Self-service docs passwords (operator opt-in)

Operators can let repo owners set their own docs password instead of requiring the operator to run `nrdocs password set` for every repo. When a repo is opted in, the repo owner stores a password in a GitHub Actions Secret, the publish workflow forwards it to the Worker over TLS, and the Worker hashes and stores it automatically. Repos that are not opted in simply ignore any password sent during publish — no error, no side effect.

### Operator: opt a repo in or out

Use the `nrdocs password allow` and `nrdocs password disallow` subcommands to control which repos may self-set their password:

```bash
# Enable self-service password for a repo
nrdocs password allow myorg/myrepo

# Revoke self-service password capability
nrdocs password disallow myorg/myrepo
```

Both commands are idempotent — running them twice with the same value succeeds both times.

### Repo owner: set the secret

Once the operator has opted your repo in, create a GitHub Actions encrypted Secret named `NRDOCS_DOCS_PASSWORD` on your repository:

1. Go to your repo → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `NRDOCS_DOCS_PASSWORD`
4. Value: your desired password (8–72 characters)
5. Click "Add secret"

The workflow generated by `nrdocs init` already references this secret. If the secret is not set, the workflow still runs successfully — the password field is simply omitted from the publish request.

### What happens to access mode

When a self-service password is accepted, the effect on the repo's access mode depends on its current state:

| Current access mode | What happens |
|---|---|
| `password` | New password replaces the old one. Access mode stays `password`. |
| `none` | Password is stored and access mode is automatically set to `password`. |
| `public` | Password is stored but access mode stays `public`. The operator can later switch to `password` via `nrdocs access set`. |
| (repo is `pending`) | Password is stored. No other fields change — the normal approval flow still applies. |
| (repo is `disabled`) | Publish is rejected before the password is even read. |

A repo owner can never change the access mode away from `password` — only the operator can do that via `nrdocs access set`.

### Behavior on non-opted-in repos

If `NRDOCS_DOCS_PASSWORD` is set on a repo that has **not** been opted in by the operator, nothing happens. The publish succeeds normally, the password is silently dropped, and the response is identical to a publish without a password. This is by design — a shared workflow template works the same way regardless of whether a repo is opted in.

### Operator override

The existing `nrdocs password set` command continues to work as a fallback and as the override path:

```bash
nrdocs password set myorg/myrepo
```

This sets the password directly regardless of the allow flag and remains the canonical operator path for managing passwords.

### Rule-driven defaults (`--self-set-password`)

When adding an auto-approval rule, you can control whether newly auto-approved repos get self-service password capability:

```bash
# Default (allow) — new repos auto-approved by this rule can self-set passwords
nrdocs rules add 'myorg/*' --access password

# Explicit allow
nrdocs rules add 'myorg/*' --access password --self-set-password allow

# Deny — new repos auto-approved by this rule cannot self-set passwords
nrdocs rules add 'myorg/internal-*' --access password --self-set-password deny
```

The default when `--self-set-password` is omitted is `allow`.

**Scope:** This flag only affects NEW repos at the moment they are auto-approved by the rule. It never modifies already-existing repo rows. It is independent of `--apply-existing`, which continues to control only `access_mode` propagation.

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
