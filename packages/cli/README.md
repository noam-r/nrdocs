# nrdocs

Publish a Markdown directory as a protected Cloudflare minisite. Git is never
required and is never part of site identity.

## Requirements

- Node.js 24+ (Linux or macOS; Windows is not supported)
- A Cloudflare account for `nrdocs deploy` and site administration

## Install

```bash
npm install -g nrdocs
# or use a project-local install
npm install nrdocs
```

The published package is one release unit: CLI, Worker, D1 migrations, renderer,
schemas, and fixed reader assets ship together. The CLI never downloads a
separate Worker or migration version at runtime.

## Quick start

From this monorepo (after `pnpm install` and a release build), put `nrdocs` on
your PATH once:

```bash
nvm use 24
pnpm --filter nrdocs run bundle:release
pnpm --dir packages/cli link --global
nrdocs --help
```

Rebuild with `pnpm --filter nrdocs run bundle:release` when sources change; the
global link keeps pointing at this workspace package.

Clean install path (same as CI `pack:check`):

```bash
pnpm --filter nrdocs run pack:check   # builds + packs + verifies --help in a temp dir
```

Operator flow (interactive TTY required for deploy, first admin publish, site, and connect):

```bash
# Credentials: ~/.nrdocs/cloudflare.env (mode 0600) — see ../../RELEASE.md
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

nrdocs deploy --new
# Creates a new Cloudflare instance. Later upgrades use: nrdocs deploy
#   Instance name (label only)
#   Publish location [1] workers.dev (shows exact origin) or [2] custom domain
#   For [2]: lists Cloudflare zones → pick zone → enter hostname → confirm
# Sites will be at: <origin>/<slug>/

mkdir demo && cd demo && printf '# Hello\n\n' > index.md
nrdocs publish
# First run on this machine: pick or create a site, then publish.
# No Server URL or publishing token prompt.
```

Remote publisher (token issued by an administrator):

```bash
nrdocs connect
nrdocs publish
```

Public site URL: `https://<origin>/<slug>/`.

Non-interactive custom domain (skips the location menu):

```bash
nrdocs deploy --new --domain docs.example.com
```

(`--domain` only with `--new`; changing domain later is out of scope.)

## Commands

Publisher:

- `nrdocs connect [directory]` — bind a directory to a site with a publishing token (remote publishers)
- `nrdocs publish [directory] [--force]` — render and promote; on the admin machine, first run also binds a site
- `nrdocs preview [directory]` — local loopback preview without Cloudflare
- `nrdocs generate nav [directory]` — write `nrdocs.yml` navigation
- `nrdocs credentials list|remove` — manage local publisher credentials

Administration:

- `nrdocs deploy` — upgrade the selected instance; `nrdocs deploy --new` provisions a new one
- `nrdocs instance list|show|use|delete` — select or tear down local instance descriptors
  (`delete` removes owned Worker + D1 + R2 after exact instance-ID confirmation)
- `nrdocs site …` — create, list, access mode, password, enable/disable, rename, delete
  (slugs are lowercase letters, digits, and hyphens; uppercase is stored lowercase)
- `nrdocs token …` — issue, list, revoke publishing tokens

CI publication uses environment credentials (`NRDOCS_URL` + `NRDOCS_TOKEN`).
See the repository specifications for exact names.

## Reader access

Public sites are reachable at `https://<origin>/<slug>/`. Password sites prompt
at `/_nrdocs/access` and set a site-scoped `__Host-nrdocs-s-<site-id>` session
cookie. Logout posts to `/_nrdocs/logout`.

## Troubleshooting

- **Windows:** nrdocs exits at startup; use Linux or macOS.
- **Credential permissions:** `~/.config/nrdocs` must be `0700` and credential
  files `0600` on supported platforms.
- **Deploy auth:** set `CLOUDFLARE_API_TOKEN`, or run `wrangler login`.
- **Stale local pointers:** after `site delete` or rename, reconnect publishers.

## Limitations

- No Windows support.
- Disposable Cloudflare end-to-end journeys are opt-in (see repository
  `tests/e2e` and `RELEASE.md`); tagging `v2.0.0` requires that suite.
- This package does not include a hosted control plane.

## Specifications

Normative behavior is defined under `nrdocs-specs/` in the source repository.
