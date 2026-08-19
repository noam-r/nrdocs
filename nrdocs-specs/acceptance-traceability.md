# Acceptance traceability matrix

Maps numbered acceptance criteria from the normative specifications to automated
tests. A criterion is covered when at least one automated test exercises the
behavior. Recorded results: latest green `pnpm verify` on this branch.

| Spec |    # | Criterion (summary)                                    | Automated coverage                                             |
| ---- | ---: | ------------------------------------------------------ | -------------------------------------------------------------- |
| `00` |    1 | Directory Markdown → protected minisite                | `connect-publish.test.ts`, renderer tests                      |
| `00` |    2 | No Git identity / provider coupling                    | `connect-publish.test.ts`, CLI argv/runtime                    |
| `00` |    3 | One current artifact                                   | `publish.test.ts`, persistence promote                         |
| `00` |    4 | Local preview without Cloudflare                       | `preview.test.ts`                                              |
| `00` |    5 | Connect + credential store                             | `connect-publish.test.ts`, `index.test.ts`                     |
| `00` |  6–8 | Site/token/access administration                       | `admin.test.ts`                                                |
| `00` | 9–10 | Public and password reader access                      | `reader.test.ts`                                               |
| `04` | 1–10 | Access/password/session/promotion/deletion invariants  | `persistence/index.test.ts`, `admin.test.ts`, `reader.test.ts` |
| `05` | 1–13 | Publisher API, artifact, reader routes                 | `publish.test.ts`, `reader.test.ts`, contracts/renderer        |
| `07` |  1–8 | Tokens, PBKDF2, sessions, CSRF, rate limits, redaction | `admin.test.ts`, `reader.test.ts`, `rate-limit.test.ts`        |
| `07` |    — | Windows rejection; credential modes                    | `index.test.ts`, `tests/e2e/smoke.test.ts`                     |
| `08` |  1–9 | Deploy, reconcile, ownership, packaged unit            | `deploy.test.ts`, `pack:check`, `tests/e2e/smoke.test.ts`      |
| `08` |    — | Live disposable provision/smoke/cleanup                | `tests/e2e/cloudflare.test.ts` (`pnpm test:e2e:cloudflare`)    |
| `09` |  1–4 | Page schema, highlight, Mermaid, shell                 | `validate-page.test.ts`, renderer, `reader.test.ts`            |
| `09` |  5–7 | Routes, headers, storage inconsistency                 | `reader.test.ts`                                               |
| `09` |    — | Logout GET form + Sign out control                     | `reader.test.ts`, platform `reader.js`                         |
| `05` |    — | Artifact schema v2 + agent routes                      | `packages/worker/src/agent.test.ts`, renderer Markdown tests   |
| `09` |    — | Copy-prompt dialog; v1 assets unchanged                | `share-ui.test.ts`, `platform-assets.ts`                       |
| `07` |    — | Agent grants, CSRF, rate limits, grant redaction       | `grant.test.ts`, `agent.test.ts`, `rate-limit.ts`              |

## Release gate

| Gate                  | Command / artifact                                                |
| --------------------- | ----------------------------------------------------------------- |
| Local RC              | `pnpm verify`                                                     |
| Disposable Cloudflare | `pnpm test:e2e:cloudflare` with `~/.nrdocs/cloudflare.env` or env |
| Tag                   | `v2.0.0` only after both green (`RELEASE.md`)                     |
