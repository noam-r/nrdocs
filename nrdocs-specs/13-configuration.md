# nrdocs Configuration

## Purpose

This document defines all configuration surfaces in nrdocs and clarifies who controls each setting.

nrdocs has three configuration layers:

1. Repo configuration, owned by the repo owner.
2. Deployment configuration, owned by the operator.
3. Runtime secrets/environment, owned by the operator or GitHub Actions runtime.

The most important rule is:

> Repo configuration may request behavior, but operator configuration determines visibility and access.

## Configuration Ownership

| Configuration area | Owner | Can affect visibility? | Can affect access mode? |
|---|---|---:|---:|
| Repo config | Repo owner | No | No, advisory only |
| Generated GitHub Action | Repo owner/CLI | No | No |
| Operator deployment config | Operator | Yes | Yes |
| Auto-approval rules | Operator | Yes | Yes |
| Password credentials | Operator | Yes | Yes |
| Operator tokens | Operator | Yes | Yes |

## Local CLI Configuration

The operator CLI uses local per-user configuration for normal usage.

This config is separate from:

```text
- Repo config: docs/nrdocs.yml
- Deployment/Worker config: wrangler.toml, Worker secrets
- D1/R2 state: repos, builds, rules, passwords, audit logs
```

Local CLI config stores user-specific connection details:

```text
- API URL
- Operator token
- Default profile name
```

### Config path

```text
Linux/macOS: $XDG_CONFIG_HOME/nrdocs/config.json or ~/.config/nrdocs/config.json
Windows: %APPDATA%\nrdocs\config.json
```

### Security

The local config file contains sensitive operator credentials. It must be created with restrictive permissions where supported (0700 directory, 0600 file on Unix).

The CLI must never print operator tokens in normal output after initial creation.

Future versions may support OS keychain integration.

### Resolution layers

Operator CLI connection resolution:

```text
1. CLI flags
2. Environment variables
3. Local CLI config profile
4. Interactive prompt (deploy/auth commands only)
```

Product configuration layers (separate concern):

```text
- Repo config (docs/nrdocs.yml)
- Deployment config (wrangler.toml, Worker env)
- Worker secrets (operator token, session secret)
- D1 state (repos, builds, rules, passwords, audit)
```

## Repo Configuration

Repo configuration lives in the docs source directory.

Default path:

```text
docs/nrdocs.yml
```

The file is created by:

```bash
nrdocs init
```

### Minimal Repo Config

```yaml
site:
  title: My Project Docs
```

### Full MVP Repo Config

```yaml
site:
  title: My Project Docs
  description: Documentation for My Project
  requested_access: password

content:
  source_dir: .
  index: index.md
  nav: auto
```

Because the config file itself lives in `docs/`, `content.source_dir: .` means the docs directory.

## Repo Config Schema

### `site.title`

Type: string  
Required: yes

Human-readable docs title.

Example:

```yaml
site:
  title: API Docs
```

Validation:

1. Must be non-empty.
2. Maximum 120 characters.
3. Must not contain control characters.

### `site.description`

Type: string  
Required: no

Short human-readable description.

Validation:

1. Maximum 300 characters.
2. Must not contain control characters.

### `site.requested_access`

Type: enum  
Required: no  
Allowed values:

```text
public
password
```

This is advisory only.

The operator-controlled effective access mode always wins.

Example:

```yaml
site:
  requested_access: public
```

This must not make docs public by itself.

### `content.source_dir`

Type: string  
Required: no  
Default: `.`

Directory containing Markdown content, relative to the config file.

Validation:

1. Must be a relative path.
2. Must not escape the repository root.
3. Must not contain `..` path traversal segments after normalization.

### `content.index`

Type: string  
Required: no  
Default: `index.md`

Markdown file used as the docs home page.

Validation:

1. Must be relative to `content.source_dir`.
2. Must end in `.md` or `.mdx` only if MDX is later supported. MVP supports `.md`.
3. Must exist during build.

### `content.nav`

Type: string or list  
Required: no  
Default: `auto`

MVP allowed value:

```yaml
content:
  nav: auto
```

MVP supports optional explicit nav with a simple list:

```yaml
content:
  nav:
    - title: Home
      path: index.md
    - title: Guide
      path: guide.md
```

If explicit nav is implemented, validation must ensure every listed file exists and stays inside the content directory.

## Repo Config Non-Goals for MVP

Repo config must not support these in MVP:

```text
custom domains
custom public slugs
operator approval
password values
password hashes
security headers
redirect rules
arbitrary response headers
raw Worker behavior
R2 key configuration
D1 table names
Cloudflare account configuration
```

These are operator/platform concerns.

## Generated GitHub Action Configuration

`nrdocs init` creates:

```text
.github/workflows/nrdocs.yml
```

The generated workflow must include:

```yaml
permissions:
  contents: read
  id-token: write
```

The workflow calls:

```bash
nrdocs publish
```

The repo owner should not need to configure repo secrets for MVP publish authentication.

### Required GitHub Action Environment

The generated workflow may set:

```yaml
env:
  NRDOCS_API_URL: https://docs.example.com/api
```

`NRDOCS_API_URL` identifies the nrdocs Worker API.

It is not a secret.

### Disallowed GitHub Action Secrets for MVP

MVP must not require:

```text
NRDOCS_PUBLISH_TOKEN
NRDOCS_REPO_ID
NRDOCS_PROJECT_ID
NRDOCS_PASSWORD
```

Publishing identity is derived from GitHub OIDC.

## Operator Deployment Configuration

Operator deployment configuration controls deployment-wide defaults.

It may live in one or more of:

```text
wrangler.toml
operator config file
D1-stored settings
Cloudflare environment variables
```

The exact storage may vary, but the behavior must match this spec.

### Required Deployment Settings

```yaml
base_url: https://docs.example.com
api_url: https://docs.example.com/api

defaults:
  approval: manual
  access: none
  pending_response: 404
```

### `base_url`

The public docs base URL.

Example:

```yaml
base_url: https://docs.example.com
```

Used to construct default repo URLs:

```text
https://docs.example.com/<owner>/<repo>/
```

### `api_url`

The Worker API base URL.

Example:

```yaml
api_url: https://docs.example.com/api
```

Used by CLI and GitHub Action.

### `defaults.approval`

Allowed MVP value:

```text
manual
```

Manual means newly discovered repos are pending unless an auto-approval rule matches.

### `defaults.access`

Allowed protected-first default:

```text
none
```

This ensures repos are never public by default.

### `defaults.pending_response`

Allowed MVP value:

```text
404
```

Anonymous readers must receive 404 for pending repos.

## Auto-Approval Rules

Auto-approval rules are operator-controlled.

They may be stored in D1 and managed through CLI/API.

Example:

```yaml
auto_approval:
  rules:
    - match: noam-r/*
      access: password
    - match: noam-r/public-docs
      access: public
```

### Rule Fields

| Field | Required | Description |
|---|---:|---|
| `match` | yes | GitHub repo pattern. |
| `access` | yes | Effective access mode if matched. |
| `enabled` | no | Defaults to true. |

### Match Pattern Rules

Allowed forms:

```text
OWNER/*
OWNER/REPO
```

Examples:

```text
noam-r/*
noam-r/repoA
my-company/docs
```

Disallowed examples:

```text
*/repoA
*
OWNER/**
https://github.com/OWNER/REPO
OWNER/REPO/path
```

### Rule Evaluation

Rules must be evaluated deterministically.

Recommended precedence:

1. Exact repo match: `OWNER/REPO`
2. Namespace match: `OWNER/*`
3. No match: manual pending

If multiple rules with the same precedence match, the newest rule must not silently override the older rule. The API should reject conflicting duplicates unless priority is explicitly supported.

### Auto-Approval Effect

A matching rule may set:

```text
approval_state = approved
access_mode = rule.access
```

It must not grant any other privileges.

It must not allow repo config to choose a more permissive access mode.

## Password Configuration

Password credentials are operator-controlled.

MVP CLI:

```bash
nrdocs password set OWNER/REPO
```

Passwords must not be stored in repo config.

Passwords must not be committed to GitHub.

Passwords must be stored only as hashes using Web Crypto PBKDF2-HMAC-SHA-256 with per-password random salt, deployment-configured iteration count (default 100,000), and password version metadata.

### Password Policy

MVP default password policy:

```text
Minimum length: 8 characters
Maximum length: 128 characters
Complexity requirements: none
```

The password policy is deployment-configurable. The API must reject passwords that do not meet the configured policy with error code `invalid_password_policy`.

Recommended behavior:

```text
password plaintext accepted once by operator CLI
operator CLI sends password over HTTPS to Worker API
Worker hashes the password with PBKDF2-HMAC-SHA-256 and stores only the derived hash, salt, iteration count, and password version metadata
D1 stores only the password hash and metadata
```

The system must never return plaintext passwords via API.

## Operator Authentication Configuration

Operator API calls require operator authentication.

MVP uses exactly one static operator token configured as a Cloudflare Worker secret.

Required properties:

1. Tokens are not stored in repo config.
2. Tokens are not exposed to GitHub Actions.
3. Tokens are not logged.
4. Token rotation is performed by updating the Worker secret and redeploying or updating the deployment environment.
5. Failed operator auth attempts are audit-logged.

Environment variables may include:

```text
NRDOCS_OPERATOR_TOKEN
```

This may be used by the local operator CLI only.

## Cloudflare Environment Configuration

The Worker deployment needs bindings for:

```text
D1 database
R2 bucket
operator token Worker secret
GitHub OIDC verification configuration
base URL
```

Example conceptual config:

```toml
name = "nrdocs"
main = "src/worker.ts"
compatibility_date = "2026-05-07"

[[d1_databases]]
binding = "DB"
database_name = "nrdocs"

[[r2_buckets]]
binding = "ARTIFACTS"
bucket_name = "nrdocs-artifacts"

[vars]
BASE_URL = "https://docs.example.com"
PENDING_RESPONSE = "404"
```

Secrets must be configured using Cloudflare secret mechanisms, not plaintext config files.

## Configuration Validation

The implementation must validate configuration at the boundary where it is read.

Validation points:

1. `nrdocs init` validates user input before writing files.
2. `nrdocs publish` validates repo config before building/uploading.
3. Worker API validates all request bodies.
4. Worker startup or deployment checks validate required bindings.
5. Operator commands validate arguments before calling API.

Invalid configuration should fail with clear errors and stable error codes from `12-error-handling-and-statuses.md`.

## Safe Defaults

MVP defaults must be:

```yaml
defaults:
  approval: manual
  access: none
  pending_response: 404
  raw_html: false
  custom_slugs: false
  custom_domains: false
  repo_owner_passwords: false
```

Public access must never be a fallback.

## Configuration Examples

### Private-by-Default Company Deployment

```yaml
base_url: https://docs.example.com

defaults:
  approval: manual
  access: none

auto_approval:
  rules:
    - match: my-company/*
      access: password
```

All company repos are auto-approved behind password protection.

### Explicit Public Repo Only

```yaml
base_url: https://docs.example.com

defaults:
  approval: manual
  access: none

auto_approval:
  rules:
    - match: my-company/public-docs
      access: public
```

Only `my-company/public-docs` is public automatically.

### Fully Manual Deployment

```yaml
base_url: https://docs.example.com

defaults:
  approval: manual
  access: none

auto_approval:
  rules: []
```

Every repo requires manual approval.

## Implementation Notes

1. Keep repo config small.
2. Never trust repo config for security decisions.
3. Keep operator config explicit.
4. Make unsafe behavior impossible by default.
5. Prefer D1-managed runtime policy for rules that operators change frequently.
