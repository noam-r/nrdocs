# nrdocs 2.0 Spec-Gap Closure Index

## Status

Complete verification index. This document is non-normative: documents 00–09
remain the source of truth. It maps every item in the coding-agent pushback
report `spec-gaps.md` to the locked contract that closes it.

## Closure Standard

`Resolved` means an implementer can proceed without choosing product behavior.
A mandatory feasibility measurement or conformance test is not an open product
decision when the expected behavior and pass/fail response are already fixed.

## Blockers

| ID  | Status   | Resolution                                                                       | Canonical location                                                      |
| --- | -------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| S1  | Resolved | Exact 256-bit token syntax and SHA-256 verifier                                  | `07` / Publishing Tokens                                                |
| S2  | Resolved | Input policy and PBKDF2-HMAC-SHA-256 parameters                                  | `07` / Reader Passwords                                                 |
| S3  | Resolved | Signed payload, cookie, lifetime, and logout                                     | `07` / Reader Sessions                                                  |
| S4  | Resolved | Origin check, signed CSRF value, body and field bounds                           | `07` / Form and CSRF Protection                                         |
| S5  | Resolved | Per-operation 60-second limits and stable 429 behavior                           | `07` / Rate Limiting                                                    |
| S6  | Resolved | Numeric byte, count, path, ratio, duration, and concurrency limits               | `07` / Resource Limits                                                  |
| S7  | Resolved | 120-second lease, renewal threshold, ten-minute ceiling, reclaim and retry       | `07` / Publication Lock; `04` / Publication Concurrency                 |
| S10 | Resolved | Worker-only 32-byte secret, first-deploy creation, preservation, rotation effect | `07` / Reader Sessions; `08` / First Deployment Order                   |
| D1  | Resolved | API-token-first, bundled-Wrangler OAuth fallback, legacy-key rejection           | `08` / Cloudflare Authentication                                        |
| D2  | Resolved | Operation capability matrix and fail-before-mutation preflight                   | `08` / Required Cloudflare Authority                                    |
| D3  | Resolved | Random suffix and deterministic Worker, D1, and R2 names                         | `08` / Resource Identity                                                |
| D4  | Resolved | Create/resume distinction, ownership reconciliation, partial-failure state       | `08` / Command Semantics; Reconciliation and Upgrade                    |
| D6  | Resolved | Same bearer credential uses current R2 REST object APIs; no S3 secret            | `08` / Required Cloudflare Authority; Administration and Site Deletion  |
| V1  | Resolved | Complete DOM structure plus exact element and attribute allowlists               | `09` / Complete Page Skeleton; Stored-Document Allowlist                |
| V2  | Resolved | Stable schema-v1 asset paths and atomic Worker/static-asset deployment           | `09` / Versioned Platform Assets; `08` / First Deployment Order         |
| X1  | Resolved | Display name stored as metadata; opaque ID remains the only key                  | `00` / Instance; `02` / Instance Descriptor; `04` / `instance_metadata` |

## High Priority

| ID  | Status   | Resolution                                                                                                       | Canonical location                                                                                               |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| S8  | Resolved | Explicit field/body/query omission and token-pattern scrub                                                       | `07` / Logging and Error Redaction                                                                               |
| S9  | Resolved | Raw HTML, SVG, behavior-bearing assets, and permissive stored DOM rejected                                       | `02` / Published Page and Asset Selection; `07` / Content and Browser Boundary; `09` / Stored-Document Allowlist |
| D5  | Resolved | Exact hostname validation, same-account active zone, TLS wait, one origin                                        | `08` / Custom Domain                                                                                             |
| D7  | Resolved | One package release unit, forward-only 2.x migration, binding preservation                                       | `08` / Reconciliation and Upgrade                                                                                |
| V3  | Resolved | System/light/dark cycle and single local-storage key                                                             | `09` / Theme Behavior                                                                                            |
| V4  | Resolved | Site no-store; platform asset revalidation; no Cache API                                                         | `09` / Cache Behavior                                                                                            |
| V5  | Resolved | Exact CSP and browser response-header sets                                                                       | `09` / Security Headers                                                                                          |
| V6  | Resolved | Controlled 503, no stale fallback, safe correlation                                                              | `09` / Storage Inconsistency                                                                                     |
| V8  | Resolved | Total extension-to-MIME mapping aligned with the publication allowlist, plus attachment disposition sanitization | `02` / Published Page and Asset Selection; `09` / MIME and Attachment Rules                                      |
| V9  | Resolved | Decode, length, origin-path, segment, and fallback rules                                                         | `09` / Safe Return Path                                                                                          |
| V10 | Resolved | Mermaid 11.16.0, inert source, strict lazy render, fixed failure                                                 | `09` / Mermaid                                                                                                   |
| E3  | Resolved | Symlink and portable-case collision policy                                                                       | `02` / Filesystem Portability and Symbolic Links                                                                 |
| C2  | Resolved | Administrative mutations intentionally interactive; CI is publisher-only                                         | `02` / Administration Is Interactive; Destructive Confirmation                                                   |
| X2  | Resolved | Phase 0A validates the locked policy before repository replacement                                               | `08` / Feasibility Gate; `06` / Phase 0A                                                                         |
| P2  | Resolved | highlight.js 11.11.1, explicit grammar set and aliases, no detection                                             | `09` / Syntax Highlighting                                                                                       |

## Medium Priority

| ID  | Status   | Resolution                                                                      | Canonical location                                       |
| --- | -------- | ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| D8  | Resolved | Environment account pin or explicit choice; descriptor pins account; zone rules | `08` / Cloudflare Authentication; Custom Domain          |
| V7  | Resolved | Exact fixed copy for root, access, logout, 404, and 500/503                     | `09` / Fixed Platform Pages                              |
| E1  | Resolved | CommonMark/GFM boundary, soft breaks, and rejected extensions                   | `02` / Markdown Validation; `06` / Phase 4               |
| E2  | Resolved | UTF-8 and BOM behavior                                                          | `02` / Markdown Validation                               |
| E4  | Resolved | Shared page bound plus explicit navigation and title constraints                | `02` / Automatic Navigation; `07` / Resource Limits      |
| C1  | Resolved | Stable exit-code taxonomy and HTTP mapping                                      | `02` / Process Exit Codes                                |
| C3  | Resolved | Environment-backed connect, exact writes, and no prompt fallback                | `02` / Publisher Environment Variables; `nrdocs connect` |
| C4  | Resolved | Exact human TTL grammar and maximum lifetime                                    | `02` / Token Properties; `07` / Publishing Tokens        |
| C6  | Resolved | Node 24 on supported Linux/macOS only; Windows rejected                         | `02` / Supported Operating Systems                       |
| C7  | Resolved | Explicit API and artifact-schema negotiation                                    | `05` / Compatibility Rules                               |
| P1  | Resolved | Public `nrdocs` 2.0.0 package is one CLI/Worker/assets release unit             | `00` / Deployment Model                                  |
| P4  | Resolved | Server/D1 time is authoritative; exact expiry boundary                          | `04` / Time Rules; `07` / Publishing Tokens              |

## Low Priority

| ID  | Status   | Resolution                                                           | Canonical location                                                                                   |
| --- | -------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| E5  | Resolved | Published HTML receives exact locked language/direction tuple        | `02` / language and direction; `05` / Complete Page Document Contract; `09` / Complete Page Skeleton |
| C5  | Resolved | Loopback-only, deterministic 4173–4273 selection, no public fallback | `01` / Journey 7; `02` / `nrdocs preview`                                                            |
| P3  | Resolved | HEAD mirrors GET without body; ranges ignored with full 200          | `09` / Reader Routes and Canonicalization                                                            |
| P5  | Resolved | Successful-auth-only, best-effort, at most one write per 15 minutes  | `07` / Last-Used Metadata; `04` / Publishing Tokens                                                  |

## Result

All 47 reported items are resolved in the normative specification set. No item
is downgraded to an implementation guess. Phase 0A remains the single required
pre-code external-platform gate described by documents 06 and 08.
