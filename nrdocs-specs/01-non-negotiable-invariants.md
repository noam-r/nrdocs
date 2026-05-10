# nrdocs Non-Negotiable Invariants

This document defines the rules that every implementation decision must obey.

If another spec conflicts with this file, this file wins.

## 1. Protected-First by Default

All repos are protected by default.

A repo owner publishing docs must never make those docs public by default.

The default state after first publish is:

```text
artifact uploaded
repo discovered
approval pending
access none
serving disabled
anonymous requests return 404
```

There must be no implementation path where a newly discovered repo becomes publicly accessible unless an explicit operator policy allows it.

## 2. Repo Owners Can Upload Artifacts, Not Grant Visibility

A repo owner can cause docs artifacts to be built and uploaded.

A repo owner cannot decide that those artifacts are visible to readers.

Only operator policy can make docs visible.

Allowed repo-owner outcome:

```text
latest successful artifact exists
```

Disallowed repo-owner outcome:

```text
site becomes public or password-accessible by repo config alone
```

## 3. Public Access Requires Explicit Operator Policy

Public access must always be the result of an explicit operator-controlled decision.

Valid ways for a repo to become public:

1. Manual operator command:

```bash
nrdocs approve OWNER/REPO --access public
```

2. Matching auto-approval rule:

```yaml
auto_approval:
  rules:
    - match: OWNER/REPO
      access: public
```

Invalid ways for a repo to become public:

1. Repo config requests public access.
2. Public is the system default.
3. Approval exists but access mode is missing.
4. Upload endpoint accepts access mode from the request body and applies it as effective access.

## 4. Approval Must Include an Effective Access Mode

Approval is not just a boolean.

When a repo is approved, the operator policy must determine the effective access mode.

Valid effective access modes for approved repos:

```text
public
password
```

Invalid approved state:

```text
approval_state = approved
access_mode = none
```

Pending, unknown, and disabled repos must have no serveable access mode.

## 5. Repo Config Is Advisory for Access

Repo config may request an access mode, for example:

```yaml
site:
  requested_access: password
```

This is advisory only.

The effective access mode is controlled by operator policy.

The repository must not be able to override the operator's decision by changing committed config.

## 6. Publishing and Serving Are Separate Phases

Publishing artifacts and serving artifacts are separate phases.

Publishing means:

```text
build docs
upload artifacts
store latest successful build metadata
```

Serving means:

```text
resolve request
check operator policy
check access/session if needed
serve artifact if allowed
```

Publishing must not depend on approval.

Serving must depend on approval and access policy.

## 7. Approval and Access Changes Must Not Require a New Push

Changing approval state or access mode must never require the repo owner to push again.

If a repo has already uploaded a successful artifact, then approving that repo must make the existing artifact serveable immediately according to the selected access mode.

Disallowed sequence:

```text
publish → pending → approve → require repo owner to republish
```

Required sequence:

```text
publish → pending → approve → serve existing artifact
```

## 8. Pending Approval Is Not a Publish Failure

A GitHub Action publish run must succeed when docs are built and uploaded successfully, even if the repo is pending approval.

Pending approval is a status, not an error.

The GitHub Action should fail only for real failures, such as:

1. Invalid config.
2. Build failure.
3. OIDC verification failure.
4. Artifact upload failure.
5. API failure.
6. Artifact validation failure.

## 9. Serverless-Only Runtime

nrdocs must not require a persistent server.

The implementation must not require:

1. A long-running backend server.
2. A persistent VM.
3. A persistent container.
4. A background daemon.
5. In-memory state required for correctness.

Allowed components:

1. Cloudflare Workers.
2. Cloudflare R2.
3. Cloudflare D1.
4. Cloudflare KV if needed for cache/config.
5. GitHub Actions.
6. GitHub OIDC.

Any background-style behavior must either be avoided or implemented using managed serverless primitives without requiring a persistent server.

## 10. Builds Run in GitHub Actions

nrdocs infrastructure must not clone private repositories.

nrdocs infrastructure must not execute arbitrary repository code.

Build execution happens in GitHub Actions.

The nrdocs serverless API receives generated static artifacts only.

This is required for security, privacy, and operational simplicity.

## 11. Publish Identity Comes from Verified GitHub OIDC Claims

The publish endpoint must verify a GitHub OIDC token.

The server must derive repo identity from verified token claims.

The request body must not be trusted for repo identity.

Bad:

```json
{
  "repo": "OWNER/REPO"
}
```

Good:

```text
repo identity = verified OIDC claim `repository`
stable repo identity = verified OIDC claim `repository_id`
```

If the request body repo identity conflicts with the verified OIDC claims, the request must be rejected or the body value must be ignored.

## 12. Stable Repo Identity Must Be Used for Security Decisions

The immutable GitHub repository ID should be the primary security identity.

The display identity is:

```text
OWNER/REPO
```

The display identity is useful for CLI output, routing, and operator commands, but it may change when a repo is renamed.

If a repo is transferred to a different owner or namespace, the implementation must be conservative. It should require operator review or re-evaluate approval policy.

## 13. R2 Buckets Must Be Private

R2 buckets containing docs artifacts must not be publicly exposed.

Readers must never access R2 objects directly.

All docs serving must go through the Worker access-control path:

```text
request → resolve repo/path → check policy → check access/session → fetch private artifact → return response
```

Direct artifact URLs must not be public.

## 14. Pending, Unknown, Disabled, and Unapproved Repos Must Not Leak to Anonymous Readers

Anonymous readers must receive a 404 response for:

1. Unknown repo.
2. Pending repo.
3. Disabled repo.
4. Rejected repo.
5. Unapproved repo.
6. Repo with no serveable artifact.

The system may show richer status to authenticated operators or to the publishing GitHub Action response, but not to anonymous readers.

## 15. Approval Is Metadata-Only

Approving a repo must only update metadata/state.

Approval must not require:

1. Rebuilding docs.
2. Re-uploading artifacts.
3. Copying artifacts to another bucket.
4. Generating challenge files.
5. Asking the repo owner to push again.

The Worker should serve or block the latest successful artifact based on metadata.

## 16. Access Changes Are Metadata-Only

Changing a repo from public to password, password to public, or enabled to disabled must only update metadata/state.

Access changes must not require artifact modification.

Password setup must not require repo owner participation or republishing.

## 17. Auto-Approval Rules Must Specify Access

Every auto-approval rule must include an access mode.

Valid:

```yaml
auto_approval:
  rules:
    - match: noam-r/*
      access: password
```

Invalid:

```yaml
auto_approval:
  rules:
    - match: noam-r/*
```

A rule that approves a repo must also define whether the repo is approved as public or password-protected.

## 18. Auto-Approval Rules Approve Repo Identity Only

Auto-approval rules grant visibility according to operator policy. They do not grant broader platform privileges.

A matching auto-approval rule must not allow the repo owner to control:

1. Security headers.
2. Cookies.
3. Redirects outside allowed paths.
4. Custom domains.
5. Global configuration.
6. Password material.
7. Operator-managed access policy.

## 19. Passwords Are Operator-Managed in MVP

For MVP, password-protected docs use operator-managed passwords.

The repo owner must not need to push a password challenge, set a password in GitHub, or republish after password setup.

Password material must not be stored in docs artifacts.

Only password hashes or password-derived verifier values may be stored server-side.

## 20. Generated Docs Are Untrusted Content

Generated docs artifacts must be treated as untrusted content.

The implementation must defend against cross-site scripting, path traversal, MIME confusion, and unsafe headers.

For MVP, raw HTML must be disabled by escaping raw HTML, and arbitrary repo-provided JavaScript must not be supported. A later explicit spec may introduce sanitized HTML only with strong isolation and dedicated tests.

Repos must not be allowed to set dangerous response headers such as:

1. `Set-Cookie`
2. `Content-Security-Policy`
3. `Access-Control-Allow-Origin`
4. `Location`
5. `X-Frame-Options`

Security headers are controlled by the platform.

## 21. Routing Must Be Safe and Deterministic

For MVP, docs routes should be deterministic and repo-based:

```text
/OWNER/REPO/
```

Repo owners must not be able to claim arbitrary top-level paths such as:

```text
/admin
/login
/api
```

Custom slugs and custom domains are out of MVP scope unless set by operator policy in a later spec.

## 22. Implementation Must Prefer Boring, Explicit State

The implementation should avoid hidden state transitions.

State should be inspectable through operator commands and API responses.

A repo should clearly report:

```text
build state
approval state
effective access mode
latest successful build
serving status
```

## 23. Audit-Sensitive Actions Must Be Logged

The system must log operator actions that affect visibility or access.

Audit events should include:

1. Repo approval.
2. Repo disablement.
3. Access mode changes.
4. Password changes.
5. Auto-approval rule creation/update/deletion.
6. Publish events.

Audit logs should include actor, action, target, timestamp, and relevant metadata.

## 24. Unknown Must Be Safe

When the implementation is uncertain, the safe behavior is to not serve docs.

Examples:

1. Missing repo metadata → 404.
2. Missing access mode → 404.
3. Missing latest artifact → 404 or no-docs response only to authorized operator.
4. Invalid password config → do not serve protected docs.
5. OIDC verification ambiguity → reject publish.
6. Auto-approval rule ambiguity → do not auto-approve.

## 25. These Invariants Are Test Requirements

Every invariant in this document must be reflected in tests.

At minimum, the test suite must include an access-control matrix proving that unknown, pending, disabled, and unapproved repos are not visible to anonymous readers.
