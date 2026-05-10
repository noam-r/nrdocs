# 16 — Spec Readiness Audit

This audit evaluates whether the nrdocs specification set is ready to hand to a coding LLM or implementation agent.

Read this audit together with [`17-implementation-decision-register.md`](./17-implementation-decision-register.md). The decision register is the short authoritative source of truth; this audit verifies that the detailed specs align with it.

## Audit Standard

A spec set is considered ready for implementation only if:

1. Every MVP behavior has one selected behavior.
2. There are no unresolved MVP alternatives such as “Model A or Model B”.
3. Every security boundary is explicit.
4. Every user-visible happy path is specified.
5. Every state transition has an expected outcome.
6. API/CLI behavior is specific enough that a coding agent does not need to invent product semantics.
7. Old decisions are removed or clearly marked as future work.
8. The test plan covers protected-first behavior, routing, content rendering, asset validation, and operator workflows.

## Readiness Verdict

**Status: ready for implementation after this audit pass.**

This audit found several residual contradictions and ambiguous MVP choices. They were fixed in the spec files during this pass and recorded below.

Current blocker count after fixes:

```text
critical blockers: 0
major blockers:    0
minor blockers:    0
watch items:       3
```

The remaining watch items are non-blocking and are listed near the end of this file.

## Requirements Traceability Matrix

| Requirement | Authoritative Decision | Detailed Coverage | Status |
|---|---|---|---|
| Protected-first by default | No repo is visible until operator policy allows it | `01`, `02`, `05`, `08`, `12`, `15`, `17` | pass |
| Repo owner cannot grant visibility | Repo owner uploads artifacts only | `00`, `01`, `02`, `05`, `08`, `17` | pass |
| Serverless-only | No persistent server, builds run in GitHub Actions | `00`, `01`, `03`, `07`, `14`, `17` | pass |
| `nrdocs deploy` MVP path | Supported operator deployment path | `06`, `11`, `13`, `14`, `17` | pass |
| Manual Wrangler not happy path | Advanced/debugging only | `11`, `17` | pass |
| OIDC publish auth | Repo identity derived from verified GitHub OIDC claims | `05`, `07`, `08`, `15`, `17` | pass |
| Pre-approval rules | `OWNER/*` and `OWNER/REPO` rules allowed | `04`, `05`, `06`, `11`, `13`, `15`, `17` | pass |
| No fake approved repo rows | Pre-approval represented as rules, not unverified repo rows | `04`, `11`, `17` | pass |
| Disabled repo rejects publish | Reject before artifact validation/storage | `05`, `07`, `11`, `12`, `15`, `17` | pass |
| Approval/access metadata-only | No rebuild or repush needed | `01`, `03`, `04`, `05`, `11`, `17` | pass |
| Password flow | Operator-managed password; `needs_password` if missing | `02`, `04`, `05`, `06`, `11`, `12`, `15`, `17` | pass |
| Password hashing | PBKDF2-HMAC-SHA-256 with salt/iterations/version | `05`, `08`, `13`, `17` | pass |
| Operator auth | Single Worker-secret operator token | `04`, `05`, `06`, `08`, `13`, `17` | pass |
| Rendering model | CLI Markdown renderer only | `07`, `10`, `14`, `15`, `17` | pass |
| Raw HTML disabled | Escape raw HTML; no repo-provided JavaScript | `01`, `08`, `10`, `14`, `15`, `17` | pass |
| Media/assets | Local assets inside docs root; external references allowed with notices | `01`, `06`, `07`, `08`, `09`, `10`, `12`, `13`, `15`, `17` | pass |
| SVG handling | SVG allowed with protective headers | `08`, `09`, `15`, `17` | pass |
| Upload protocol | Single-request Worker upload, default 50 MB limit | `05`, `09`, `13`, `15`, `17` | pass |
| Canonical routing | Directory-style clean URLs and redirect variants | `09`, `10`, `12`, `15`, `17` | pass |
| Canonical HTML links | Generated pages include canonical link element | `10`, `15`, `17` | pass |
| Instance static files | Homepage, favicon, robots, `.well-known/*` | `03`, `05`, `06`, `09`, `11`, `13`, `14`, `15`, `17` | pass |
| Repo-owner status | GitHub Action summary only in MVP | `02`, `07`, `12`, `17` | pass |
| Operator status | `nrdocs repos`, `nrdocs status OWNER/REPO` | `06`, `11`, `12`, `17` | pass |
| Test coverage | Access matrix, routing, assets, auth, rendering | `15`, `17` | pass |
| Operator CLI uses local config by default | `nrdocs deploy` and `nrdocs auth login` save local profile | `06`, `11`, `13`, `14`, `15`, `17` | pass |
| Env vars remain supported as overrides | Flags → env → config resolution chain | `06`, `11`, `13`, `15` | pass |
| `nrdocs deploy` saves local profile | Default behavior after successful interactive deploy | `06`, `11`, `14`, `15` | pass |
| Auth login validates token before saving | Calls `GET /api/operator/me` | `05`, `06`, `15` | pass |

## Contradiction and Ambiguity Scan

The audit explicitly searched for unresolved MVP alternatives and stale decisions. The following were found and fixed during this pass.

### Fixed: local repo-owner status ambiguity

Old issue:

```text
Local `nrdocs status` had an unspecified authentication model.
```

Resolution:

```text
MVP repo-owner status is GitHub Action summary only.
Operator status uses authenticated `nrdocs status OWNER/REPO`.
```

Updated files:

```text
02-user-flows.md
17-implementation-decision-register.md
```

### Fixed: disabled repo publish ambiguity

Old issue:

```text
One operator workflow section still allowed future publishes from disabled repos unless blocked by policy.
```

Resolution:

```text
Disabled repos reject publish before artifact validation or storage.
```

Updated files:

```text
11-operator-workflows.md
17-implementation-decision-register.md
```

### Fixed: operator token storage ambiguity

Old issue:

```text
Data model still listed `operator_tokens` as an MVP entity.
```

Resolution:

```text
MVP uses exactly one Worker-secret operator token. D1 operator token tables are future work.
```

Updated files:

```text
04-data-model.md
14-implementation-plan.md
17-implementation-decision-register.md
```

### Fixed: password hashing ambiguity

Old issue:

```text
Some specs referred to an “approved password hashing algorithm” or “final security design”.
```

Resolution:

```text
MVP uses Web Crypto PBKDF2-HMAC-SHA-256 with per-password salt, deployment-configured iterations, and password version metadata.
```

Updated files:

```text
05-api-spec.md
13-configuration.md
17-implementation-decision-register.md
```

### Fixed: rule retroactivity mismatch

Old issue:

```text
CLI supported `--apply-existing`, but API said retroactive rule application was future work.
```

Resolution:

```text
MVP API supports `apply_existing: false` by default. If true, evaluate matching existing pending repos with verified GitHub repository IDs. Disabled repos are never affected.
```

Updated files:

```text
05-api-spec.md
06-cli-spec.md
17-implementation-decision-register.md
```

### Fixed: repo rename routing ambiguity

Old issue:

```text
Old-path behavior after rename was deferred.
```

Resolution:

```text
MVP old owner/repo paths return 404. Repo aliases and old-path redirects are future work.
```

Updated files:

```text
02-user-flows.md
17-implementation-decision-register.md
```

### Fixed: repo-provided CSS ambiguity

Old issue:

```text
Repo-provided CSS was described as optional and not supported by default unless sanitized/limited.
```

Resolution:

```text
MVP uses platform-provided CSS only. Repo-provided CSS is future work.
```

Updated files:

```text
10-rendering-and-content-model.md
17-implementation-decision-register.md
```

### Fixed: explicit nav ambiguity

Old issue:

```text
Explicit navigation “may be supported”.
```

Resolution:

```text
MVP supports optional explicit navigation with a simple list; auto-discovery remains the default.
```

Updated files:

```text
10-rendering-and-content-model.md
13-configuration.md
17-implementation-decision-register.md
```

## MVP Decision Completeness Checklist

| Area | Question | Status |
|---|---|---|
| Deployment | Can an agent implement operator deployment without inventing Wrangler steps? | pass |
| CLI init | Can an agent implement prompts and generated files? | pass |
| GitHub Action | Can an agent generate the workflow and know when it succeeds/fails? | pass |
| Publish API | Can an agent authenticate, validate, store, and respond deterministically? | pass |
| Data model | Can an agent create tables/enums without inventing project concepts? | pass |
| Approval | Can an agent distinguish manual approval from pre-approval rules? | pass |
| Passwords | Can an agent implement password setup, hashing, sessions, and `needs_password`? | pass |
| Serving | Can an agent decide every anonymous request result? | pass |
| Routing | Can an agent canonicalize every page URL variant? | pass |
| Assets | Can an agent resolve `/assets/x.png` versus `../x.png` safely? | pass |
| External resources | Can an agent warn without blocking normal external links/images? | pass |
| Static files | Can an agent serve homepage/favicon/robots/.well-known? | pass |
| Security | Can an agent enforce no raw HTML/JS and private R2 only? | pass |
| Tests | Can an agent derive required test cases? | pass |

## Development Blocker Checklist

A coding agent must not begin implementation if any answer below is “no”.

| Check | Required Answer | Status |
|---|---|---|
| Is there exactly one MVP rendering model? | Yes: CLI Markdown renderer | pass |
| Is there exactly one MVP upload protocol? | Yes: single-request Worker upload | pass |
| Is there exactly one MVP operator auth model? | Yes: one Worker-secret token | pass |
| Is disabled publish behavior specified? | Yes: reject before storage | pass |
| Is pre-approval specified without fake repo rows? | Yes: rules only | pass |
| Is raw HTML policy specified? | Yes: escaped/disabled | pass |
| Is repo JS policy specified? | Yes: unsupported/rejected | pass |
| Is SVG behavior specified? | Yes: allowed with protective headers | pass |
| Is password hashing specified? | Yes: PBKDF2-HMAC-SHA-256 | pass |
| Are canonical routes specified? | Yes | pass |
| Are redirects gated behind access checks? | Yes | pass |
| Are instance static routes specified? | Yes | pass |
| Does approval require a new push? | No | pass |
| Can a repo become public by config? | No | pass |
| Are unknown/pending/disabled repos non-revealing? | Yes | pass |


## Post-Audit Validation Pass

A final validation pass against the generated files found and fixed four residual implementation ambiguities:

1. `02-user-flows.md` still showed password approval as two required commands. It now specifies that `nrdocs approve OWNER/REPO --access password` prompts for password setup when no credential exists, while `nrdocs password set OWNER/REPO` remains available for rotation.
2. `04-data-model.md` described repo rows as possibly preconfigured by an operator. It now states that repo rows require verified GitHub OIDC identity and that pre-approval uses rules, not fake repo rows.
3. `12-error-handling-and-statuses.md` still showed unauthenticated local `nrdocs status` output. It now states that repo-owner status is GitHub Action summary only, while `nrdocs status OWNER/REPO` is operator-authenticated.
4. `15-test-plan.md` still contained an alternative safe default for approval without access. It now requires validation failure and no state change.
5. `09-artifact-storage.md` now clarifies that `.css` and `.json` are allowed only for nrdocs-generated/platform-generated files, not arbitrary repo-provided artifacts.

After these fixes, the blocker count remains:

```text
critical blockers: 0
major blockers:    0
minor blockers:    0
```

## Watch Items

These are not blockers. They are intentional MVP simplifications or implementation risks to keep visible.

### Watch Item 1: PBKDF2 iteration count

The specs select PBKDF2-HMAC-SHA-256 for Cloudflare Worker compatibility. The default iteration count is 100,000. OWASP 2023 recommends 600,000 for PBKDF2-SHA256, but Cloudflare Workers have plan/runtime CPU constraints. Implementation must include an acceptance test measuring Worker CPU impact at the configured iteration count before raising the default. The value is deployment-configurable.

### Watch Item 2: Single-request upload limit

MVP upload is intentionally simple. The default max archive size is 50 MB. Larger docs sites will require future direct/multipart R2 upload support.

### Watch Item 3: Same-origin docs isolation

MVP disables raw HTML, repo JavaScript, and repo CSS to keep same-origin serving safe. If future versions allow active content, they must add subdomain isolation or equivalent browser isolation before enabling it.

## Final Implementation Guidance

A coding LLM should read files in this order:

```text
17-implementation-decision-register.md
01-non-negotiable-invariants.md
00-product-brief.md
02-user-flows.md
03-system-architecture.md
04-data-model.md
05-api-spec.md
06-cli-spec.md
07-github-action-spec.md
08-access-control-and-security.md
09-artifact-storage.md
10-rendering-and-content-model.md
11-operator-workflows.md
12-error-handling-and-statuses.md
13-configuration.md
14-implementation-plan.md
15-test-plan.md
16-spec-readiness-audit.md
```

The decision register wins over any apparent ambiguity. If an implementation discovers a contradiction not listed in this audit, development should pause and update the spec rather than guessing.
