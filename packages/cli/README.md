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

```bash
# 1. Deploy an instance (interactive; uses CLOUDFLARE_API_TOKEN or wrangler login)
nrdocs deploy

# 2. Create a site
nrdocs site create handbook

# 3. In a Markdown directory
nrdocs connect
nrdocs publish
nrdocs preview
```

## Commands

Publisher:

- `nrdocs connect [directory]` — bind a directory to a site and store a credential
- `nrdocs publish [directory]` — render, upload, and promote the current artifact
- `nrdocs preview [directory]` — local loopback preview without Cloudflare
- `nrdocs generate nav [directory]` — write `nrdocs.yml` navigation
- `nrdocs credentials list|remove` — manage local publisher credentials

Administration:

- `nrdocs deploy` — provision or reconcile a Cloudflare instance
- `nrdocs instance list|show|use` — select among local instance descriptors
- `nrdocs site …` — create, list, access mode, password, enable/disable, rename, delete
- `nrdocs token …` — issue, list, revoke publishing tokens

CI publication uses environment credentials (`NRDOCS_SITE_ID` + `NRDOCS_PUBLISHING_TOKEN`
or the documented pair). See the repository specifications for exact names.

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
