# Release process (nrdocs 2.0)

## Release candidate

The `cursor/v2-bootstrap` branch (and subsequent mainline) produces installable
**release candidates** via `pnpm verify`, which includes:

1. format, lint, typecheck, unit/integration tests
2. release bundling of the Worker + self-contained CLI
3. local e2e smoke
4. `pack:check` — `npm pack`, clean install outside the repo, CLI startup, Worker
   and platform asset presence, no `workspace:` protocol

Package version remains `2.0.0` during the RC window. Do **not** create the
Git tag `v2.0.0` until the disposable Cloudflare suite passes.

## Disposable Cloudflare suite (opt-in)

Requires Cloudflare credentials and creates uniquely scoped resources with
bounded cleanup. Never targets an existing user instance.

```bash
export CLOUDFLARE_API_TOKEN=…
export CLOUDFLARE_ACCOUNT_ID=…   # optional if exactly one account
pnpm test:e2e:cloudflare
```

This workflow is intentionally separate from `pnpm verify`.

## Tagging `v2.0.0`

1. RC `pnpm verify` green on Linux and macOS CI
2. Disposable Cloudflare suite green
3. Security and dependency reviews have no open release blockers
4. Annotate tag `v2.0.0` and publish the `nrdocs` package from the release unit
