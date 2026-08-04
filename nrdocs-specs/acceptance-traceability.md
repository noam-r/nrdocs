# Acceptance traceability matrix

Maps numbered acceptance criteria from the normative specifications to automated
tests. A criterion is covered when at least one automated test exercises the
behavior; recorded results are the latest green `pnpm verify` / CI run.

| Spec                                                        | Criterion                                                                                  | Automated coverage |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------ |
| `00` Product AC 1–3 (Markdown → minisite, no Git identity)  | `packages/cli/src/connect-publish.test.ts`, `packages/renderer/src/*`                      |
| `00` Product AC 4–5 (preview / connect)                     | `packages/cli/src/preview.test.ts`, `connect-publish.test.ts`                              |
| `00` Product AC 6–8 (admin / tokens / access)               | `packages/cli/src/admin.test.ts`                                                           |
| `00` Product AC 9–10 (reader public/password)               | `packages/worker/src/reader.test.ts`                                                       |
| `04` Data-model AC (access/password/session_generation)     | `packages/persistence/src/index.test.ts`, `admin.test.ts`, `reader.test.ts`                |
| `04` Promotion / lock / deletion invariants                 | `packages/persistence/src/index.test.ts`, `packages/worker/src/publish.test.ts`            |
| `05` Publisher API AC (target, publish, idempotent, errors) | `packages/worker/src/publish.test.ts`                                                      |
| `05` Reader route AC (root, slug, 404 matrix, attachments)  | `packages/worker/src/reader.test.ts`                                                       |
| `05` Artifact / manifest contract                           | `packages/contracts/src/index.test.ts`, `packages/renderer/src/*`, `validate-page.test.ts` |
| `07` Token / password / session / CSRF / rate limits        | `admin.test.ts` (verifiers), `reader.test.ts` (session/CSRF/rate limit)                    |
| `07` Windows rejection / credential modes                   | `packages/cli/src/index.test.ts`                                                           |
| `08` Deploy / reconcile / empty-directory                   | `packages/cli/src/deploy.test.ts`                                                          |
| `08` Packaged release unit (Worker + migrations + assets)   | `packages/cli/scripts/pack-check.mjs` via `pnpm verify`                                    |
| `09` Stored-page schema                                     | `packages/worker/src/validate-page.test.ts`                                                |
| `09` Platform pages / headers / password UX                 | `packages/worker/src/reader.test.ts`                                                       |
| Journeys 12/13/21 (reader access)                           | `reader.test.ts`                                                                           |
| CI / non-Git publication                                    | `connect-publish.test.ts` (env credential paths)                                           |

Gaps intentionally deferred to the disposable Cloudflare suite (`RELEASE.md`):

- Live multi-instance selection against real Cloudflare resources
- Live custom-domain attachment and smoke against workers.dev
- Cross-machine packed-CLI runs beyond CI Linux/macOS matrices
