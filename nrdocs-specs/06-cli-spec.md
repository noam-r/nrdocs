# 06 - CLI Spec

## Status

Draft for MVP rewrite.

## Depends on

- `00-product-brief.md`
- `01-non-negotiable-invariants.md`
- `02-user-flows.md`
- `03-system-architecture.md`
- `04-data-model.md`
- `05-api-spec.md`

## Purpose

This document specifies the `nrdocs` command-line interface.

The CLI has two audiences:

1. **Repo owners**, who initialize and publish docs from a GitHub repository.
2. **Operators**, who approve repos, set access policies, manage passwords, and inspect system state.

The CLI is a client only. It must not require direct database access, direct R2 access, or a persistent server. All operator actions go through authenticated Worker API endpoints.

## CLI design principles

### 1. One obvious repo-owner path

The repo-owner happy path is:

```bash
nrdocs init
git add docs .github/workflows/nrdocs.yml
git commit -m "Add nrdocs"
git push
```

After the first push, the GitHub Action runs `nrdocs publish`.

A pending approval state is not a repo-owner error.

### 2. Operator owns visibility

Repo-owner commands may create docs source files and upload generated artifacts.

Repo-owner commands must not:

- approve a repo;
- make a repo public;
- set effective access mode;
- set or change platform passwords;
- create custom routes;
- modify auto-approval rules.

### 3. Protected-first output

The CLI must never imply that a newly published repo is visible unless the Worker API says it is actually approved and serveable.

Use explicit language:

```text
Docs uploaded. Awaiting operator approval.
```

Do not use misleading language:

```text
Docs published publicly.
```

unless the API response confirms `serving.status = "available"` and `access_mode = "public"`.

### 4. Human handles use `owner/repo`

Humans refer to repos as:

```text
owner/repo
```

Example:

```bash
nrdocs approve noam-r/repoA --access password
```

The internal database may use UUIDs and GitHub repository IDs, but normal CLI output should prefer `owner/repo`.

### 5. Scripts receive stable machine-readable options

Every command that returns status should support:

```bash
--json
```

When `--json` is used, output must be valid JSON with a stable schema.

## Installation

The CLI may be distributed as a Node package, standalone binary, or both. This spec does not mandate the packaging technology.

The executable name is:

```bash
nrdocs
```

## Global options

All commands support:

```bash
--help
--version
```

API-connected commands support:

```bash
--api-url <url>
--json
```

Operator commands additionally support:

```bash
--token <token>
```

But token values should usually come from environment variables.

## Environment variables

### Shared

```text
NRDOCS_API_URL
```

Base URL of the nrdocs Worker API.

Example:

```text
https://docs.example.com/api
```

### Operator

```text
NRDOCS_OPERATOR_TOKEN
```

Bearer token for operator API access. Used as an override for CI and automation. For normal local usage, credentials are stored in the local CLI config file (see "Local CLI config" section).

```text
NRDOCS_PROFILE
```

Name of the local config profile to use. Defaults to `default_profile` from the config file.

### GitHub Action / publish

```text
ACTIONS_ID_TOKEN_REQUEST_URL
ACTIONS_ID_TOKEN_REQUEST_TOKEN
GITHUB_REPOSITORY
GITHUB_REPOSITORY_ID
GITHUB_SHA
GITHUB_REF
GITHUB_RUN_ID
```

These are provided by GitHub Actions. The CLI must not require repo owners to create long-lived publish tokens.

## Local CLI config

The nrdocs CLI stores operator connection settings in a local per-user config file.

Default location:

```text
Linux/macOS: $XDG_CONFIG_HOME/nrdocs/config.json (or ~/.config/nrdocs/config.json)
Windows: %APPDATA%\nrdocs\config.json
```

The CLI must create the parent directory with user-only permissions where supported.

On Unix-like systems:

```text
config directory mode: 0700
config file mode: 0600
```

If the config file exists but has overly broad permissions, the CLI should warn. For commands that require an operator token, the CLI may refuse to use an insecure config file unless the user fixes permissions or passes `--allow-insecure-config`.

### Local config schema

```json
{
  "version": 1,
  "default_profile": "default",
  "profiles": {
    "default": {
      "api_url": "https://docs.example.com",
      "operator_token": "nrdocs_op_xxxxxxxxxxxxxxxxx",
      "deployment_name": "nrdocs",
      "created_at": "2026-05-08T12:00:00Z",
      "updated_at": "2026-05-08T12:00:00Z"
    }
  }
}
```

Required profile fields:

```text
api_url
operator_token
```

Optional profile fields:

```text
deployment_name
created_at
updated_at
```

### API URL and operator token resolution

For operator-authenticated commands, the CLI resolves connection settings in this order:

```text
1. Explicit flags: --api-url, --token, --profile
2. Environment variables: NRDOCS_API_URL, NRDOCS_OPERATOR_TOKEN, NRDOCS_PROFILE
3. Local config: selected profile from --profile, then NRDOCS_PROFILE, then default_profile
4. Interactive prompt: only for commands that explicitly support login or deployment
```

If no API URL or token is available for an operator command, the CLI must fail with a helpful error:

```text
Operator credentials are not configured.

Run:
  nrdocs auth login

or pass:
  --api-url https://docs.example.com --token <operator-token>
```

## Command groups

```text
Repo-owner commands:
  nrdocs init
  nrdocs publish
  nrdocs doctor

Repo-owner status in MVP is provided primarily by the GitHub Action step summary after `nrdocs publish`.

Operator commands:
  nrdocs deploy
  nrdocs auth login
  nrdocs auth status
  nrdocs auth logout
  nrdocs repos
  nrdocs approve
  nrdocs disable
  nrdocs access set
  nrdocs password set
  nrdocs rules list
  nrdocs rules add
  nrdocs rules remove
  nrdocs static list
  nrdocs static set
  nrdocs static remove
  nrdocs config show
  nrdocs profiles list
  nrdocs profiles use
  nrdocs profiles remove
  nrdocs audit
```

## Command: `nrdocs init`

### Purpose

Initialize nrdocs in a GitHub repository.

### Audience

Repo owner.

### Usage

```bash
nrdocs init
```

Optional flags:

```bash
nrdocs init \
  --docs-dir docs \
  --title "My Project Docs" \
  --requested-access password \
  --api-url https://docs.example.com/api
```

### Behavior

The command creates or updates:

```text
docs/
  nrdocs.yml
  index.md
.github/workflows/nrdocs.yml
```

If files already exist, the CLI must not overwrite them silently. MVP behavior is deterministic:

- In interactive mode, prompt before replacing each existing generated file.
- In non-interactive mode, fail unless `--force` is provided.
- With `--force`, replace only files managed by nrdocs and never delete unrelated user files.

### Interactive prompts

When run interactively, ask for:

```text
Docs directory: docs
Site title: <repo name> Docs
API URL: <deployment API URL>
```

The default interactive flow must not ask for requested access. Effective access is operator-controlled, and asking for it in the happy path creates confusion.

Repo owners may provide an advisory access hint only through an explicit advanced flag or by editing `docs/nrdocs.yml` after initialization:

```bash
nrdocs init --requested-access password
```

The generated config should omit `requested_access` unless the flag is provided.

### Generated `docs/nrdocs.yml`

MVP example:

```yaml
site:
  title: My Project Docs

content:
  source_dir: .
  index: index.md
  nav: auto
```

The config must not contain operator secrets, publish tokens, passwords, or effective access policy.

### Generated GitHub workflow

The generated workflow is specified in `07-github-action-spec.md`.

The workflow must include:

```yaml
permissions:
  contents: read
  id-token: write
```

### Success output

Example:

```text
nrdocs initialized.

Created:
  docs/nrdocs.yml
  docs/index.md
  .github/workflows/nrdocs.yml

Next steps:
  git add docs .github/workflows/nrdocs.yml
  git commit -m "Add nrdocs"
  git push

After push, docs artifacts will be uploaded. They will not be visible until approved by an operator or matched by an auto-approval rule.
```

### Exit codes

| Code | Meaning |
|---:|---|
| 0 | Initialized successfully |
| 1 | Generic failure |
| 2 | Invalid options |
| 3 | Refused to overwrite existing files |

## Command: `nrdocs publish`

### Purpose

Build/package docs and upload generated artifacts to nrdocs.

This command is intended to run in GitHub Actions.

### Audience

Repo owner automation.

### Usage

```bash
nrdocs publish
```

Optional flags:

```bash
nrdocs publish \
  --docs-dir docs \
  --config docs/nrdocs.yml \
  --api-url https://docs.example.com/api
```

### Required context

The command must run inside GitHub Actions for OIDC-based publishing.

If not running inside GitHub Actions, it must fail unless a future explicitly supported local-auth mode is implemented.

### Behavior

The command:

1. Reads `docs/nrdocs.yml`.
2. Validates repo config.
3. Builds or renders docs according to MVP content rules.
4. Packages the static output.
5. Requests a GitHub OIDC token.
6. Calls the publish API endpoint.
7. Prints the returned status.

### Publish identity

The CLI may send GitHub metadata for diagnostics, but the server must derive authoritative repo identity from the verified OIDC token.

### Pending approval is success

If upload succeeds but repo is pending approval, the command exits with code `0`.

Example output:

```text
Docs uploaded successfully.

Repo: noam-r/repoA
Build: ready
Approval: pending
Access: not visible
URL: https://docs.example.com/noam-r/repoA/

An operator must approve this repo before the docs are visible.
```

### Auto-approved public output

```text
Docs uploaded successfully.

Repo: noam-r/repoA
Build: ready
Approval: approved by auto-approval rule noam-r/*
Access: public
URL: https://docs.example.com/noam-r/repoA/
```

### Auto-approved password output

```text
Docs uploaded successfully.

Repo: noam-r/repoA
Build: ready
Approval: approved by auto-approval rule noam-r/*
Access: password
URL: https://docs.example.com/noam-r/repoA/
```

### Failure conditions

`nrdocs publish` should fail only for real publish problems, such as:

- invalid config;
- docs build/render failure;
- GitHub OIDC token unavailable;
- OIDC verification rejected by server;
- upload failure;
- API unavailable;
- artifact too large;
- unsupported file type or path traversal attempt.

It must not fail because a repo is pending approval.

### Exit codes

| Code | Meaning |
|---:|---|
| 0 | Artifact uploaded; status returned, including pending approval |
| 1 | Generic failure |
| 2 | Invalid CLI options |
| 10 | Invalid repo config |
| 11 | Build/render failure |
| 12 | OIDC token unavailable |
| 13 | Publish API authentication rejected |
| 14 | Upload failed |
| 15 | Artifact validation failed |
| 16 | Repo disabled by operator; publish rejected |

## Command: `nrdocs status OWNER/REPO`

### Purpose

Show operator-visible status for a known repo.

### Audience

Operator.

### Usage

```bash
nrdocs status owner/repo
```

### Behavior

Calls:

```text
GET /api/repos/:owner/:repo
```

MVP status requires operator authentication. Do not implement unauthenticated local repo-owner status in MVP because it can leak pending/private repo existence. Repo owners receive publish status through the GitHub Action summary.

### Output example

```text
Repo: noam-r/repoA
Latest build: ready
Approval: pending
Access: none
Serving: not visible
Next: approve
URL: https://docs.example.com/noam-r/repoA/
```

## Command: `nrdocs doctor`

### Purpose

Diagnose local repo setup and deployment connectivity.

### Audience

Repo owner and operator.

### Usage

```bash
nrdocs doctor
```

### Checks

Repo-owner checks:

- current directory is a git repo;
- `docs/nrdocs.yml` exists;
- workflow exists;
- API URL configured;
- docs source files exist;
- config is valid.

GitHub Action checks, when running in CI:

- OIDC environment variables exist;
- `id-token: write` appears to be available;
- required GitHub metadata variables exist.

Operator checks run when an operator token is available (via `NRDOCS_OPERATOR_TOKEN` env var, `--token` flag, or `--operator` flag):

- API reachable;
- operator token accepted;
- D1/R2 health endpoint passes, if implemented.

The `--operator` flag explicitly enables operator checks even if the token is provided via `--token` rather than the environment variable.

### Output

Use checkmarks for human output but keep JSON stable under `--json`.

## Command: `nrdocs repos`

### Purpose

List known repos and their serving state.

### Audience

Operator.

### Usage

```bash
nrdocs repos
```

Optional filters:

```bash
nrdocs repos --pending
nrdocs repos --approved
nrdocs repos --disabled
nrdocs repos --owner noam-r
nrdocs repos --json
```

### Auth

Requires operator connection settings resolved from flags, environment variables, or local config profile.

### Output example

```text
Repo             Build   Approval  Access    Serving       URL
noam-r/repoA      ready   pending   none      not visible   https://docs.example.com/noam-r/repoA/
noam-r/repoB      ready   approved  password  protected     https://docs.example.com/noam-r/repoB/
noam-r/repoC      failed  pending   none      not visible   https://docs.example.com/noam-r/repoC/
```

## Command: `nrdocs approve`

### Purpose

Approve a repo for serving with an explicit access mode.

### Audience

Operator.

### Usage

```bash
nrdocs approve owner/repo --access password
nrdocs approve owner/repo --access public
```

### Required access flag

`--access` is required.

There must be no default access mode for manual approval.

This prevents accidental public exposure.

### Behavior

Calls:

```text
POST /api/repos/:owner/:repo/approve
```

Request:

```json
{
  "access_mode": "password"
}
```

### Password mode warning

If approving with password access but no password credential exists, the CLI should show:

```text
Approved with password access, but no password is configured yet.
Set one with:
  nrdocs password set owner/repo

Until then, the site is not readable by docs users.
```

The exact serving behavior is defined in the API/security specs.

### Output

```text
Approved noam-r/repoA with password access.
URL: https://docs.example.com/noam-r/repoA/
```

## Command: `nrdocs disable`

### Purpose

Disable serving for a repo.

### Audience

Operator.

### Usage

```bash
nrdocs disable owner/repo
```

Optional:

```bash
nrdocs disable owner/repo --reason "No longer maintained"
```

### Behavior

Disabling must stop serving immediately. It must not delete artifacts by default.

Calls:

```text
POST /api/repos/:owner/:repo/disable
```

### Output

```text
Disabled noam-r/repoA.
Existing artifacts were retained but are no longer served.
```

## Command: `nrdocs access set`

### Purpose

Change effective access mode for an approved repo.

### Audience

Operator.

### Usage

```bash
nrdocs access set owner/repo password
nrdocs access set owner/repo public
```

### Behavior

Calls:

```text
POST /api/repos/:owner/:repo/access
```

Changing access is metadata-only and must not require a rebuild or GitHub push.

### Safety requirement

Changing to public should require explicit typed access mode:

```bash
nrdocs access set noam-r/repoA public
```

Do not support a short alias that could be accidental, such as:

```bash
nrdocs public noam-r/repoA
```

## Command: `nrdocs password set`

### Purpose

Set or rotate the password for password-protected docs.

### Audience

Operator.

### Usage

```bash
nrdocs password set owner/repo
```

Optional non-interactive mode:

```bash
nrdocs password set owner/repo --from-stdin
```

### Behavior

Interactive mode prompts without echo:

```text
New password:
Confirm password:
```

The CLI sends the password to the Worker API over HTTPS. The Worker hashes it before storage.

The CLI must never print the password.

### Output

```text
Password updated for noam-r/repoA.
```

## Command: `nrdocs rules list`

### Purpose

List auto-approval rules.

### Audience

Operator.

### Usage

```bash
nrdocs rules list
```

### Output

```text
ID   Match             Access    Enabled
1    noam-r/*          password  yes
2    noam-r/public     public    yes
```

## Command: `nrdocs rules add`

### Purpose

Add an auto-approval rule.

### Audience

Operator.

### Usage

```bash
nrdocs rules add 'noam-r/*' --access password
nrdocs rules add 'noam-r/public-docs' --access public
```

### Required access flag

`--access` is required.

There must be no implicit default for newly created auto-approval rules.

### Match syntax

MVP match syntax:

```text
owner/*
owner/repo
```

No arbitrary regular expressions in MVP.

### Behavior

Rules apply to future publishes by default. They are evaluated against existing pending repos only when the operator passes:

```bash
--apply-existing
```

Without `--apply-existing`, adding a rule should not silently approve existing pending repos.

This avoids accidentally making previously uploaded artifacts visible.

### Output

```text
Added auto-approval rule:
  match: noam-r/*
  access: password

This rule applies to future publishes.
```

With `--apply-existing`:

```text
Added auto-approval rule:
  match: noam-r/*
  access: password

Applied to existing pending repos:
  noam-r/repoA
  noam-r/repoB

2 repos need passwords before serving:
  nrdocs password set noam-r/repoA
  nrdocs password set noam-r/repoB
```

When `--apply-existing` is used with `--access password`, matching repos are approved into `needs_password` state. The CLI must clearly list repos that need passwords configured before they become readable.

## Command: `nrdocs rules remove`

### Purpose

Remove or disable an auto-approval rule.

### Audience

Operator.

### Usage

```bash
nrdocs rules remove RULE_ID
```

### Behavior

Removing a rule does not automatically disable repos already approved by that rule.

The CLI should say this explicitly:

```text
Rule removed.
Repos previously approved by this rule remain approved.
Use nrdocs disable owner/repo to disable a repo.
```

## Command: `nrdocs audit`

### Purpose

Show operator/security relevant audit events.

### Audience

Operator.

### Usage

```bash
nrdocs audit
nrdocs audit owner/repo
```

### Output example

```text
Time                 Actor        Action              Target
2026-05-07 12:10Z    github       publish_uploaded    noam-r/repoA
2026-05-07 12:14Z    operator     repo_approved       noam-r/repoA
2026-05-07 12:15Z    operator     password_updated    noam-r/repoA
```

## JSON output requirements

When `--json` is provided:

- output must be valid JSON;
- no progress bars or human text may be mixed into stdout;
- warnings may go to stderr, but structured warnings are preferred in JSON;
- field names must use snake_case.

Example:

```json
{
  "repo": {
    "full_name": "noam-r/repoA",
    "github_repository_id": "123456789"
  },
  "build": {
    "status": "ready",
    "git_sha": "abc123"
  },
  "approval_state": "pending",
  "access_mode": "none",
  "serving": {
    "status": "not_visible",
    "url": "https://docs.example.com/noam-r/repoA/"
  }
}
```

## Logging and privacy

The CLI must not log:

- operator tokens;
- passwords;
- GitHub OIDC tokens;
- signed upload URLs, if used;
- cookie/session secrets.

Verbose/debug logging may include:

- API endpoint host;
- repo full name;
- HTTP status codes;
- build ID;
- non-secret config paths.

## Command: `nrdocs deploy`

### Purpose

Deploy or update the nrdocs Cloudflare infrastructure.

This is the supported MVP deployment path. Manual Wrangler use is an advanced/debugging escape hatch only.

### Audience

Operator.

### Usage

```bash
nrdocs deploy
```

Non-interactive mode:

```bash
nrdocs deploy \
  --instance prod \
  --account-id CLOUDFLARE_ACCOUNT_ID \
  --zone-id CLOUDFLARE_ZONE_ID \
  --base-url https://docs.example.com \
  --static-dir ./instance-static \
  --operator-token-env NRDOCS_OPERATOR_TOKEN \
  --non-interactive \
  --no-save-profile
```

Dry-run mode:

```bash
nrdocs deploy --dry-run
```

### Required Inputs

The deploy command needs these values:

```text
Instance name (used to derive all resource names)
Cloudflare account
Docs base URL / route
Cloudflare zone/domain
Operator token
Instance static files
```

All Cloudflare resource names are derived from the instance name using the `nrdocs-{instance}` prefix convention:

```text
Worker:   nrdocs-{instance}
D1:       nrdocs-{instance}-db
R2:       nrdocs-{instance}-artifacts
```

### Interactive Behavior

When run interactively (default), the CLI prompts for missing values:

```text
Instance name? [default]
Cloudflare account? [select from wrangler login/accounts]
Docs base URL? [https://docs.example.com]
Cloudflare zone/domain? [example.com]
Use bundled default homepage/static files? [Y/n]
Generate operator token? [Y/n]
```

Instance name validation:
- Lowercase alphanumeric + hyphens only
- 1–20 characters
- Cannot start or end with a hyphen

On first deploy, the CLI checks that the instance name is not already in use on the Cloudflare account. If `nrdocs-{instance}-db` already exists and this is not a re-deploy from a matching profile, the CLI fails with a clear error.

The CLI should generate a strong operator token by default, display it once to the operator, and store only the token as a Worker secret. The operator is responsible for saving the token securely.

### Non-Interactive Behavior

With `--non-interactive`:

```text
- Never prompt.
- Fail with a clear error if any required value cannot be derived from flags or environment.
```

### Dry-Run Behavior

With `--dry-run`:

```text
- Print planned Cloudflare resources and config changes.
- Do not create, modify, or deploy anything.
```

### Idempotency

`nrdocs deploy` must be idempotent and safe to re-run.

Re-running must:

```text
- Reuse existing R2 bucket if present.
- Reuse existing D1 database if present.
- Apply pending migrations only.
- Update Worker code/config.
- Update static defaults only if requested.
- Preserve existing operator-managed data.
- Preserve existing repos, builds, rules, passwords, and audit logs.
```

Re-running must not:

```text
- Delete or reset existing data.
- Regenerate the operator token unless explicitly requested.
- Remove repos, builds, or rules.
```

### Profile Saving

After a successful deployment, `nrdocs deploy` saves a local CLI profile by default unless `--no-save-profile` is passed.

By default it saves:

```text
- api_url
- generated or provided operator_token
- deployment_name
```

Rules:

```text
- --save-profile is true by default for interactive local deploys.
- In --non-interactive mode, --save-profile defaults to false unless explicitly set.
- --no-save-profile skips local profile creation entirely.
- --profile <name> saves to a named profile instead of default.
```

### Deploy Steps

The command performs these steps in order:

```text
1. Authenticate with Cloudflare (via wrangler login or API token).
2. Create or verify R2 bucket exists.
3. Create or verify D1 database exists.
4. Apply pending D1 migrations.
5. Configure Worker environment variables and secrets.
6. Deploy Worker code.
7. Install bundled default instance static files (homepage, favicon, robots.txt).
8. Run health check against deployed Worker.
```

### Implementation

MVP uses Wrangler under the hood.

The CLI may invoke Wrangler commands internally. The standard installation path must not require users to manually run Wrangler commands.

### Output

Example first deploy:

```text
Instance: default
Resources:
  Worker:   nrdocs-default
  D1:       nrdocs-default-db
  R2:       nrdocs-default-artifacts

✅ R2 bucket nrdocs-default-artifacts created
✅ D1 database nrdocs-default-db created
✅ Applied 3 migrations
✅ Worker nrdocs-default deployed
✅ Static files installed
✅ Health check passed

Operator token (save this, it will not be shown again):
  nrdocs_op_a1b2c3d4e5f6...

Operator profile saved: ~/.config/nrdocs/config.json

Deployment complete.
API: https://docs.example.com/api
Docs: https://docs.example.com/

Next:
  nrdocs rules add OWNER/* --access password
  nrdocs repos
```

Example re-deploy:

```text
✅ R2 bucket nrdocs-default-artifacts exists, reusing
✅ D1 database nrdocs-default-db exists, applying 2 pending migrations
✅ Worker nrdocs-default updated
✅ Static files unchanged
✅ Health check passed
```

### Exit Codes

| Code | Meaning |
|---:|---|
| 0 | Deploy succeeded |
| 1 | Generic failure |
| 2 | Invalid options or missing required values |
| 3 | Cloudflare authentication failure |
| 4 | Resource creation or migration failure |
| 5 | Health check failed after deploy |

### Destructive Operations

`nrdocs deploy` must never perform destructive operations such as:

```text
- Dropping D1 tables
- Deleting R2 bucket contents
- Resetting operator tokens without explicit request
- Removing existing repos or builds
```

Destructive operations, if ever needed, must require a separate explicit command.

## Command: `nrdocs static list`

### Purpose

List current instance static files.

### Audience

Operator.

### Usage

```bash
nrdocs static list
```

### Output

```text
Type          Path                  Source
homepage      /                     bundled default
favicon       /favicon.ico          bundled default
robots        /robots.txt           bundled default
```

## Command: `nrdocs static set`

### Purpose

Replace an instance static file with a custom version.

### Audience

Operator.

### Usage

```bash
nrdocs static set homepage ./my-homepage.html
nrdocs static set favicon ./my-favicon.ico
nrdocs static set robots ./my-robots.txt
```

### Behavior

Uploads the specified file to replace the current instance static file of that type. Takes effect immediately.

## Command: `nrdocs static remove`

### Purpose

Remove a custom instance static file and revert to the bundled default.

### Audience

Operator.

### Usage

```bash
nrdocs static remove homepage
```

### Behavior

Reverts the specified static file type to the bundled default. Takes effect immediately.

## Command: `nrdocs auth login`

### Purpose

Store operator credentials in the local CLI config.

### Audience

Operator.

### Usage

```bash
nrdocs auth login
nrdocs auth login --api-url https://docs.example.com
nrdocs auth login --api-url https://docs.example.com --token nrdocs_op_...
nrdocs auth login --profile staging
```

### Behavior

Interactive mode:

```text
1. Prompt for API URL if not provided via flag or env.
2. Prompt for operator token if not provided via flag or env.
3. Validate credentials by calling GET /api/operator/me.
4. Save profile to local config if validation succeeds.
5. Fail with clear error if validation fails.
```

### Output

```text
✅ Authenticated

Profile saved: default
API URL: https://docs.example.com
```

### Exit Codes

| Code | Meaning |
|---:|---|
| 0 | Login succeeded, profile saved |
| 1 | Generic failure |
| 3 | Authentication validation failed |

## Command: `nrdocs auth status`

### Purpose

Show current CLI auth/profile state.

### Audience

Operator.

### Usage

```bash
nrdocs auth status
nrdocs auth status --profile staging
```

### Behavior

Shows the current profile configuration and validates connectivity.

Must never print the operator token.

### Output

```text
Profile: default
API URL: https://docs.example.com
Operator token: configured
Health check: passed
```

### Exit Codes

| Code | Meaning |
|---:|---|
| 0 | Profile exists and is valid |
| 1 | Profile exists but health check failed |
| 2 | No profile configured |

## Command: `nrdocs auth logout`

### Purpose

Remove the operator token from the selected profile.

### Audience

Operator.

### Usage

```bash
nrdocs auth logout
nrdocs auth logout --profile staging
```

### Output

```text
✅ Removed operator credentials from profile: default
```

## Command: `nrdocs config show`

### Purpose

Show the current local config with secrets redacted.

### Audience

Operator.

### Usage

```bash
nrdocs config show
nrdocs config show --profile staging
```

### Output

```json
{
  "default_profile": "default",
  "profiles": {
    "default": {
      "api_url": "https://docs.example.com",
      "operator_token": "***",
      "deployment_name": "nrdocs"
    }
  }
}
```

## Command: `nrdocs profiles list`

### Purpose

List local profiles.

### Audience

Operator.

### Usage

```bash
nrdocs profiles list
```

### Output

```text
Name       API URL                        Default
default    https://docs.example.com       yes
staging    https://staging.example.com    no
```

## Command: `nrdocs profiles use`

### Purpose

Set the default profile.

### Audience

Operator.

### Usage

```bash
nrdocs profiles use staging
```

### Output

```text
Default profile set to: staging
```

## Command: `nrdocs profiles remove`

### Purpose

Remove a profile after confirmation.

### Audience

Operator.

### Usage

```bash
nrdocs profiles remove staging
```

### Behavior

Prompts for confirmation in interactive mode. Fails in non-interactive mode unless `--yes` is passed.

## Non-goals for MVP CLI

The MVP CLI does not provide:

- a web UI;
- GitHub OAuth login for repo owners;
- direct D1/R2 access;
- multi-tenant org management;
- custom domain management;
- repo-owner self-approval;
- local publish from a developer laptop.

