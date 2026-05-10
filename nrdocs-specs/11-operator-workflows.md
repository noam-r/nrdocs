# nrdocs Operator Workflows Specification

## Purpose

This document specifies the workflows available to operators of a self-hosted nrdocs installation.

Operators are trusted administrators. They control approval, effective access mode, passwords, auto-approval rules, and deployment policy.

Repo owners publish artifacts. Operators decide whether and how those artifacts are served.

## Operator Responsibilities

Operators control:

```text
- Which repos may be served
- Whether approved repos are public or password-protected
- Passwords for password-protected repos
- Auto-approval rules
- Disabling repos
- Reviewing pending repos
- Reviewing audit events
```

Operators do not edit repo source content.

Operators do not need a persistent server.

The operator CLI calls authenticated Cloudflare Worker API endpoints.

## Operator Authentication

Operator commands require operator API authentication.

For normal local usage, credentials are resolved from the local CLI config file saved by `nrdocs deploy` or `nrdocs auth login`.

For CI and automation, environment variables are supported:

```bash
NRDOCS_API_URL=https://docs.example.com
NRDOCS_OPERATOR_TOKEN=...
```

Explicit flags are also supported:

```bash
nrdocs repos --api-url https://docs.example.com --token ...
```

The operator token must be validated by the Worker API.

Operator tokens must never be stored in repo owner repositories.

## First Deployment Workflow

The initial deployment flow is defined in detail in [`06-cli-spec.md`](./06-cli-spec.md) under the `nrdocs deploy` command, but the operator experience should feel like:

```bash
nrdocs deploy
```

Manual Wrangler use is an advanced/debugging escape hatch only. The supported MVP deployment path is `nrdocs deploy`.

After deployment, the operator should be able to verify:

```bash
nrdocs doctor --operator
```

Expected checks:

```text
- Worker API reachable
- D1 binding available
- R2 binding available
- Operator token accepted
- Base docs URL configured
- Security defaults present
```

## Connecting from Another Machine

An operator with a valid operator token can configure the local CLI on a new machine:

```bash
nrdocs auth login
```

The CLI prompts for API URL and token, validates them, and saves a local profile.

After login, operator commands work without environment variables:

```bash
nrdocs repos
nrdocs approve noam-r/repoA --access password
```

## CI and Automation

For CI or scripts, environment variables remain supported:

```bash
NRDOCS_API_URL=https://docs.example.com \
NRDOCS_OPERATOR_TOKEN=nrdocs_op_... \
nrdocs repos
```

Explicit flags may also be used:

```bash
nrdocs repos --api-url https://docs.example.com --token nrdocs_op_...
```

Environment variables and flags take priority over local config.

## Listing Repos

Command:

```bash
nrdocs repos
```

Default output should prioritize repos requiring operator attention.

Example:

```text
Repo                 Build      Approval   Access     URL
noam-r/repoA         ready      pending    none       hidden
noam-r/repoB         ready      approved   password   https://docs.example.com/noam-r/repoB/
noam-r/repoC         failed     pending    none       hidden
```

Useful filters:

```bash
nrdocs repos --pending
nrdocs repos --approved
nrdocs repos --disabled
nrdocs repos --owner noam-r
```

## Inspecting a Repo

Command:

```bash
nrdocs status noam-r/repoA --operator
```

Expected output:

```text
Repo:        noam-r/repoA
GitHub ID:   123456789
Build:       ready
Latest SHA:  abc123
Approval:    pending
Access:      none
URL:         hidden until approved
Requested:   password
Created:     2026-05-07T12:00:00Z
Updated:     2026-05-07T12:05:00Z
```

If the repo is approved:

```text
URL: https://docs.example.com/noam-r/repoA/
```

## Manual Approval as Password-Protected

Command:

```bash
nrdocs approve noam-r/repoA --access password
```

Required behavior:

```text
- Set approval_state = approved.
- Set access_mode = password.
- Do not modify artifacts.
- Do not require new GitHub push.
- Write audit event.
```

If no password exists yet, the site should not become publicly readable. It should require password setup before successful reader access.

The CLI should warn:

```text
Approved noam-r/repoA with password access.
No password is configured yet.
Run: nrdocs password set noam-r/repoA
```

## Setting Password

Command:

```bash
nrdocs password set noam-r/repoA
```

The CLI should prompt without echoing:

```text
Enter password:
Confirm password:
```

Required behavior:

```text
- Send password securely over HTTPS to Worker API.
- Store only a password hash.
- Do not store plaintext password.
- Write audit event.
- Take effect immediately.
```

MVP also supports non-interactive mode:

```bash
nrdocs password set noam-r/repoA --from-stdin
```

Avoid command-line password flags because shell history can leak them.

Do not recommend:

```bash
nrdocs password set noam-r/repoA --password secret
```

## Manual Approval as Public

Command:

```bash
nrdocs approve noam-r/repoA --access public
```

Required behavior:

```text
- Set approval_state = approved.
- Set access_mode = public.
- Do not modify artifacts.
- Do not require new GitHub push.
- Write audit event.
```

This is a sensitive action.

The CLI should make public approval explicit:

```text
You are approving noam-r/repoA as PUBLIC.
Anyone with the URL will be able to read these docs.
```

MVP may require an explicit flag:

```bash
nrdocs approve noam-r/repoA --access public --yes
```

Interactive confirmation is acceptable for manual operator use.

## Changing Access Mode

Command:

```bash
nrdocs access set noam-r/repoA password
```

or:

```bash
nrdocs access set noam-r/repoA public
```

Required behavior:

```text
- Only authenticated operators may change access mode.
- Change takes effect immediately.
- Do not require new GitHub push.
- Do not modify artifacts.
- Write audit event.
```

If changing from public to password:

```text
- Existing public access stops immediately.
- Password access requires configured password/session validation.
```

If changing from password to public:

```text
- Public access starts immediately.
- Password credential may remain stored but unused.
```

## Disabling a Repo

Command:

```bash
nrdocs disable noam-r/repoA
```

Required behavior:

```text
- Set approval_state = disabled.
- Set access_mode = none or leave access mode ignored while disabled.
- Anonymous readers receive 404.
- Existing artifacts remain stored unless separately deleted.
- Future publishes from this repo are rejected before artifact validation or storage.
- Write audit event.
```

Disabling should take effect immediately.

## Re-Enabling a Disabled Repo

Command:

```bash
nrdocs approve noam-r/repoA --access password
```

or:

```bash
nrdocs approve noam-r/repoA --access public
```

Required behavior:

```text
- Move repo from disabled to approved.
- Set access mode explicitly.
- Serve latest successful artifact if one exists.
- Do not require new GitHub push.
```

## Auto-Approval Rules

Auto-approval rules allow trusted repo namespaces to become visible after publish without manual approval.

Rules must specify both match pattern and access mode.

Example:

```bash
nrdocs rules add 'noam-r/*' --access password
```

Example:

```bash
nrdocs rules add 'noam-r/public-docs' --access public
```

Required rule fields:

```text
- pattern
- access_mode
- enabled
- created_by
- created_at
```

Valid patterns:

```text
OWNER/*
OWNER/REPO
```

No arbitrary globbing in MVP beyond these forms.

## Listing Auto-Approval Rules

Command:

```bash
nrdocs rules list
```

Example output:

```text
ID        Pattern             Access     Enabled
rule_1    noam-r/*            password   yes
rule_2    noam-r/public-docs  public     yes
```

## Removing Auto-Approval Rules

Command:

```bash
nrdocs rules remove RULE_ID
```

Required behavior:

```text
- Disable or delete the rule.
- Write audit event.
- Do not automatically disable repos already approved by that rule.
```

Removing a rule affects future publishes/discoveries only unless a separate policy command is run.

## Auto-Approval Evaluation

When a repo publishes:

```text
1. Worker derives OWNER/REPO from verified GitHub OIDC.
2. Worker checks enabled auto-approval rules.
3. If a rule matches and repo is not disabled, set approval_state = approved.
4. Set access_mode to the rule's access mode.
5. Write audit event showing matched rule.
```

If multiple rules match, use the most specific rule.

Specificity order:

```text
1. OWNER/REPO
2. OWNER/*
```

Example:

```text
Rule A: noam-r/* -> password
Rule B: noam-r/public-docs -> public
Repo:   noam-r/public-docs
Result: public
```

## Public Access Safety

Public approval is always an explicit operator policy decision.

A repo must never become public merely because:

```text
- It published artifacts.
- It requested public access in nrdocs.yml.
- It matched an auto-approval rule that does not specify access.
```

All auto-approval rules must specify access.

Manual approval must specify access.

## Pending Repo Review

Pending repos are repos with uploaded artifacts but no approval policy.

Command:

```bash
nrdocs repos --pending
```

The operator should be able to inspect:

```text
- Repo identity
- GitHub repository ID
- Latest commit SHA
- Requested access
- Publish time
- Build status
- Artifact size
```

The operator does not need to rebuild or ask the repo owner to push again.

## Audit Log Review

Command:

```bash
nrdocs audit
```

Optional filters:

```bash
nrdocs audit --repo noam-r/repoA
nrdocs audit --actor operator@example.com
nrdocs audit --event approve_repo
```

Audit events should include:

```text
- Repo discovered
- Build uploaded
- Auto-approval matched
- Repo manually approved
- Repo disabled
- Access changed
- Password changed
- Auto-approval rule added/removed
```

Audit logs help verify that public exposure was intentional.

## Operator Status Messages

Operator commands should use precise status language.

Good:

```text
Approved noam-r/repoA with password access.
Docs are available after password authentication at https://docs.example.com/noam-r/repoA/
```

Good:

```text
Approved noam-r/repoA as public.
Docs are now publicly readable at https://docs.example.com/noam-r/repoA/
```

Bad:

```text
Published noam-r/repoA.
```

Reason: publishing is a repo-owner artifact upload action. Operators approve/enable access.

## Handling No Artifact

If an operator approves a repo that has no successful build, the command must reject with a clear error. Operators can use pre-approval rules for approval-before-publish behavior.

Recommended MVP behavior:

```text
Reject approval unless latest_successful_build_id exists.
```

Example:

```text
Cannot approve noam-r/repoA: no successful docs build exists yet.
```

Pre-approval before first publish must be represented as an auto-approval/pre-approval rule such as `OWNER/*` or `OWNER/REPO`, not as a fake approved repo row without a verified GitHub repository ID.

## Handling Repo Renames and Transfers

If GitHub OIDC reports the same `repository_id` with a changed `OWNER/REPO`, the system should update display identity carefully.

Recommended behavior:

```text
Rename within same owner: update display path and write audit event.
Transfer to different owner: mark pending_transfer_review or require reapproval.
```

Operator commands should show both stable GitHub repository ID and current `OWNER/REPO` when ambiguity exists.

## Reader-Facing Effects of Operator Actions

Operator action effects:

```text
Approve as public      -> next reader request can receive docs
Approve as password    -> next reader request receives password flow
Change to public       -> next reader request can receive docs without password
Change to password     -> next reader request requires password/session
Disable                -> next reader request receives 404
Set password           -> next password validation uses new password
```

No action requires a rebuild.

No action requires a new GitHub push.

## Serverless Constraint

All operator workflows must be request-driven.

Operator CLI commands call Worker API endpoints.

No operator workflow may require:

```text
- SSH into a server
- Running a daemon
- Direct database edits
- Direct R2 edits
- Persistent backend process
```

## MVP Operator Command Summary

Required MVP commands:

```bash
nrdocs deploy
nrdocs auth login
nrdocs auth status
nrdocs auth logout
nrdocs repos
nrdocs status OWNER/REPO --operator
nrdocs approve OWNER/REPO --access password|public
nrdocs disable OWNER/REPO
nrdocs access set OWNER/REPO password|public
nrdocs password set OWNER/REPO
nrdocs rules list
nrdocs rules add OWNER/* --access password|public
nrdocs rules add OWNER/REPO --access password|public
nrdocs rules remove RULE_ID
nrdocs static list
nrdocs static set TYPE PATH
nrdocs static remove TYPE
nrdocs doctor --operator
```

Optional MVP command:

```bash
nrdocs audit
```

## Acceptance Criteria

An implementation satisfies this spec if:

```text
- Operators can list pending repos.
- Operators can approve repos with explicit access mode.
- Operators can set password access without repo owner action.
- Operators can make a repo public only through explicit policy.
- Operators can disable repos immediately.
- Auto-approval rules require explicit access mode.
- Approval/access/password changes are metadata-only and take effect immediately.
- Operator commands do not require a persistent server.
- Public exposure is auditable.
```
