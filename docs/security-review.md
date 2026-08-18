# Security review (functional lock)

**Date:** 2026-08-04  
**Scope:** nrdocs 2.0 CLI + Worker after Phases 1–11 functional lock; packaging in Phase 12  
**Status:** No unresolved release blockers for RC. Re-validate after disposable Cloudflare suite.

## Threat model (summary)

| Asset            | Threat                             | Control                                                                |
| ---------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| Publishing token | Theft / reuse                      | Bearer only; SHA-256 verifier at rest; revoke/expire                   |
| Reader password  | Offline crack / online brute force | PBKDF2-SHA256 100k (Workers cap); dual rate limits before derive       |
| Reader session   | Cross-site reuse / CSRF            | Site-scoped `__Host-` cookie; generation counter; Origin+CSRF on POSTs |
| Artifacts        | Stale / orphan serve               | D1 current pointer only; 503 on inconsistency                          |
| Admin plane      | Unattended mutation                | Interactive TTY required; no Worker admin HTTP                         |
| Deploy authority | Over-broad token                   | Preflight capability checks before mutation                            |

## Findings

1. **Password rate limits before PBKDF2** — implemented and tested (`reader.test.ts`).
2. **Identical 404 for unknown/empty/disabled** — implemented and tested.
3. **Attachment disposition sanitization** — implemented (`headers.ts` / reader tests).
4. **Packed release unit** — Worker and platform assets ship with the CLI; no runtime
   download of alternate versions (`pack:check`).
5. **R2 list/delete via admin HTTP adapter** — implemented on the control-plane
   client and wired through `createR2ArtifactStoreFromControlPlane`.

## Residual risk / follow-ups

- Run `pnpm test:e2e:cloudflare` with credentials in `~/.nrdocs/cloudflare.env`
  (see `RELEASE.md`) before tagging `v2.0.0`.
- Confirm workers.dev reachability from the tagging environment.
