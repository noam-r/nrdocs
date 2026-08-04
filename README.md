# nrdocs 2.0

Self-hosted publishing for a directory of Markdown as a protected Cloudflare
minisite. Git is never required and is never part of site identity.

## Status

This branch is the clean 2.0 bootstrap. Product commands are not implemented
yet. Implement against the locked specification set one phase at a time.

## Specifications

Start with [`nrdocs-specs-v2/README.md`](./nrdocs-specs-v2/README.md).

- [`11-readiness-assessment.md`](./nrdocs-specs-v2/11-readiness-assessment.md) — go/no-go
- [`06-implementation-plan.md`](./nrdocs-specs-v2/06-implementation-plan.md) — phases
- [`phase-0a-feasibility-report.md`](./nrdocs-specs-v2/phase-0a-feasibility-report.md) — Cloudflare gate

## Workspace

| Package                | npm name              | Role                                 |
| ---------------------- | --------------------- | ------------------------------------ |
| `packages/contracts`   | `@nrdocs/contracts`   | Shared schemas (private)             |
| `packages/persistence` | `@nrdocs/persistence` | D1/R2 persistence model (private)    |
| `packages/renderer`    | `@nrdocs/renderer`    | Local Markdown render/pack (private) |
| `packages/worker`      | `@nrdocs/worker`      | Cloudflare Worker (private)          |
| `packages/cli`         | `nrdocs`              | Published CLI binary                 |

## Development

Requires Node.js 24+ and pnpm 10.12.4.

```bash
pnpm install
pnpm verify
```

`pnpm verify` runs format check, lint, typecheck, unit tests, build, and a dry-run
pack of the public `nrdocs` package.

## Legacy 1.x

The final Git-coupled implementation is preserved as the annotated tag
`legacy-git-coupled-final`. It is not present in this working tree.
