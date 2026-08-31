# nrdocs 2.0 Specification Bundle

## Start Here

This bundle is the implementation source of truth for the clean nrdocs 2.0
build in the existing `noam-r/nrdocs` repository.

1. Read [`11-readiness-assessment.md`](./11-readiness-assessment.md) for the
   go/no-go judgment and correct starting action for the Markdown minisite
   core.
2. Use [`06-implementation-plan.md`](./06-implementation-plan.md) as the coding
   agent's phase-by-phase procedure for that core.
3. Give the agent every normative document named by the current phase and
   require that phase's tests and exit gate.
4. Run Phase 0A before changing the active repository. Continue to Phase 0 only
   if the disposable Cloudflare gate passes.
5. For the additive OpenAPI reference capability, read
   [`12-openapi-reference-extension.md`](./12-openapi-reference-extension.md)
   and [`13-openapi-extension-readiness.md`](./13-openapi-extension-readiness.md).
   Do not start OpenAPI application code until that readiness gate and a
   schema-v3 security review pass.

## Document Map

| Document                                       | Role                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `00-product-brief.md`                          | Product scope and non-goals                                        |
| `01-user-journeys-and-lifecycle.md`            | Administrator, publisher, and reader flows                         |
| `02-cli-configuration-and-credentials.md`      | Commands, `nrdocs.yml`, local stores, and happy path               |
| `03-system-architecture.md`                    | Components, authority, storage, and failure boundaries             |
| `04-data-model-and-state-invariants.md`        | D1 schema and atomic state rules                                   |
| `05-publication-api-and-artifact-lifecycle.md` | Publisher protocol, artifact schema, promotion, and routes         |
| `06-implementation-plan.md`                    | Repository strategy, phases, tests, gates, and Cursor procedure    |
| `07-security-and-resource-limits.md`           | Tokens, passwords, sessions, CSRF, limits, locks, and redaction    |
| `08-cloudflare-deployment-and-operations.md`   | Cloudflare auth, permissions, deploy, reconcile, and custom domain |
| `09-fixed-reader-and-serving.md`               | Framework-free reader UI, HTML schema, HTTP behavior, and headers  |
| `10-spec-gap-closure.md`                       | Non-normative response to all 47 pushback items                    |
| `11-readiness-assessment.md`                   | Final implementation-readiness judgment (core 2.0)                 |
| `12-openapi-reference-extension.md`            | Additive OpenAPI reference capability (normative)                  |
| `13-openapi-extension-readiness.md`            | OpenAPI extension readiness and pre-code gates                     |
| `acceptance-traceability.md`                   | Acceptance criteria → automated tests                              |

Documents 00–09 and 12 are normative. Documents 10–11, 13, the acceptance
matrix, and this index explain and verify the normative set; they do not
override it.

## Locked Scope Reminder

nrdocs publishes and serves Markdown notebooks/minisites. An optional `api`
block may add a generated OpenAPI reference inside the same minisite. It does
not require a Git repository, manage versions, preserve publication history,
accept arbitrary web applications, expose an administrator API, or adopt
shadcn/ui or another UI framework. A publisher's directory is the publication
unit; Git remains an optional user-owned versioning tool.
