# Implementation Plan: Repo-Owner Self-Service Password

## Overview

Convert the design into incremental, dependency-aware coding tasks. The work breaks into nine groupings: (1) schema + types, (2) operator allow/disallow API + CLI, (3) rule self-password default flag, (4) publish-time password handling, (5) rule-driven stamping at auto-approval, (6) CLI publish env-var forwarding, (7) `init.ts` workflow template, (8) README updates, (9) version bump and verification. Each schema/type change lands before the handlers that use it; tests live next to (or immediately after) the implementation they cover, and each property test is its own sub-task that explicitly references the property number from `design.md`.

The implementation language is **TypeScript** (existing codebase). Property-based tests use **fast-check** with `numRuns: 100`. Worker and CLI tests use the existing **Vitest** harness.

## Tasks

- [x] 1. Schema and shared types
  - [x] 1.1 Create migration `packages/worker/migrations/0002_repo_owner_password_optin.sql`
    - Add `ALTER TABLE repos ADD COLUMN allow_repo_owner_password INTEGER NOT NULL DEFAULT 0;`
    - _Requirements: 1.1, 1.3, 1.5_

  - [x] 1.2 Create migration `packages/worker/migrations/0003_rule_self_password_default.sql`
    - Add `ALTER TABLE auto_approval_rules ADD COLUMN default_allow_repo_owner_password INTEGER NOT NULL DEFAULT 1;`
    - _Requirements: 11.11, 11.12_

  - [x] 1.3 Extend `RepoRecord` in `packages/shared/src/types.ts`
    - Add `allow_repo_owner_password: boolean`
    - Update existing `makeRepo` test helpers in `packages/worker/src/__tests__/{access-matrix,db,state-transitions}.test.ts` to populate the new field with `false`
    - _Requirements: 1.1, 1.2_

  - [x] 1.4 Extend `AutoApprovalRule` in `packages/shared/src/types.ts`
    - Add `default_allow_repo_owner_password: boolean`
    - Update existing `makeRule` test helpers in `packages/worker/src/__tests__/{access-matrix,db,state-transitions}.test.ts` to populate the new field with `true`
    - _Requirements: 11.7, 11.9_

  - [x] 1.5 Add `normalizeRepo` in `packages/worker/src/db/repos.ts`
    - Coerce `allow_repo_owner_password` from INTEGER 0/1 to JS boolean
    - Apply in `findRepoByFullName`, `findRepoByGithubId`, `listRepos`, `approveRepo`, `disableRepo`, `setAccessMode`, `upsertRepo`, `updateLatestBuild` returns
    - _Requirements: 1.2_

  - [x] 1.6 Add `normalizeRule` in `packages/worker/src/db/rules.ts`
    - Coerce `enabled` and `default_allow_repo_owner_password` from INTEGER 0/1 to JS boolean
    - Apply in `createRule`, `listRules`, `matchRules`
    - _Requirements: 11.7, 11.9_

  - [x] 1.7* Write integration test for migration 0002
    - File: `packages/worker/src/__tests__/migration-0002.test.ts`
    - Apply 0001+0002 against an in-memory SQLite instance pre-seeded with repo rows
    - Assert all existing rows have `allow_repo_owner_password = 0`
    - Assert re-applying 0002 fails with a `duplicate column name` error
    - _Requirements: 1.3, 1.5_

  - [x] 1.8* Write integration test for migration 0003
    - File: `packages/worker/src/__tests__/migration-0003.test.ts`
    - Apply 0001+0002+0003 against an in-memory SQLite instance pre-seeded with rule rows
    - Assert all existing rules have `default_allow_repo_owner_password = 1`
    - Assert no `repos` rows are modified by 0003 (R11.6 boundary check)
    - Assert re-applying 0003 fails with a `duplicate column name` error
    - _Requirements: 11.6, 11.11, 11.12_

- [x] 2. Operator allow/disallow API + CLI
  - [x] 2.1 Add `setSelfPasswordAllowFlag` DB helper in `packages/worker/src/db/repos.ts`
    - Update `repos.allow_repo_owner_password` and `updated_at` for a given `repo_id`
    - Bind `1` for true, `0` for false
    - _Requirements: 1.1, 2.1, 2.2_

  - [x] 2.2 Add `handleAllowSelfPassword` and `handleDisallowSelfPassword` handlers in `packages/worker/src/handlers/repos.ts`
    - Both gated by `requireOperator`; return 401 if missing/invalid Bearer
    - Return 404 `NOT_FOUND` for unknown repo
    - Call `setSelfPasswordAllowFlag` with the appropriate boolean
    - Write `repo.self_password_allowed` / `repo.self_password_disallowed` audit entry on each call (idempotent: write on every call)
    - Return updated `RepoRecord` in `jsonSuccess`
    - _Requirements: 1.4, 2.1, 2.2, 2.5, 2.8, 2.9_

  - [x] 2.3 Wire routes in `packages/worker/src/index.ts`
    - `POST /api/repos/:owner/:repo/allow-self-password` → `handleAllowSelfPassword`
    - `POST /api/repos/:owner/:repo/disallow-self-password` → `handleDisallowSelfPassword`
    - _Requirements: 2.1, 2.2_

  - [x] 2.4 Add `setSelfPasswordAllow` method on `ApiClient` in `packages/cli/src/api-client.ts`
    - Signature: `setSelfPasswordAllow(owner, repo, allow: boolean): Promise<ApiResponse>`
    - POST to `/allow-self-password` when allow=true, `/disallow-self-password` when allow=false
    - _Requirements: 2.1, 2.2_

  - [x] 2.5 Add `parsePasswordAllowArgs`, `parsePasswordDisallowArgs`, `handlePasswordAllow`, `handlePasswordDisallow` in `packages/cli/src/commands/password.ts`
    - Validate `OWNER/REPO` shape; exit 2 on malformed (R2.6)
    - Resolve credentials; exit 1 with login hint when missing (R2.7)
    - Call `client.setSelfPasswordAllow(...)`; on failure print server error and exit non-zero (R2.5)
    - On success print `Self-service password enabled for OWNER/REPO.` (or `disabled` for disallow)
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.7_

  - [x] 2.6 Extend dispatcher in `packages/cli/src/commands/index.ts`
    - Add `case 'allow':` and `case 'disallow':` under the existing `case 'password':` block
    - Existing `case 'set':` continues to work unchanged
    - Update `--help` text to list `password set | allow | disallow`
    - _Requirements: 2.3, 2.4_

  - [x] 2.7* Write Worker tests for allow/disallow handlers
    - File: `packages/worker/src/__tests__/repos-self-password.test.ts`
    - Cover: success paths for both endpoints, 401 on missing token, 404 on unknown repo, audit row written on each call (Property 3 - sequence of allow/disallow)
    - **Property 3: Operator allow/disallow idempotence and audit completeness** (fast-check, numRuns=100)
    - **Validates: Requirements 2.1, 2.2, 2.8, 2.9**
    - _Requirements: 1.4, 2.1, 2.2, 2.5, 2.8, 2.9_

  - [x] 2.8* Write CLI tests for `password allow` / `password disallow`
    - File: `packages/cli/src/__tests__/password-allow.test.ts`
    - Cover: parser success path, malformed-arg → exit 2, missing-credentials → exit 1, dispatcher routing for `allow|disallow|set|garbage`
    - _Requirements: 2.3, 2.5, 2.6, 2.7, 9.4_

- [x] 3. Checkpoint - Schema, types, and operator allow/disallow path
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Rule default flag (R11)
  - [x] 4.1 Extend `createRule` in `packages/worker/src/db/rules.ts`
    - Add `defaultAllowSelfPassword: boolean = true` parameter
    - Bind `1` or `0` into the `default_allow_repo_owner_password` column on INSERT
    - Return a `normalizeRule`-coerced `AutoApprovalRule`
    - _Requirements: 11.1, 11.7_

  - [x] 4.2 Extend `handleCreateRule` in `packages/worker/src/handlers/rules.ts`
    - Read optional `default_allow_repo_owner_password` from the request body
    - When omitted, default to `true` (R11.7)
    - When present and not boolean, return 400 `VALIDATION_ERROR` naming the field (R11.8)
    - Pass through to `createRule`
    - _Requirements: 11.7, 11.8_

  - [x] 4.3 Extend `addRule` in `packages/cli/src/api-client.ts`
    - Add optional `defaultAllowSelfPassword?: boolean` parameter
    - Forward as `default_allow_repo_owner_password` in the POST body when set
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 4.4 Extend `parseRulesAddArgs` in `packages/cli/src/commands/rules.ts`
    - Recognize `--self-set-password <value>`
    - Map `allow` → `'allow'`, `deny` → `'deny'`, anything else → sentinel `'__invalid__'` (kept pure for testability)
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 4.5 Extend `handleRulesAdd` in `packages/cli/src/commands/rules.ts`
    - When `selfSetPassword === '__invalid__'`, print `Error: --self-set-password must be "allow" or "deny".` and `process.exit(2)` (R11.4)
    - Compute `defaultAllowSelfPassword` (default `true`; `'allow'` → `true`; `'deny'` → `false`)
    - Pass to `client.addRule(..., applyExisting, defaultAllowSelfPassword)`
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 4.6 Extend `formatRulesTable` in `packages/cli/src/commands/rules.ts`
    - Insert `SELF-PWD` column between `ACCESS` and `ENABLED`
    - Render `allow` for `default_allow_repo_owner_password === true`, `deny` otherwise
    - _Requirements: 11.10_

  - [x] 4.7 Verify `handleListRules` returns the new field
    - Confirm `listRules` (via `normalizeRule`) populates `default_allow_repo_owner_password` on every returned rule (R11.9)
    - No code change expected if `normalizeRule` is correct; this task captures the assertion via the test in 4.8
    - _Requirements: 11.9_

  - [x] 4.8* Write CLI tests for `--self-set-password` parser and table column
    - File: `packages/cli/src/__tests__/rules-self-password-flag.test.ts`
    - `parseRulesAddArgs` cases: omitted → `selfSetPassword === undefined`; `--self-set-password allow` → `'allow'`; `--self-set-password deny` → `'deny'`; `--self-set-password garbage` → `'__invalid__'`
    - `handleRulesAdd` end-to-end with stubbed `ApiClient`: omitted → body has `default_allow_repo_owner_password: true`; `allow` → `true`; `deny` → `false`; `garbage` → `process.exit(2)` was called and no HTTP request issued
    - `formatRulesTable` cases: rule with `default_allow_repo_owner_password=true` shows `allow`; rule with `false` shows `deny`; column header is `SELF-PWD`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.10, 9.10_

  - [x] 4.9* Write Worker tests for `POST /api/auto-approval-rules` body validation
    - File: `packages/worker/src/__tests__/rules-self-password-default.test.ts` (shared with task 5.4)
    - Cases: omitted → rule persisted with `default_allow_repo_owner_password=true`; `true`/`false` boolean → persisted as supplied; non-boolean (string/number/null) → 400 `VALIDATION_ERROR` naming the field
    - Assert `GET /api/auto-approval-rules` returns the field for every rule (R11.9)
    - _Requirements: 11.1, 11.2, 11.3, 11.7, 11.8, 11.9_

- [x] 5. Rule-driven stamping at auto-approval (R11.5–R11.6, Property 8)
  - [x] 5.1 Extend `UpsertRepoInput` and `upsertRepo` in `packages/worker/src/db/repos.ts`
    - Add optional `allow_repo_owner_password?: boolean` to the input
    - INSERT branch: bind the supplied value (default `false`/`0` if undefined)
    - UPDATE branch: do NOT touch `allow_repo_owner_password` (R11.6)
    - _Requirements: 11.5, 11.6_

  - [x] 5.2 Modify `handlePublish` in `packages/worker/src/handlers/publish.ts` to capture the matched rule for new repos
    - Hoist the existing `const matchedRule = await matchRules(env.DB, fullName);` inside the allowlist short-circuit into a let `matchedRuleForNewRepo` visible at the upsertRepo call site
    - When `existingRepo` was non-null, leave `matchedRuleForNewRepo` as `null`
    - At the `upsertRepo` call, pass `allow_repo_owner_password: matchedRuleForNewRepo?.default_allow_repo_owner_password`
    - Do NOT change any other field on existing repos, regardless of any rule match
    - _Requirements: 11.5, 11.6_

  - [x] 5.3* Write Worker test for stamping with allow=true
    - File: `packages/worker/src/__tests__/rules-self-password-default.test.ts` (continued)
    - Setup: empty `repos` table, one rule R with `pattern='org/*'`, `default_allow_repo_owner_password=true`
    - Action: publish from `org/repo1` (new repo)
    - Assert: inserted repo row has `allow_repo_owner_password=true`
    - _Requirements: 11.5, 9.7_

  - [x] 5.4* Write Worker test for stamping with allow=false
    - File: `packages/worker/src/__tests__/rules-self-password-default.test.ts` (continued)
    - Setup: one rule R with `default_allow_repo_owner_password=false`
    - Action: publish from a new repo matching R
    - Assert: inserted repo row has `allow_repo_owner_password=false`
    - _Requirements: 11.5, 9.8_

  - [x] 5.5* Write Worker test for non-retroactivity of rule changes
    - File: `packages/worker/src/__tests__/rules-self-password-default.test.ts` (continued)
    - Setup: pre-seed one repo R1 with `allow_repo_owner_password=false`. Add a rule with pattern matching R1 and `default_allow_repo_owner_password=true`.
    - Action: publish from R1 (existing repo).
    - Assert: R1's `allow_repo_owner_password` is still `false` after the publish.
    - Repeat with `--apply-existing` flag set on the rule add path; assert still `false`.
    - _Requirements: 11.6, 9.9_

  - [x] 5.6* Write property test: rule-stamp biconditional
    - File: `packages/worker/src/__tests__/rules-self-password-default.test.ts` (continued)
    - **Property 8: Rule-stamp biconditional**
    - Use `fast-check` with `numRuns: 100`
    - Generators: arbitrary `default_allow_repo_owner_password ∈ {true, false}`, arbitrary new repo `full_name`s matching the rule's pattern
    - Assert: for every newly inserted repo row, `allow_repo_owner_password === rule.default_allow_repo_owner_password`
    - Assert symmetric clause: for any pre-existing repo, `allow_repo_owner_password` is unchanged after publish regardless of rule match
    - **Validates: Requirements 11.5, 11.6**
    - _Requirements: 11.5, 11.6_

- [x] 6. Checkpoint - Rules and rule stamping
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Publish-time password handling (R5, R6, Property 1, 4, 5, 6, 7)
  - [x] 7.1 Add `storeSelfServicePassword` helper in `packages/worker/src/db/passwords.ts` (or new `db/self-password.ts`)
    - Hash plaintext via existing `hashPassword`
    - Compute `nextPasswordVersion(db, repo.id)` (mirrors existing `setPassword`)
    - Build a single `db.batch([...])` with: deactivate prior active credential, insert new credential, insert `repo.self_password_set` audit row, conditionally `setAccessMode='password'` and audit `repo.access_changed` for `approved + access=none` matrix cell
    - Return `{ ok: true }` on success, `{ ok: false }` if any statement's `meta.error` is set or the batch throws
    - Never log plaintext, hash, or salt
    - _Requirements: 5.2, 5.5, 5.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 7.2 Insert step 15a in `handlePublish` (`packages/worker/src/handlers/publish.ts`)
    - After the `build.published` audit write and BEFORE the auto-approval rule evaluation block (existing step 14)
    - Read `formData.get('password')`. If a string:
      - Re-fetch the repo via `findRepoByGithubId` (picks up the just-stamped `allow_repo_owner_password` from task 5.2 on a brand-new auto-approval)
      - If `allow_repo_owner_password === true`:
        - If length out of `[DEFAULT_MIN_PASSWORD_LENGTH, DEFAULT_MAX_PASSWORD_LENGTH]`, return 400 `INVALID_PASSWORD` (R5.4)
        - Call `storeSelfServicePassword`; on `{ ok: false }` return 500 `AUDIT_WRITE_FAILED` (R5.9)
      - Else if `allow_repo_owner_password === false`:
        - Write `repo.self_password_ignored` audit event (no plaintext or hash in metadata, R5.6)
        - On audit write failure, return 500 `AUDIT_WRITE_FAILED` (R5.9)
    - Never write `passwordRaw` to logs, response body, or any non-D1 sink
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3_

  - [x] 7.3* Write Worker tests for the publish 4-cell matrix
    - File: `packages/worker/src/__tests__/publish-self-password.test.ts`
    - Cover R9.1 four-cell matrix: `{password field present, absent} × {allow flag true, false}`
    - Cover R6 access-mode interaction matrix (5 deterministic cells): `password`/`none`/`public`/`pending`/`disabled`
    - Cover R5.4 length-out-of-bounds → 400 `INVALID_PASSWORD`
    - Cover R5.9 audit-write failure (mock `db.batch` to reject) → 500 `AUDIT_WRITE_FAILED`
    - Cover R7.2 / R7.3 — REPO_NOT_ALLOWED and REPO_DISABLED short-circuits do not read the password field
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 9.1_

  - [x] 7.4* Write property test: round-trip via verifyPassword
    - File: `packages/worker/src/__tests__/publish-self-password.test.ts` (continued)
    - **Property 4: Self-service password round-trips through verifyPassword**
    - Use `fast-check` with `numRuns: 100`; generate strings in `[DEFAULT_MIN_PASSWORD_LENGTH, DEFAULT_MAX_PASSWORD_LENGTH]` over full Unicode
    - Setup: repo R with `allow_repo_owner_password=true`, `approval_state ∈ {approved, pending}`
    - Action: publish with `password=p`
    - Assert: `verifyPassword(p, getActivePassword(R))` returns `true`
    - **Validates: Requirements 5.2, 9.3**
    - _Requirements: 5.2, 9.3_

  - [x] 7.5* Write property test: ignore-audit row contains no password material
    - File: `packages/worker/src/__tests__/publish-self-password.test.ts` (continued)
    - **Property 5: Ignore audit row never contains plaintext or hash**
    - Use `fast-check` with `numRuns: 100`
    - Setup: repo R with `allow_repo_owner_password=false`
    - Action: publish with `password=p`
    - Assert: the resulting `repo.self_password_ignored` row's `metadata_json` contains neither `p` nor any hash of `p`
    - **Validates: Requirements 5.6**
    - _Requirements: 5.6_

  - [x] 7.6* Write property test: response indistinguishability when no password is sent
    - File: `packages/worker/src/__tests__/publish-self-password.test.ts` (continued)
    - **Property 6: Response indistinguishability when no password is sent**
    - Use `fast-check` with `numRuns: 100`; generate arbitrary valid metadata
    - Action: publish two requests with identical artifact + metadata + no `password` field, one to repo with `allow=true`, one with `allow=false`, both otherwise identical
    - Assert: response body bytes are byte-for-byte identical
    - **Validates: Requirements 5.7, 9.2**
    - _Requirements: 5.7, 9.2_

  - [x] 7.7* Write property test: response body never reveals password material
    - File: `packages/worker/src/__tests__/publish-self-password.test.ts` (continued)
    - **Property 7: Response body never reveals password material**
    - Use `fast-check` with `numRuns: 100`
    - Setup: repo R with `allow_repo_owner_password=true`
    - Action: publish with `password=p`
    - Assert: response body bytes do not contain `p`, the active credential's `password_hash`, or its `salt` as a substring
    - **Validates: Requirements 5.8**
    - _Requirements: 5.8_

- [x] 8. CLI publish env-var forwarding (R4, Property 1, 2)
  - [x] 8.1 Modify `handlePublish` in `packages/cli/src/commands/publish.ts`
    - After the existing `formData.append('artifact', ...)` and `formData.append('metadata', ...)`, conditionally append `password`:
      - `const docsPasswordRaw = process.env['NRDOCS_DOCS_PASSWORD'];`
      - `if (typeof docsPasswordRaw === 'string' && docsPasswordRaw.length > 0) formData.append('password', docsPasswordRaw);`
    - Do NOT log `docsPasswordRaw` at any verbosity
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 8.2* Write property test: publish multipart inclusion biconditional
    - File: `packages/cli/src/__tests__/publish-password-env.test.ts`
    - **Property 1: Publish multipart inclusion biconditional**
    - Use `fast-check` with `numRuns: 100`; generate `NRDOCS_DOCS_PASSWORD ∈ {undefined, "", arbitrary non-empty Unicode strings of length 1..512}`
    - Stub `ApiClient` to capture the FormData passed in the publish request
    - Assert: `password` field is present iff env var is a non-empty string; when present, value === env var byte-for-byte
    - **Validates: Requirements 4.1, 4.2, 9.5**
    - _Requirements: 4.1, 4.2, 9.5_

  - [x] 8.3* Write property test: no plaintext password in CLI output
    - File: `packages/cli/src/__tests__/publish-password-env.test.ts` (continued)
    - **Property 2: No plaintext password in CLI output**
    - Use `fast-check` with `numRuns: 100`
    - Stub `ApiClient` to return both `{ok:true}` and `{ok:false}` outcomes; capture stdout/stderr
    - Run with each verbosity flag combination
    - Assert: captured stdout and stderr never contain the password value as a substring
    - **Validates: Requirements 4.4, 4.5, 9.6**
    - _Requirements: 4.4, 4.5, 9.6_

- [x] 9. Workflow template change in `init.ts` (R3)
  - [x] 9.1 Update `generateWorkflowYml` in `packages/cli/src/commands/init.ts`
    - Add `NRDOCS_DOCS_PASSWORD: ${{ secrets.NRDOCS_DOCS_PASSWORD }}` to the `Publish docs` step's `env:` block, alongside the existing `NRDOCS_API_URL` entry
    - Preserve ordering of any other env entries
    - `--force` continues to overwrite the workflow file
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 9.2* Extend workflow template tests
    - File: `packages/cli/src/__tests__/init-workflow-template.test.ts` (existing — extend; create if absent)
    - Assert: generated YAML contains the literal `NRDOCS_DOCS_PASSWORD: ${{ secrets.NRDOCS_DOCS_PASSWORD }}` in the env block
    - Assert: generated YAML still contains the existing `NRDOCS_API_URL:` entry
    - Assert: `--force` overwrite produces a workflow file with the new env line
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 10. README updates (R8)
  - [x] 10.1 Add "Self-service docs passwords (operator opt-in)" section to `README.md`
    - Subsections per design §4: what it does, operator opt-in (`password allow`/`disallow`), repo owner secret setup, access-mode interaction matrix in plain language, behavior on non-opted-in repos, operator override (`password set`)
    - Document the `--self-set-password allow|deny` flag on `nrdocs rules add`, default `allow`, scope (only stamps NEW repos at auto-approval; never modifies existing rows; independent of `--apply-existing`)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 10.2* Add README assertion test
    - Extend an existing readme grep test or add to `packages/cli/src/__tests__/commands.test.ts`
    - Assert: README contains the expected headings, the `nrdocs password allow/disallow` example invocations, the `NRDOCS_DOCS_PASSWORD` secret instructions, and the `--self-set-password` flag documentation
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 11. Version bump and final verification (R10)
  - [x] 11.1 Bump CLI version in `packages/cli/package.json`
    - Increment to a new semantic version greater than the current value
    - _Requirements: 10.1, 10.2_

  - [x] 11.2 Final checkpoint - Ensure all tests pass
    - Run the full test suite (worker + cli + shared)
    - Verify `npm run build` completes for all workspaces
    - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Core implementation tasks are never optional.
- Each task references specific requirements via the `R<n>.<m>` notation already in the spec.
- Property tests use **fast-check** with `numRuns: 100` and live next to the implementation they validate.
- Schema and type changes (1.x) come before any handler/CLI code that depends on them.
- The auto-approval insert path change (5.2) reuses the existing `matchRules` call inside the allowlist short-circuit, so no extra D1 round-trip is added on the publish hot path.
- The publish-time password handler (7.2) re-fetches the repo after `upsertRepo` so a brand-new repo whose `allow_repo_owner_password` was just stamped by a rule (task 5.2) sees the correct flag value when deciding whether to store the password from the same publish.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["1.5", "1.6", "1.7", "1.8"] },
    { "id": 2, "tasks": ["2.1", "4.1", "5.1"] },
    { "id": 3, "tasks": ["2.2", "2.4", "4.2", "4.3", "4.6", "4.7"] },
    { "id": 4, "tasks": ["2.3", "2.5", "4.4"] },
    { "id": 5, "tasks": ["2.6", "4.5", "5.2"] },
    { "id": 6, "tasks": ["2.7", "2.8", "4.8", "4.9", "5.3", "5.4", "5.5", "5.6"] },
    { "id": 7, "tasks": ["7.1", "8.1", "9.1", "10.1"] },
    { "id": 8, "tasks": ["7.2"] },
    { "id": 9, "tasks": ["7.3", "7.4", "7.5", "7.6", "7.7", "8.2", "8.3", "9.2", "10.2"] },
    { "id": 10, "tasks": ["11.1"] }
  ]
}
```
