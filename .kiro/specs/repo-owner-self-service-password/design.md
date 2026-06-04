# Design Document

## Overview

This feature lets an operator opt a repository in to **self-service password management**. When a repo is opted in, the repo owner can store a password in a GitHub Actions Secret named `NRDOCS_DOCS_PASSWORD`. The publish workflow forwards that secret over TLS as part of the existing OIDC-authenticated `POST /api/publish` multipart request, and the Worker hashes and stores it on the repo's password credential record. Repos that are not opted in cause the field to be silently discarded so that a shared workflow template does not leak which repos are gated.

The change is intentionally minimal:
- One new column on `repos` (`allow_repo_owner_password`, default `false`).
- One new column on `auto_approval_rules` (`default_allow_repo_owner_password`, default `1`/true) so that adding a rule grants self-service password capability by default to NEW repos auto-approved by the rule, with an explicit per-rule override available via `--self-set-password allow|deny` on `nrdocs rules add`. Already-existing repo rows are NEVER retroactively modified by rule changes; the existing `--apply-existing` flag continues to control only `access_mode` propagation.
- Two new operator-only HTTP endpoints (`/allow-self-password` and `/disallow-self-password`), bound to two new CLI subcommands of the existing `nrdocs password` group: `nrdocs password allow OWNER/REPO` and `nrdocs password disallow OWNER/REPO`. The existing `nrdocs password set` operator override is unchanged.
- One new branch in the publish handler that reads the optional `password` multipart field, evaluates the access-mode interaction matrix (Q1), and writes the password + audit log atomically (Q3).
- One additional binding in the auto-approval insert path so that when a publish from an unknown repo is auto-approved by a matching rule, the new repo row gets `allow_repo_owner_password = rule.default_allow_repo_owner_password` at the moment the row is inserted (this is independent of the publish-time password handling above and happens whether or not the publish includes a `password` field).
- One CLI publish change that conditionally appends the `password` field iff `NRDOCS_DOCS_PASSWORD` is set to a **non-empty** string (Q4).
- One workflow template change in `nrdocs init` that surfaces the secret to the publish step.
- README sections for both audiences.

The publish allowlist (existing repo or matching auto-approval rule) and the disabled-repo short-circuit (`REPO_DISABLED`) remain the gatekeepers — this feature does not widen who can publish.

## Architecture

### High-level flow

```mermaid
sequenceDiagram
  autonumber
  participant Op as Operator
  participant CLI as nrdocs CLI
  participant W as Worker
  participant DB as D1 (repos, password_credentials, audit_log)
  participant Owner as Repo Owner
  participant GHA as GitHub Actions

  Op->>CLI: nrdocs password allow owner/repo
  CLI->>W: POST /api/repos/:owner/:repo/allow-self-password (Bearer OPERATOR_TOKEN)
  W->>DB: UPDATE repos SET allow_repo_owner_password=1; INSERT audit_log (batch)
  W-->>CLI: 200 { repo: { ..., allow_repo_owner_password: true } }
  CLI-->>Op: "Self-service password enabled for owner/repo."

  Owner->>Owner: Set GitHub Secret NRDOCS_DOCS_PASSWORD
  GHA->>CLI: nrdocs publish (NRDOCS_DOCS_PASSWORD in env)
  CLI->>W: POST /api/publish (multipart: artifact, metadata, password?)
  W->>DB: existing publish flow (allowlist, build, audit)
  Note over W,DB: If repo is new and matches an enabled rule R during the<br/>auto-approval insert path, the inserted repo row gets<br/>allow_repo_owner_password = R.default_allow_repo_owner_password.<br/>Existing repo rows are never retroactively updated.
  alt allow_repo_owner_password = true and password length valid
    W->>DB: BATCH(deactivate prior creds, insert new cred, [setAccessMode if needed,] audit_log)
    W-->>CLI: same publish response shape (no password discriminant in body)
  else allow=false or field absent
    W-->>CLI: same publish response shape (no password discriminant in body)
  end
```

### Rule-driven self-password stamping at auto-approval (R11.5–R11.6)

When a Publish_Request comes from a repository that does **not** yet have a row in `repos` (look-up by `github_repository_id` returns null) AND the publish allowlist passes because a rule R matches `fullName`, the existing flow inserts a new `repos` row via `upsertRepo` (currently always with `allow_repo_owner_password=0` after migration 0002, since the column is just defaulted). This feature changes the insert path so that when the row is inserted as a result of a rule match, `allow_repo_owner_password` is bound to `R.default_allow_repo_owner_password` instead of the column default.

Concretely: `upsertRepo` is extended to accept an optional `allow_repo_owner_password` parameter. The publish handler computes the matched rule once (it already does; see step 5 of the existing flow), passes the matched rule down to the insert call, and binds `matchedRule.default_allow_repo_owner_password` if the row is new. If the row already exists, the parameter is ignored — `upsertRepo`'s update branch never touches `allow_repo_owner_password` (R11.6).

This is independent of step 15a (the publish-time password handling). A repo can be stamped with `allow_repo_owner_password=true` at auto-approval time without ever sending a `password` field in that same request; the next publish from that repo will then be eligible to take the self-service-set branch.

### Access-mode interaction matrix (Q1)

The matrix below applies only when `allow_repo_owner_password=true` AND the supplied `password` field is present AND its length is in `[DEFAULT_MIN_PASSWORD_LENGTH, DEFAULT_MAX_PASSWORD_LENGTH]`. Otherwise the password is ignored or rejected per the rules in §Components and Interfaces.

| `approval_state` | `access_mode` (before) | Action                                    | `access_mode` (after) |
|------------------|------------------------|-------------------------------------------|-----------------------|
| `approved`       | `password`             | Store new hash                            | `password` (unchanged) |
| `approved`       | `none`                 | Store new hash AND auto-flip access       | `password` (changed)   |
| `approved`       | `public`               | Store new hash; leave mode public         | `public` (unchanged)   |
| `pending`        | any                    | Store new hash; do not change other fields | unchanged             |
| `disabled`       | any                    | Reject (REPO_DISABLED short-circuit fires before this branch is reached) | n/a |

Whenever `access_mode` changes as a side effect, the Worker writes a `repo.access_changed` audit entry alongside the `repo.self_password_set` entry.

### Hard-fail audit policy (Q3)

A self-service password store is treated as a single logical operation: deactivate prior active credential row, insert the new credential row, optionally update `access_mode` on `repos`, and append the matching audit entries. These writes are issued as a single D1 `batch([...])` so they either all commit or all roll back. If the batch throws (or `meta.error` is set on any statement), the publish handler responds with HTTP 500 / `AUDIT_WRITE_FAILED` and no partial state is left behind.

This is a deliberate change in semantics for the publish handler: the build itself is already committed by the time we reach this branch (the build record was inserted earlier and the artifact was already stored in R2). We therefore return 500 even though the publish succeeded — the choice is to fail the workflow loudly so the operator notices the audit subsystem outage rather than to silently skip the audit write.

## Components and Interfaces

### 1. Worker handlers

#### New: `handleAllowSelfPassword`, `handleDisallowSelfPassword` (in `packages/worker/src/handlers/repos.ts`)

Both handlers follow the same shape as the existing `handleApproveRepo` / `handleDisableRepo`:

```ts
// packages/worker/src/handlers/repos.ts
export async function handleAllowSelfPassword(
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authenticated) return auth.response;

  const fullName = `${params['owner']}/${params['repo']}`.toLowerCase();
  const repo = await findRepoByFullName(env.DB, fullName);
  if (!repo) {
    return jsonError('NOT_FOUND', `Repository '${fullName}' not found`, 404);
  }

  await setSelfPasswordAllowFlag(env.DB, repo.id, true);

  await writeAuditEvent(env.DB, {
    event_type: 'repo.self_password_allowed',
    actor_type: 'operator',
    repo_id: repo.id,
  });

  const updated = await findRepoByFullName(env.DB, fullName);
  return jsonSuccess({ repo: updated });
}

// handleDisallowSelfPassword is identical except it sets the flag to false
// and writes event_type 'repo.self_password_disallowed'.
```

These two handlers are **idempotent** by construction: they unconditionally set the flag to the target value and write an audit entry on every call (R2.9).

#### Routes (in `packages/worker/src/index.ts`)

```ts
router.post('/api/repos/:owner/:repo/allow-self-password', handleAllowSelfPassword);
router.post('/api/repos/:owner/:repo/disallow-self-password', handleDisallowSelfPassword);
```

These match the existing operator-router URL style (POST verb sub-paths under the repo resource). `requireOperator` is invoked first by both handlers, so a missing/invalid Bearer credential returns HTTP 401 before any DB read or write occurs (R1.4).

#### Modified: `handlePublish` (in `packages/worker/src/handlers/publish.ts`)

The existing publish flow is unchanged through step 7 (extract artifact / validate metadata / size check). After the publish allowlist check passes and the build is recorded (existing steps 8–12), a new step is inserted **after** the publish audit event is written and **before** the auto-approval rule evaluation:

```text
Existing  : 1. auth → 2. OIDC verify → 3. derive identity →
            4. disabled short-circuit → 5. allowlist short-circuit →
            6. parse multipart → 7. validate metadata → 8. size check →
            9. extract → 10. upsertRepo → 11. createBuild → 12. store R2 →
            13. markBuildSuccess → 14. updateLatestBuild →
            15. write build.published audit
NEW       : 15a. if password field present, evaluate flag and process
Existing  : 16. evaluate auto-approval rules → 17. determine serving status → 18. respond
```

Inside step 15a:

```ts
// Pseudocode — see §Data Models for the shape of currentRepo
const passwordRaw = formData.get('password');
if (typeof passwordRaw === 'string') {
  // Reload the repo to pick up the current allow flag
  const currentRepo = await findRepoByGithubId(env.DB, claims.repository_id);
  if (currentRepo && currentRepo.allow_repo_owner_password) {
    if (
      passwordRaw.length < DEFAULT_MIN_PASSWORD_LENGTH ||
      passwordRaw.length > DEFAULT_MAX_PASSWORD_LENGTH
    ) {
      // Q2: 400 INVALID_PASSWORD; do not leak the supplied value
      return jsonError(
        'INVALID_PASSWORD',
        `Password must be between ${DEFAULT_MIN_PASSWORD_LENGTH} and ${DEFAULT_MAX_PASSWORD_LENGTH} characters`,
        400,
      );
    }

    // Q3: store password + audit + (optional) access-mode flip atomically
    const result = await storeSelfServicePassword(env.DB, {
      repo: currentRepo,
      plaintext: passwordRaw,
      fullName,
      buildId: build.id,
    });
    if (!result.ok) {
      // Q3 hard-fail: D1 batch failed. The batch is atomic, so nothing was
      // partially written; no rollback step is required.
      return jsonError('AUDIT_WRITE_FAILED', 'Failed to record self-service password change', 500);
    }
  } else if (currentRepo) {
    // Allow flag is false: silently discard the password value, write
    // the ignore audit event. Do NOT vary the publish response in any way.
    try {
      await writeAuditEvent(env.DB, {
        event_type: 'repo.self_password_ignored',
        actor_type: 'github_action',
        actor_id: fullName,
        repo_id: currentRepo.id,
        build_id: build.id,
      });
    } catch (_e) {
      // R5.9: audit-write failure for the ignore path is also a hard fail,
      // since the security claim is "we always log this decision".
      return jsonError('AUDIT_WRITE_FAILED', 'Failed to record self-service password decision', 500);
    }
  }
}
```

Note: the `passwordRaw` variable is never logged, never echoed back, and never persisted in plaintext. It is GC-eligible as soon as the function returns.

### 2. Worker DB helpers

#### New: `setSelfPasswordAllowFlag` (in `packages/worker/src/db/repos.ts`)

```ts
export async function setSelfPasswordAllowFlag(
  db: D1Database,
  repoId: string,
  allow: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE repos SET allow_repo_owner_password = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(allow ? 1 : 0, now, repoId)
    .run();
}
```

#### New: `storeSelfServicePassword` (in `packages/worker/src/handlers/publish.ts` or `db/passwords.ts`)

Performs hashing outside the batch (PBKDF2 is async and not a SQL operation) and then issues a single atomic D1 `batch([...])` call:

```ts
async function storeSelfServicePassword(
  db: D1Database,
  args: { repo: RepoRecord; plaintext: string; fullName: string; buildId: string },
): Promise<{ ok: true } | { ok: false }> {
  const { hash, salt, iteration_count } = await hashPassword(args.plaintext);
  const credId = generateId('cred_');
  const auditCredId = generateId('evt_');
  const now = new Date().toISOString();
  const nextVersion = await nextPasswordVersion(db, args.repo.id);

  // Determine if access_mode needs to flip (matrix in §Architecture)
  const flipToPassword =
    args.repo.approval_state === 'approved' && args.repo.access_mode === 'none';

  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    db.prepare(
      `UPDATE password_credentials SET active = 0, updated_at = ?, updated_by = ? WHERE repo_id = ? AND active = 1`,
    ).bind(now, 'repo_owner', args.repo.id),
  );
  stmts.push(
    db.prepare(
      `INSERT INTO password_credentials (id, repo_id, password_hash, hash_algorithm, salt, iteration_count, password_version, active, created_at, updated_at, updated_by)
       VALUES (?, ?, ?, 'pbkdf2-sha256', ?, ?, ?, 1, ?, ?, ?)`,
    ).bind(credId, args.repo.id, hash, salt, iteration_count, nextVersion, now, now, 'repo_owner'),
  );
  stmts.push(
    db.prepare(
      `INSERT INTO audit_log (id, event_type, actor_type, actor_id, repo_id, build_id, rule_id, metadata_json, created_at)
       VALUES (?, 'repo.self_password_set', 'github_action', ?, ?, ?, NULL, NULL, ?)`,
    ).bind(auditCredId, args.fullName, args.repo.id, args.buildId, now),
  );
  if (flipToPassword) {
    const auditModeId = generateId('evt_');
    stmts.push(
      db.prepare(`UPDATE repos SET access_mode = 'password', updated_at = ? WHERE id = ?`)
        .bind(now, args.repo.id),
    );
    stmts.push(
      db.prepare(
        `INSERT INTO audit_log (id, event_type, actor_type, actor_id, repo_id, build_id, rule_id, metadata_json, created_at)
         VALUES (?, 'repo.access_changed', 'github_action', ?, ?, ?, NULL, ?, ?)`,
      ).bind(
        auditModeId,
        args.fullName,
        args.repo.id,
        args.buildId,
        JSON.stringify({ old_mode: args.repo.access_mode, new_mode: 'password' }),
        now,
      ),
    );
  }

  try {
    const results = await db.batch(stmts);
    for (const r of results) {
      if (r.error) return { ok: false };
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
```

`db.batch([...])` is the standard D1 atomic-transaction API. Either every statement commits or none of them do, which is exactly the semantics R5.9 / Q3 require.

`nextPasswordVersion` is a small helper that mirrors the version-bump logic already present in the existing `setPassword` (one extra `SELECT MAX(password_version)` round-trip; this read is **not** inside the batch).

### 3. CLI

#### Modified: `packages/cli/src/commands/password.ts`

Add two new exported handlers and parsing helpers, mirroring the existing `parsePasswordSetArgs` / `handlePasswordSet`:

```ts
interface PasswordAllowOptions {
  repo?: string;
  json?: boolean;
}

export function parsePasswordAllowArgs(args: string[]): PasswordAllowOptions { ... }

export async function handlePasswordAllow(args: string[]): Promise<void> {
  const opts = parsePasswordAllowArgs(args);
  // 1. Validate repo argument is in OWNER/REPO format → exit 2 if not
  // 2. resolveCredentials() → exit 1 if missing
  // 3. client.setSelfPasswordAllow(owner, repo, true)
  // 4. On success, print "Self-service password enabled for owner/repo."
  // 5. On HTTP error, print server message; exit non-zero
}

export async function handlePasswordDisallow(args: string[]): Promise<void> { ... }
```

#### Modified: `packages/cli/src/commands/index.ts`

The existing `case 'password':` block currently dispatches only the `set` subcommand. Extend it:

```ts
case 'password':
  switch (subCmd) {
    case 'set':
      await handlePasswordSet(args.slice(2));
      break;
    case 'allow':
      await handlePasswordAllow(args.slice(2));
      break;
    case 'disallow':
      await handlePasswordDisallow(args.slice(2));
      break;
    default:
      console.error('Usage: nrdocs password <set|allow|disallow> <owner/repo> [...]');
      process.exitCode = 1;
  }
  break;
```

`nrdocs --help` is updated to list `password set | allow | disallow` under operator commands.

#### Modified: `packages/cli/src/api-client.ts`

```ts
async setSelfPasswordAllow(owner: string, repo: string, allow: boolean): Promise<ApiResponse> {
  const path = allow
    ? `/api/repos/${owner}/${repo}/allow-self-password`
    : `/api/repos/${owner}/${repo}/disallow-self-password`;
  return this.request('POST', path);
}
```

#### Modified: `packages/cli/src/commands/publish.ts`

The current `handlePublish` builds a `FormData` with `artifact` and `metadata`. Add one block immediately after those two `formData.append(...)` calls:

```ts
const docsPasswordRaw = process.env['NRDOCS_DOCS_PASSWORD'];
if (typeof docsPasswordRaw === 'string' && docsPasswordRaw.length > 0) {
  formData.append('password', docsPasswordRaw);
}
// else: missing OR empty → omit the field entirely (Q4)
```

This is the **only** place the env var is read; no other code path logs or persists it. Verbose mode (`--verbose`) prints the URL and HTTP status only — the existing implementation does not echo request bodies, and we will not add any logging here.

#### Modified: `packages/cli/src/commands/init.ts` (workflow template)

The `generateWorkflowYml(docsDir, apiUrl)` function is the single source for the publish workflow template. Update its `Publish docs` step's `env:` block:

```yaml
      - name: Publish docs
        run: nrdocs publish --docs-dir ${docsDir}
        env:
          NRDOCS_API_URL: ${apiUrl}
          NRDOCS_DOCS_PASSWORD: ${{ secrets.NRDOCS_DOCS_PASSWORD }}
```

`nrdocs init --force` overwrites the workflow file (existing behaviour) so re-running `init` migrates older repos to the new template (R3.4).

### 5. Rule self-password default (R11)

#### Modified: `packages/cli/src/commands/rules.ts`

Extend `parseRulesAddArgs` to recognize `--self-set-password <allow|deny>`:

```ts
interface RulesAddOptions {
  pattern?: string;
  access?: string;
  applyExisting?: boolean;
  selfSetPassword?: 'allow' | 'deny'; // NEW: undefined = default (allow)
  json?: boolean;
}

export function parseRulesAddArgs(args: string[]): RulesAddOptions {
  const opts: RulesAddOptions = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--access' && i + 1 < args.length) {
      opts.access = args[++i];
    } else if (arg === '--apply-existing') {
      opts.applyExisting = true;
    } else if (arg === '--self-set-password' && i + 1 < args.length) {
      const v = args[++i];
      if (v === 'allow' || v === 'deny') {
        opts.selfSetPassword = v;
      } else {
        // Sentinel value triggers a usage error in handleRulesAdd; we keep
        // parsing pure (no exits) for testability.
        opts.selfSetPassword = ('__invalid__' as 'allow' | 'deny');
      }
    } else if (arg === '--json') {
      opts.json = true;
    } else if (!arg?.startsWith('--')) {
      positional.push(arg!);
    }
  }
  if (positional.length >= 1) opts.pattern = positional[0];
  return opts;
}
```

In `handleRulesAdd`, after the existing `--access` validation:

```ts
if (opts.selfSetPassword !== undefined && opts.selfSetPassword !== 'allow' && opts.selfSetPassword !== 'deny') {
  console.error('Error: --self-set-password must be "allow" or "deny".');
  process.exit(2);
}
const defaultAllowSelfPassword =
  opts.selfSetPassword === undefined ? true : opts.selfSetPassword === 'allow';
// ... existing creds resolution ...
const res = await client.addRule(opts.pattern, opts.access, opts.applyExisting, defaultAllowSelfPassword);
```

Extend `formatRulesTable` to add the `SELF-PWD` column:

```ts
const headers = ['ID', 'PATTERN', 'ACCESS', 'SELF-PWD', 'ENABLED', 'PRIORITY'];
const rows = rules.map((r) => [
  String(r['id'] ?? '-').slice(0, 8),
  String(r['pattern'] ?? '-'),
  String(r['access_mode'] ?? '-'),
  r['default_allow_repo_owner_password'] ? 'allow' : 'deny',
  String(r['enabled'] ?? '-'),
  String(r['priority'] ?? '-'),
]);
```

#### Modified: `packages/cli/src/api-client.ts`

Extend `addRule` signature:

```ts
async addRule(
  pattern: string,
  accessMode: string,
  applyExisting?: boolean,
  defaultAllowSelfPassword?: boolean,
): Promise<ApiResponse> {
  const body: Record<string, unknown> = { pattern, access_mode: accessMode };
  if (applyExisting !== undefined) body['apply_existing'] = applyExisting;
  if (defaultAllowSelfPassword !== undefined) {
    body['default_allow_repo_owner_password'] = defaultAllowSelfPassword;
  }
  return this.request('POST', '/api/auto-approval-rules', body);
}
```

(The exact existing body shape is already partly normalized in `addRule`; this addition leaves the existing fields untouched.)

#### Modified: `packages/worker/src/handlers/rules.ts` — `handleCreateRule`

`POST /api/auto-approval-rules` lives in `packages/worker/src/handlers/rules.ts` as `handleCreateRule`. Extend it to accept `default_allow_repo_owner_password` (R11.7, R11.8):

```ts
let defaultAllowSelfPassword = true; // R11.7 default
if (body.default_allow_repo_owner_password !== undefined) {
  if (typeof body.default_allow_repo_owner_password !== 'boolean') {
    return jsonError(
      'VALIDATION_ERROR',
      'default_allow_repo_owner_password must be a boolean',
      400,
      { field: 'default_allow_repo_owner_password' },
    );
  }
  defaultAllowSelfPassword = body.default_allow_repo_owner_password;
}

const rule = await createRule(
  env.DB,
  body.pattern,
  accessMode,
  'operator',
  priority,
  defaultAllowSelfPassword,
);
```

#### Modified: `packages/worker/src/db/rules.ts` — `createRule` and `listRules`

Extend `createRule` to bind the new column, and extend the row reader to coerce `INTEGER 0/1` to a JS boolean:

```ts
export async function createRule(
  db: D1Database,
  pattern: string,
  accessMode: 'public' | 'password',
  createdBy: string,
  priority?: number,
  defaultAllowSelfPassword: boolean = true,
): Promise<AutoApprovalRule> {
  const id = generateId('rule_');
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO auto_approval_rules (
         id, pattern, access_mode, enabled, priority,
         default_allow_repo_owner_password,
         created_at, created_by, updated_at, updated_by
       ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, pattern.toLowerCase(), accessMode, priority ?? 0,
      defaultAllowSelfPassword ? 1 : 0,
      now, createdBy, now, createdBy,
    )
    .run();

  const row = await db
    .prepare('SELECT * FROM auto_approval_rules WHERE id = ?')
    .bind(id)
    .first();
  return normalizeRule(row);
}

function normalizeRule(row: any): AutoApprovalRule {
  return {
    ...row,
    enabled: row.enabled === 1,
    default_allow_repo_owner_password: row.default_allow_repo_owner_password === 1,
  };
}
```

Apply `normalizeRule` in `listRules`, `findMatchingRule`'s callers (the function operates on already-normalized records), and `matchRules`. The same INTEGER→boolean pattern is already used for `repos.allow_repo_owner_password` and `password_credentials.active`.

#### Modified: `packages/worker/src/handlers/publish.ts` — auto-approval insert path (R11.5)

The auto-approval insert path is the existing branch in `handlePublish` that fires when a Publish_Request comes from a repo without an existing row and the allowlist passed only because a rule matched. Today the flow is:

1. `findRepoByGithubId` returns null.
2. `matchRules` returns a rule R.
3. Later, `upsertRepo` inserts a new row with the column default (`allow_repo_owner_password=0`).
4. Even later, `approveRepo` flips `approval_state` to `approved` (this stays operator-set behavior; it does not touch `allow_repo_owner_password`).

The change: extend `upsertRepo` (in `db/repos.ts`) to accept an optional `allow_repo_owner_password?: boolean` and bind it on **insert only**:

```ts
export interface UpsertRepoInput {
  github_repository_id: string;
  owner: string;
  name: string;
  full_name: string;
  site_title?: string;
  requested_access?: string;
  allow_repo_owner_password?: boolean; // NEW: only honored on INSERT
}

// inside upsertRepo, INSERT branch:
await db
  .prepare(
    `INSERT INTO repos (
       id, github_repository_id, owner, name, full_name,
       approval_state, access_mode,
       allow_repo_owner_password,
       site_title, requested_access, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'pending', 'none', ?, ?, ?, ?, ?)`,
  )
  .bind(
    id, input.github_repository_id, owner, name, fullName,
    input.allow_repo_owner_password === true ? 1 : 0,
    input.site_title ?? null,
    input.requested_access ?? null,
    now, now,
  )
  .run();
```

The UPDATE branch is left **unchanged** — it does not touch `allow_repo_owner_password`. This is what enforces R11.6 (no retroactive modification of existing repo rows).

In `handlePublish`, the `matchRules` call inside the publish allowlist short-circuit (step 5 in the existing flow) is moved to capture the matched rule for later use:

```ts
let matchedRuleForNewRepo: AutoApprovalRule | null = null;
if (!existingRepo) {
  matchedRuleForNewRepo = await matchRules(env.DB, fullName);
  if (!matchedRuleForNewRepo) {
    return jsonError('REPO_NOT_ALLOWED', /* … */, 403);
  }
}
// … later in step 8 (upsertRepo):
const repo = await upsertRepo(env.DB, {
  github_repository_id: claims.repository_id,
  owner: ownerName,
  name: repoName,
  full_name: fullName,
  site_title: metadata.site_title,
  requested_access: metadata.requested_access,
  allow_repo_owner_password: matchedRuleForNewRepo?.default_allow_repo_owner_password,
});
```

Because `matchedRuleForNewRepo` is null when `existingRepo` was non-null, the UPDATE branch of `upsertRepo` runs and `allow_repo_owner_password` is not touched (R11.6). When `existingRepo` was null AND a rule matched, the INSERT branch binds the rule's default.

### 4. README updates (R8)

Add a new top-level section "Self-service docs passwords (operator opt-in)" with these subsections:

1. **What it does** — one-paragraph summary mirroring the Introduction of `requirements.md`.
2. **Operator: opt a repo in / out** — example invocations:
   ```
   nrdocs password allow myorg/myrepo
   nrdocs password disallow myorg/myrepo
   ```
   With a note: "The existing `nrdocs password set OWNER/REPO` command continues to work as a fallback and as the override path."
3. **Repo owner: set the secret** — instructions to create the GitHub Actions encrypted Secret `NRDOCS_DOCS_PASSWORD`. Note that it is consumed automatically by the workflow generated by `nrdocs init`. If the secret is unset, the CLI omits the field entirely; the workflow still runs successfully.
4. **What happens to access mode** — plain-language version of the matrix in §Architecture, including the explicit note that `access=public` is **not** flipped automatically.
5. **What happens if you set the secret on a repo that's not opted in** — answer: nothing. The publish succeeds; the password is silently dropped; the response body is identical to the case where no password was sent. This is by design.
6. **Operator override** — `nrdocs password set OWNER/REPO` still works regardless of the allow flag and remains the canonical operator path.

## Data Models

### Schema migration: `packages/worker/migrations/0002_repo_owner_password_optin.sql`

```sql
-- Add per-repo opt-in flag for self-service password management.
-- Existing rows default to 0 (opt-in disabled) without rewriting any other column.
ALTER TABLE repos ADD COLUMN allow_repo_owner_password INTEGER NOT NULL DEFAULT 0;
```

Notes:
- SQLite (and therefore Cloudflare D1) implements `ALTER TABLE ... ADD COLUMN` as an O(1) catalog change; existing rows are not rewritten and pick up the default value virtually.
- D1's migration runner records applied migrations in a meta table and only applies new files. Re-running migrations is therefore a no-op rather than a re-execution. If somebody manually re-applies the SQL, SQLite returns `duplicate column name: allow_repo_owner_password` and exits non-zero (R1.5).
- No data backfill is required: every pre-existing repo gets `allow_repo_owner_password=0`, and no existing operator-set password is changed (`password_credentials` is untouched).
- The migration is forward-only. Rollback requires a manual `ALTER TABLE repos DROP COLUMN allow_repo_owner_password;` (SQLite 3.35+; D1's underlying SQLite supports this) plus invalidating any cached responses, but rollback is out of scope for normal operation.

### Schema migration: `packages/worker/migrations/0003_rule_self_password_default.sql`

```sql
-- Add per-rule default for the self-service password capability stamped onto
-- NEW repos auto-approved by the rule. Existing rules default to 1 (allow).
ALTER TABLE auto_approval_rules
  ADD COLUMN default_allow_repo_owner_password INTEGER NOT NULL DEFAULT 1;
```

Notes:
- Same O(1) catalog-change semantics as 0002. Existing rule rows pick up the default value virtually; no row is rewritten.
- The user's locked decision (point 6 in the requirements update) is that pre-existing rules should default to `allow=true` — "trusted parties control their own passwords" — so the column default is `1`. This means when an operator deploys this feature against an instance with rules already in place, every existing rule starts granting the self-password capability to repos newly auto-approved by it. Operators who want a stricter posture must explicitly recreate rules with `--self-set-password deny` after deploy (or update rules out-of-band).
- This migration only adds the column on `auto_approval_rules`. It does **not** touch any rows in `repos`. R11.6 (no retroactive modification of repo rows) is enforced by the migration's scope.
- Same forward-only stance as 0002. Re-applying manually returns `duplicate column name: default_allow_repo_owner_password` (R11.12).

### Updated `RepoRecord` (`packages/shared/src/types.ts`)

```ts
export interface RepoRecord {
  // ...existing fields...
  allow_repo_owner_password: boolean;
}
```

### Updated `AutoApprovalRule` (`packages/shared/src/types.ts`)

```ts
export interface AutoApprovalRule {
  // ...existing fields...
  default_allow_repo_owner_password: boolean;
}
```

The same INTEGER→boolean coercion in `normalizeRule` (see §Components and Interfaces) applies to this new field. All existing call sites that materialize an `AutoApprovalRule` from D1 (`createRule`, `listRules`, `matchRules`, the test makeRule helpers in `__tests__/db.test.ts`, `__tests__/access-matrix.test.ts`, `__tests__/state-transitions.test.ts`) must be updated to populate the new field.

D1 returns INTEGER columns as JavaScript numbers (`0` or `1`). Two integration points need to coerce:

1. **Reads**: every helper that constructs a `RepoRecord` (`findRepoByFullName`, `findRepoByGithubId`, `listRepos`, `approveRepo`, `disableRepo`, `setAccessMode`) goes through a small normalizer:
   ```ts
   function normalizeRepo(row: any): RepoRecord {
     return { ...row, allow_repo_owner_password: row.allow_repo_owner_password === 1 };
   }
   ```
   This is added in `db/repos.ts` and is the only place that knows about the integer encoding.
2. **Writes**: `setSelfPasswordAllowFlag` binds `allow ? 1 : 0`.

The existing `PasswordCredential.active: boolean` field is encoded the same way (INTEGER 0/1), so this pattern is consistent with prior decisions.

### New audit event types

| `event_type`                        | `actor_type`     | When                                              | Metadata |
|-------------------------------------|------------------|---------------------------------------------------|----------|
| `repo.self_password_allowed`        | `operator`       | `nrdocs password allow OWNER/REPO` succeeds       | none     |
| `repo.self_password_disallowed`     | `operator`       | `nrdocs password disallow OWNER/REPO` succeeds    | none     |
| `repo.self_password_set`            | `github_action`  | Self-service password stored on publish           | none     |
| `repo.self_password_ignored`        | `github_action`  | Password field present but allow flag is false    | none     |
| `repo.access_changed` (existing)    | `github_action`  | none→password flip on self-service set            | `{ old_mode, new_mode }` |

`actor_id` is set to `<full_name>` for the `github_action` events and unset for the operator events (the `Bearer OPERATOR_TOKEN` identifies the operator implicitly; this matches the existing audit pattern in `handleApproveRepo`).

### Multipart shape for `POST /api/publish`

| Field      | Required | Type        | New for this feature? |
|------------|----------|-------------|------------------------|
| `artifact` | yes      | binary file | no                     |
| `metadata` | optional | JSON string | no                     |
| `password` | optional | text        | **yes**                |

`password` is a plain text field, not a file. The CLI appends it via `formData.append('password', docsPasswordRaw)`. The Worker reads it via `formData.get('password')`, which yields a `string` in Cloudflare Workers' FormData implementation.

<!-- PHASE BREAK: Correctness Properties section follows after the prework analysis. -->


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

The acceptance criteria of this feature are dominated by single-cell matrix tests (the access-mode interaction matrix from R6) and ordering claims (R7) for which one or two example tests are sufficient. The properties below cover the parts of the surface where input variation reveals real bugs: env-var-to-form-data forwarding, no-leak claims, round-trips through hashing, and the security-critical response indistinguishability guarantee.

### Property 1: Publish multipart inclusion biconditional

*For any* value of `process.env.NRDOCS_DOCS_PASSWORD` drawn from {`undefined`, `""`, any non-empty string s of length 1..512 over arbitrary Unicode}, the FormData built by `handlePublish` SHALL contain a field named `password` if and only if the value is a non-empty string, and when the field is present its value SHALL equal the env var contents byte-for-byte.

**Validates: Requirements 4.1, 4.2**

### Property 2: No plaintext password in CLI output

*For any* non-empty string s assigned to `NRDOCS_DOCS_PASSWORD`, *for any* publish outcome (ApiClient stub returning either `{ok:true, ...}` or `{ok:false, error:...}`), *for any* verbosity flag combination, the captured stdout and stderr from `handlePublish` SHALL NOT contain s as a substring.

**Validates: Requirements 4.4, 4.5**

### Property 3: Operator allow/disallow idempotence and audit completeness

*For any* sequence of operator commands `c_1, c_2, …, c_n` with `c_i ∈ {allow, disallow}` of length 1..10 issued against a single repo `R`, after the sequence completes:
- `R.allow_repo_owner_password` equals `(c_n == allow)`.
- The number of `audit_log` rows for `R` with `event_type ∈ {repo.self_password_allowed, repo.self_password_disallowed}` equals `n`.
- Every command in the sequence returns HTTP 200.

**Validates: Requirements 2.1, 2.2, 2.8, 2.9**

### Property 4: Self-service password round-trips through verifyPassword

*For any* string p with `DEFAULT_MIN_PASSWORD_LENGTH ≤ len(p) ≤ DEFAULT_MAX_PASSWORD_LENGTH` (over the full Unicode codepoint range), *for any* repo R with `allow_repo_owner_password=true` and `approval_state ∈ {approved, pending}`, after a publish to R that includes `password=p` in the multipart body, the result of `verifyPassword(p, getActivePassword(R))` SHALL be `true`.

**Validates: Requirements 5.2**

### Property 5: Ignore audit row never contains plaintext or hash

*For any* string p with `DEFAULT_MIN_PASSWORD_LENGTH ≤ len(p) ≤ DEFAULT_MAX_PASSWORD_LENGTH`, *for any* repo R with `allow_repo_owner_password=false`, after a publish to R that includes `password=p`, the `metadata_json` of the resulting `repo.self_password_ignored` audit row SHALL NOT contain p, and SHALL NOT contain any hash of p (no PBKDF2 output, no SHA-256 hex, no salt-prefixed derivative).

**Validates: Requirements 5.6**

### Property 6: Response indistinguishability when no password is sent

*For any* valid publish payload `m` (artifact + metadata, **no** `password` field), *for any* repo R that exists and is in identical state apart from `allow_repo_owner_password`, the response body bytes of `POST /api/publish` SHALL be byte-for-byte identical between the case where `R.allow_repo_owner_password=true` and the case where it equals `false`.

**Validates: Requirements 5.7**

### Property 7: Response body never reveals password material

*For any* string p with `DEFAULT_MIN_PASSWORD_LENGTH ≤ len(p) ≤ DEFAULT_MAX_PASSWORD_LENGTH`, *for any* repo R with `allow_repo_owner_password=true`, after a publish that includes `password=p`, the response body bytes SHALL NOT contain p, the active credential's `password_hash`, or the active credential's `salt` as a substring.

**Validates: Requirements 5.8**

### Property 8: Rule-stamp biconditional

*For all* enabled rules R with `default_allow_repo_owner_password = v` (v ∈ {true, false}), *for all* Publish_Requests from a repository whose `github_repository_id` is NOT yet present in `repos` and whose `full_name` matches R (with R chosen as the matched rule by `findMatchingRule` over the rule set), the inserted `repos` row produced by that publish SHALL have `allow_repo_owner_password = v`. Symmetrically, *for all* publish_requests from a repository whose `github_repository_id` IS already present in `repos`, the value of `allow_repo_owner_password` on that row SHALL be unchanged after the publish completes regardless of whether a rule R matches.

**Validates: Requirements 11.5, 11.6**

## Error Handling

| Condition                                                              | HTTP | `error.code`            | Source             |
|------------------------------------------------------------------------|------|--------------------------|--------------------|
| Operator endpoint without/invalid Bearer token                         | 401  | `UNAUTHORIZED`           | `requireOperator`  |
| Operator endpoint targeting unknown repo                               | 404  | `NOT_FOUND`              | new handlers       |
| Publish: REPO_DISABLED                                                 | 409  | `REPO_DISABLED`          | existing           |
| Publish: REPO_NOT_ALLOWED (allowlist miss)                             | 403  | `REPO_NOT_ALLOWED`       | existing           |
| Publish: `password` field present, allow=true, length out of bounds    | 400  | `INVALID_PASSWORD`       | new branch (Q2)    |
| Publish: `password` field present, allow=true, D1 batch fails          | 500  | `AUDIT_WRITE_FAILED`     | new branch (Q3)    |
| Publish: `password` field present, allow=false, ignore-audit fails     | 500  | `AUDIT_WRITE_FAILED`     | new branch (Q3)    |
| Publish: `password` field absent                                       | n/a  | n/a                      | continue normally  |
| Publish: `password` field present, allow=false, length valid           | n/a  | n/a (publish succeeds)   | discard + ignore-audit |
| `nrdocs rules add --self-set-password <invalid>`                       | n/a  | n/a (CLI exit 2)         | new CLI parser (R11.4) |
| `POST /api/auto-approval-rules` body has non-boolean `default_allow_repo_owner_password` | 400 | `VALIDATION_ERROR` | new branch (R11.8) |

`INVALID_PASSWORD` errors do not echo the supplied value; the response message references only the length bounds (`Password must be between 8 and 128 characters`).

`AUDIT_WRITE_FAILED` is intentionally a 500 rather than a 4xx because the publish itself was valid but a server-side invariant (audit completeness) cannot be upheld. The 500 surfaces in the GitHub Actions log so the operator can investigate.

## Testing Strategy

This is a backend feature with a clear input/output surface (the `POST /api/publish` handler, two new operator endpoints, and a small CLI dispatch change). Property-based testing applies to the four "for all" claims documented above. Everything else is example-based or migration/integration testing.

### Library and configuration

- **Property-based testing library**: `fast-check` (already a dev-dependency candidate; pick the latest 3.x). Each property test runs **at least 100 iterations** (the fast-check default of 100 is acceptable; use `numRuns: 100` explicitly).
- **Tag format** for each PBT: a leading code comment of the form `// Feature: repo-owner-self-service-password, Property P-X-Y: <property text>`.
- **Worker test runner**: existing Vitest setup under `packages/worker/src/__tests__/`.
- **CLI test runner**: existing Vitest setup under `packages/cli/src/__tests__/`.
- **D1 in tests**: tests use the existing in-memory SQLite shim (see how `password_credentials` is currently exercised); the new tests follow the same harness.

### Test files (planned)

| File                                                                                | Purpose                                                                                       |
|-------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| `packages/worker/src/__tests__/migration-0002.test.ts` (new)                        | R1.3, R1.5 — apply 0002 against a 0001-only DB, verify backfill and re-apply behavior.        |
| `packages/worker/src/__tests__/repos-self-password.test.ts` (new)                   | R1.1, R1.2, R1.4, R2.* — operator endpoint behavior + audit rows + idempotence (Property 3).       |
| `packages/worker/src/__tests__/publish-self-password.test.ts` (new)                 | R5.*, R6.*, R7.* — full publish-handler matrix incl. Properties 4–7.                            |
| `packages/cli/src/__tests__/password-allow.test.ts` (new)                           | R2.* CLI-side — arg parsing, credential resolution, dispatch routing.                         |
| `packages/cli/src/__tests__/publish-password-env.test.ts` (new)                     | R4.* — Properties 1 and 2 over the env var.                                                  |
| `packages/cli/src/__tests__/init-workflow-template.test.ts` (existing, extend)      | R3.* — workflow template content assertions.                                                  |
| `packages/cli/src/__tests__/commands.test.ts` (existing, extend)                    | Add `parsePasswordAllowArgs` / `parsePasswordDisallowArgs` cases.                             |
| `packages/worker/src/__tests__/migration-0003.test.ts` (new)                        | R11.11, R11.12 — apply 0003 against a 0001+0002 DB with seeded rules; verify default=1 backfill and re-apply behavior. |
| `packages/worker/src/__tests__/rules-self-password-default.test.ts` (new)           | R11.5, R11.6, R11.7, R11.8, R11.9 + Property 8 — rule create/list with the new field, and stamping at auto-approval. |
| `packages/cli/src/__tests__/rules-self-password-flag.test.ts` (new)                 | R11.1, R11.2, R11.3, R11.4, R11.10 — `--self-set-password` parser variants and `formatRulesTable` SELF-PWD column. |
| `README.md` grep test (extend an existing readme test or add to commands.test.ts)   | R8.* — assert the new headings and command examples are present.                              |

### Test matrix from Requirement 9 (mapped to the planned files)

| R9 clause                                                                                            | Where covered                                  |
|------------------------------------------------------------------------------------------------------|------------------------------------------------|
| R9.1 four-state {field, flag} matrix on publish                                                      | `publish-self-password.test.ts`                |
| R9.2 response identical for allow=true vs allow=false when no password is sent                       | `publish-self-password.test.ts` (Property 6)        |
| R9.3 stored hash round-trips via `verifyPassword`                                                    | `publish-self-password.test.ts` (Property 4)        |
| R9.4 CLI: success / missing-creds / malformed-arg for both subcommands                               | `password-allow.test.ts`                       |
| R9.5 CLI: appends `password` iff env is non-empty                                                    | `publish-password-env.test.ts` (Property 1)       |
| R9.6 CLI: no command logs the password value at any verbosity                                        | `publish-password-env.test.ts` (Property 2)       |

### What we explicitly do NOT test with PBT

- The matrix in R6 (5 deterministic cells) → parameterized example tests, not PBT. 100 iterations of identical state add nothing.
- The migration → integration test, not PBT. Schema changes are deterministic.
- The CLI dispatch routing → example tests for {allow, disallow, set, garbage} subcommands.

## Migration Safety

The 0002 and 0003 migrations are the only schema changes. Live D1 instances already running 0001 must accept these migrations without downtime or data loss.

### Application

- Migrations are appended to `packages/worker/migrations/` as `0002_repo_owner_password_optin.sql` and `0003_rule_self_password_default.sql`. D1's `wrangler d1 migrations apply` runs migrations in lexicographic filename order and tracks applied migrations in its internal meta table; only new files are executed.
- `ALTER TABLE ... ADD COLUMN ... DEFAULT <n> NOT NULL` is a metadata-only change in SQLite for both 0002 and 0003. No row rewriting occurs. Existing reads see the column default for the new column virtually until a row is updated.
- Applying either migration to a freshly-deployed instance (no existing rows) and to an instance with thousands of rows behaves identically.
- 0003 specifically only touches `auto_approval_rules`. It never reads or writes `repos`, so R11.6 (no retroactive modification of existing repo rows) is enforced trivially by the migration's scope.

### Operator workflow

The operator's existing deploy step is `nrdocs deploy` (or `wrangler deploy` + migrations). The recommended order:

1. Deploy the new Worker code that knows how to read and write `allow_repo_owner_password`. (The new column doesn't exist yet, but reads coerce missing → `false`, and the new code writes only when explicitly invoked via the new endpoints.)
2. Run `wrangler d1 migrations apply` to add the column.

Deploying in this order is safe because:
- Step 1 alone does not regress: the existing flow never touches the new column. The new endpoints are not yet reachable because the new routes only exist in the new code.
- Between step 1 and step 2 the new column does not exist; the `setSelfPasswordAllowFlag` write would fail with a SQL error. This is acceptable because in step 1 no operator can reach the new endpoints anyway (they are released together with the migration). If the operator does invoke them in this window, they get a 500 — not a security issue.

The reverse order (migrate first, then deploy) is also safe: step 1 alone leaves an unused column, which is fine.

### Rollback

Rolling forward then rolling back the worker without rolling back the schema is safe: the unused column simply takes up a few bytes per row. Rolling back the schema (`ALTER TABLE repos DROP COLUMN ...`) is supported on SQLite 3.35+ but is **not** part of normal operation. If the operator needs to revoke the feature globally, the supported path is `nrdocs password disallow OWNER/REPO` for each affected repo.

### Idempotence under partial application

If the migration is applied twice (manually), SQLite returns `duplicate column name` and exits non-zero. No rows are modified between the parse error and the abort, so the schema is unchanged (R1.5, R11.12).

## Security Notes

The threat model for this feature has three high-priority concerns:

1. **No plaintext password in any sink.**
   - The Worker hashes via the existing PBKDF2 pipeline before storage; the plaintext is never written to D1, never stored on R2, never logged. The handler does not call `console.log(passwordRaw)`, and the existing structured logger (none, currently — it's `console.error` on unhandled errors only) does not have a hook that would receive it.
   - The CLI reads `process.env.NRDOCS_DOCS_PASSWORD` once and binds it to a local variable that is appended to FormData and then released. No `console.*` call sees that variable. This is enforced by **Property 2** as a property test.
   - Errors carrying an HTTP request body never include the field. The existing `formatPublishFailure` formatter only consumes structured `error.code` / `error.message` / response headers — it does not echo the request body.
2. **Response indistinguishability.**
   - When **no** `password` field is sent, the publish response is byte-for-byte identical regardless of the allow flag. This is **Property 6**. The flag value itself is not in the response (the response only describes approval state, access mode, build id, and serving status — not internal flags).
   - When the password field **is** sent and rejected for length, the response is `400 INVALID_PASSWORD`. This response shape **does** differ from the no-field case, but only when the repo is opted in. A repo owner exploring whether their repo is opted in would already need a length-invalid value to learn anything from this difference, and length-validity is independently knowable. We accept this because Q2 confirmed the user wants explicit length feedback over silence.
3. **Operator authority preserved.**
   - The allow flag is only writable through endpoints gated by `requireOperator`. The existing `requireOperator` uses constant-time comparison against `OPERATOR_TOKEN`.
   - A repo owner with self-service set cannot change their own access mode away from `password` once flipped. The existing `nrdocs access set` is operator-only. The matrix in §Architecture deliberately does not let `public` or `disabled` repos be silently flipped to `password` by an upload (the only auto-flip is `none → password`, which is a no-op security-wise — `none` already means "not serving").

Other notes:

- **TLS**: the publish request already runs over HTTPS to the Worker. The new field rides the same channel.
- **Audit completeness**: hard-fail on audit-write failure (Q3) ensures we never have a stored credential without a log entry for it. The cost is operator visibility into D1 outages, which is acceptable.
- **Replay**: the password field is part of the OIDC-authenticated publish request, so an attacker who replays the request (without the GitHub OIDC token) cannot succeed. An attacker who steals the GitHub Actions runner can already publish; this feature does not widen that surface.
- **Length bounds**: bounds are `DEFAULT_MIN_PASSWORD_LENGTH=8` and `DEFAULT_MAX_PASSWORD_LENGTH=128`, matching the existing operator-set policy. No DoS surface (PBKDF2 with 100k iterations on a 128-char input is bounded work).

## Open questions raised during design

None. The five locked decisions (Q1–Q5) cover the surface, and the design composes cleanly on top of the existing publish handler, repos handler family, and CLI command dispatch. If the user wants to extend this later (e.g., per-environment NRDOCS_DOCS_PASSWORD names, or a CLI-side opt-in confirmation prompt), those are additive and out of scope here.
