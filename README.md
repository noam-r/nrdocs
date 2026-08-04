# nrdocs 2.0

Self-hosted publishing for a directory of Markdown as a protected Cloudflare
minisite. Git is never required and is never part of site identity.

## Status

Phases 1–12 of the implementation plan are complete on this branch. The package
is a **release candidate**: use `pnpm verify` locally; tag `v2.0.0` only after
the disposable Cloudflare suite in `RELEASE.md` passes.

## Install (published CLI)

```bash
npm install -g nrdocs
nrdocs --help
```

## Specifications

Start with [`nrdocs-specs/README.md`](./nrdocs-specs/README.md).

- [`11-readiness-assessment.md`](./nrdocs-specs/11-readiness-assessment.md) — go/no-go
- [`06-implementation-plan.md`](./nrdocs-specs/06-implementation-plan.md) — phases
- [`acceptance-traceability.md`](./nrdocs-specs/acceptance-traceability.md) — criteria → tests
- [`RELEASE.md`](./RELEASE.md) — RC and tagging process

## Workspace

| Package                | npm name              | Role                                 |
| ---------------------- | --------------------- | ------------------------------------ |
| `packages/contracts`   | `@nrdocs/contracts`   | Shared schemas (private)             |
| `packages/persistence` | `@nrdocs/persistence` | D1/R2 persistence model (private)    |
| `packages/renderer`    | `@nrdocs/renderer`    | Local Markdown render/pack (private) |
| `packages/worker`      | `@nrdocs/worker`      | Cloudflare Worker (private)          |
| `packages/cli`         | `nrdocs`              | Published CLI binary + release unit  |

The published `nrdocs` tarball inlines workspace packages and ships the Worker
module plus fixed platform assets under `packaged/`.

## Development

Requires Node.js 24+ and pnpm 10.12.4.

```bash
pnpm install
pnpm verify
```

`pnpm verify` runs format check, lint, build (including the release bundle),
typecheck, unit/integration tests, local e2e smoke, and package-content
verification (`npm pack` + clean install).

## Reviews

- [`docs/dependency-and-bundle-review.md`](./docs/dependency-and-bundle-review.md)
- [`docs/security-review.md`](./docs/security-review.md)

## Legacy 1.x

The final Git-coupled implementation is preserved as the annotated tag
`legacy-git-coupled-final`. It is not present in this working tree.
