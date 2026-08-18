# nrdocs 2.0 Implementation Readiness Assessment

## Verdict

**Ready to start Phase 0A.** If Phase 0A passes, the project is ready for Phase
0 repository replacement and the ordered implementation phases. The
specification set contains no known unresolved product, command, security,
deployment, data, artifact, or reader-serving decision.

This is readiness to begin a controlled implementation, not a claim that all
external assumptions have already been proved or that the full product should
be built in one task.

## What Changed Since the Pushback

The pushback was valid: the earlier set described a strong architecture but
left production-critical decisions to future specifications. The revised set
now makes those decisions normative:

- `07-security-and-resource-limits.md` fixes token, password, session, CSRF,
  abuse, lock, secret-redaction, and numeric resource behavior.
- `08-cloudflare-deployment-and-operations.md` fixes authority discovery,
  permissions, resource names and ownership, first deploy, reconciliation,
  upgrade, R2 administration, and custom-domain behavior.
- `09-fixed-reader-and-serving.md` fixes the native framework-free UI, page DOM
  schema, assets, code highlighting, Mermaid, responsive interaction, routes,
  MIME, cache, headers, and storage failure behavior.
- Documents 00–06 now point to those contracts instead of deferring decisions.
- `10-spec-gap-closure.md` accounts for all 47 reported gaps.

## Gate Versus Gap

| Item                                                                                     | Classification               | Required response                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare API, permission, D1 transaction, R2 REST, Worker upload, and cleanup behavior | External feasibility gate    | Run Phase 0A in disposable resources; revise the spec if the platform contradicts it                                                |
| PBKDF2 cost under the selected Worker plan                                               | Performance conformance test | Workers reject PBKDF2 above 100,000 iterations; contract 07 was revised to 100,000 with a legacy `600000` verifier label |
| Streaming validation within Worker CPU, memory, and duration limits                      | Capacity conformance test    | Measure in Phase 0A and test every locked boundary in Phase 9                                                                       |
| Reader accessibility and Mermaid behavior under the fixed CSP                            | Browser conformance test     | Exercise the Phase 11 matrix; fix implementation bugs without changing the contract                                                 |
| Product behavior, public commands, formats, lifetimes, limits, and failure semantics     | Specified                    | Implement exactly; do not choose alternatives in code                                                                               |

The first three rows are empirical gates because platform behavior must be
measured. They are not missing design choices: the intended behavior and the
required reaction to a failed test are explicit.

## Start Sequence

1. Give the coding agent only Phase 0A plus documents 02, 03, 04, 05, 07, 08,
   and the Phase 0A section of document 06.
2. Authorize the exact disposable Cloudflare account, resource prefix, and
   creation/deletion scope. Do not authorize changes to the active repository.
3. Review the sanitized feasibility report against every Phase 0A exit gate.
4. If it passes, separately authorize Phase 0 to preserve the 1.x reference,
   replace the active tree, and scaffold 2.0.
5. Continue one implementation-plan phase per task and require the defined
   tests, diff inspection, and handoff report before proceeding.
6. If Phase 0A contradicts the contract, update the affected normative document
   first; do not let the implementation silently establish a new policy.

## Residual Risks

These are controlled implementation risks, not readiness blockers:

- Cloudflare may rename permissions or change endpoint details after this
  assessment; Phase 0A deliberately catches that before source replacement.
- PBKDF2 and archive validation may approach Worker CPU limits on the selected
  plan; the required benchmarks make the tradeoff visible before release.
- Complete DOM validation and deterministic Mermaid/highlighting fixtures are
  exacting; the plan isolates them in shared contracts and adversarial tests.
- A clean 2.0 replacement has normal schedule risk; the narrow no-history,
  no-repository, no-admin-API scope limits the number of durable concepts.

## Final Judgment

The plan is now good enough to build. Its strength is not exhaustive feature
coverage; it is a narrow product with explicit authority boundaries, one
publication path, one current artifact, one fixed reader, deterministic local
rendering, and no nrdocs-owned version-management system.

The correct next action is Phase 0A—not another product-question round and not a
blind rewrite.
