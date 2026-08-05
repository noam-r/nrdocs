# Release process (nrdocs 2.0)

## Release candidate

`pnpm verify` is the local release-candidate gate:

1. format, lint, typecheck, unit/integration tests
2. release bundling (Worker + Mermaid + self-contained CLI)
3. local e2e smoke + unit coverage for deploy/R2/reader maturity
4. `pack:check` — clean install of the tarball outside the monorepo

## Disposable Cloudflare suite (required before tag)

```bash
pnpm --filter nrdocs run bundle:release   # if packaged/ is missing
export CLOUDFLARE_API_TOKEN=…             # must verify as a valid API token
export CLOUDFLARE_ACCOUNT_ID=…            # optional if exactly one account
pnpm test:e2e:cloudflare
```

The suite creates uniquely scoped D1/R2/Worker resources, applies migrations,
uploads the packaged Worker (including rate-limit bindings and platform assets),
smokes the origin when reachable, then deletes the resources.

If `CLOUDFLARE_API_TOKEN` is missing or invalid, the suite skips (does not fail
CI). **Tagging `v2.0.0` requires a non-skipped green run.**

## Tagging `v2.0.0`

1. `pnpm verify` green on Linux and macOS CI
2. `pnpm test:e2e:cloudflare` green with a valid token (not skipped)
3. Security and dependency reviews have no open release blockers
4. Annotate tag `v2.0.0` and publish the `nrdocs` package from the release unit
