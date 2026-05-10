# nrdocs User Flows

This document describes the intended product behavior from the perspective of repo owners, operators, and readers.

Implementation details are intentionally limited here. API details, data models, and security internals belong in later specs.

## Actors

### Repo Owner

A repo owner maintains a private GitHub repository and wants to publish documentation from that repo.

The repo owner can:

1. Initialize nrdocs in the repo.
2. Commit docs and config.
3. Push changes.
4. See publish status in GitHub Actions.

The repo owner cannot:

1. Make docs visible by themselves.
2. Set effective public/password access.
3. Bypass operator approval.
4. Control platform security policy.

### Operator

An operator administers the self-hosted nrdocs installation.

The operator can:

1. List discovered repos.
2. Approve repos.
3. Disable repos.
4. Choose effective access mode.
5. Set passwords.
6. Add/remove auto-approval rules.
7. Inspect audit/status information.

### Reader

A reader visits the generated docs site.

The reader can:

1. Read approved public docs.
2. Read approved password-protected docs after successful password/session validation.

The reader cannot:

1. Discover pending repos.
2. Discover disabled repos.
3. Read unapproved docs.
4. Access R2 artifacts directly.

## Flow 1: Repo Owner Initializes Docs

### Goal

Create the minimal files needed to publish docs artifacts from a private GitHub repo.

### Command

```bash
nrdocs init
```

### Expected Interaction

The CLI asks simple product-level questions:

```text
Docs directory? [docs]
Site title? [Repo name Docs]
nrdocs API URL? [from environment or deployment default]
```

The CLI should avoid exposing internal concepts like D1, R2, Workers, project IDs, repository UUIDs, or approval tokens.

The default interactive flow must not ask for requested access. Effective access is controlled by the operator. If a repo owner wants to provide an advisory access hint, that must be an advanced flag or explicit config edit, for example `nrdocs init --requested-access password`.

### Files Created

Recommended MVP output:

```text
docs/
  nrdocs.yml
  index.md
.github/
  workflows/
    nrdocs.yml
```

### Important Behavior

The generated config may include a requested access mode, but that request is advisory only.

Example:

```yaml
site:
  title: My Project Docs
  requested_access: password
```

This does not make the site password-protected by itself. The operator still controls the effective access mode.

### Success Output

```text
nrdocs initialized.

Next step:
  git add docs .github/workflows/nrdocs.yml
  git commit -m "Add nrdocs documentation"
  git push

After push, docs artifacts will be uploaded.
An operator must approve the repo before readers can access the site.
```

## Flow 2: First Publish from an Unknown Repo

### Goal

Upload docs artifacts from a repo that has never been seen by nrdocs before.

### Trigger

The repo owner pushes to GitHub.

The generated GitHub Action runs.

### Expected GitHub Action Steps

```text
1. Checkout repository.
2. Build/render docs artifacts.
3. Obtain GitHub OIDC token.
4. Call nrdocs publish.
5. Upload artifacts.
6. Receive status.
7. Print summary.
```

### Required Outcome

If build and upload succeed, the GitHub Action must succeed even if the repo is pending approval.

The repo should end in this state:

```text
build: ready
approval: pending
access: none
serving: not visible
```

### Example Action Summary

```text
nrdocs publish complete.

Repo:    OWNER/REPO
Build:   ready
Status:  awaiting operator approval
URL:     https://docs.example.com/OWNER/REPO/

The docs artifacts were uploaded successfully.
The site is protected-first and is not visible to readers until an operator approves it.
```

### Reader Behavior Before Approval

Anonymous request:

```text
GET /OWNER/REPO/
```

Response:

```text
404 Not Found
```

The response must not reveal that the repo exists or is pending approval.

## Flow 3: Manual Operator Approval as Password-Protected

### Goal

Approve an uploaded repo so readers can access it behind a password.

### Commands

```bash
nrdocs repos
nrdocs approve OWNER/REPO --access password
```

If no password credential exists for the repo, the CLI must prompt to set one during the approval flow. The separate command `nrdocs password set OWNER/REPO` remains available for later rotation, but it is not required for the common approval path.

The password must not be exposed in shell history by default. A safe UX is interactive input:

```text
No password is configured for this repo.
Set password now? [Y/n]
Enter password:
Confirm password:
```

### Required Outcome

Approval and password setup are metadata-only operations.

The repo owner does not need to push again.

The existing latest successful artifact becomes serveable immediately after approval and password setup.

### Resulting State

```text
build: ready
approval: approved
access: password
serving: password required
```

### Reader Behavior

Anonymous request:

```text
GET /OWNER/REPO/
```

Response:

```text
Password required page or challenge
```

After valid password/session:

```text
200 OK
```

## Flow 4: Manual Operator Approval as Public

### Goal

Approve an uploaded repo so readers can access it publicly.

### Command

```bash
nrdocs approve OWNER/REPO --access public
```

### Required Outcome

Public access is enabled only because the operator explicitly selected public access.

The repo owner does not need to push again.

The existing latest successful artifact becomes serveable immediately.

### Resulting State

```text
build: ready
approval: approved
access: public
serving: public
```

### Reader Behavior

Anonymous request:

```text
GET /OWNER/REPO/
```

Response:

```text
200 OK
```

## Flow 5: Auto-Approval by Namespace

### Goal

Automatically approve repos from trusted namespaces with an explicit access mode.

### Operator Setup

```bash
nrdocs rules add noam-r/* --access password
```

### Repo Owner Action

A matching repo owner publishes docs from:

```text
noam-r/repoA
```

### Required Outcome

Because `noam-r/repoA` matches `noam-r/*`, the repo is automatically approved with the access mode defined by the rule.

The repo config does not determine effective access.

### Example Publish Summary

```text
nrdocs publish complete.

Repo:    noam-r/repoA
Build:   ready
Status:  auto-approved
Access:  password
URL:     https://docs.example.com/noam-r/repoA/
```

### Important Constraint

Auto-approval rules must include access mode.

Allowed:

```bash
nrdocs rules add noam-r/* --access password
```

Disallowed:

```bash
nrdocs rules add noam-r/*
```

## Flow 6: Auto-Approval by Exact Repo

### Goal

Automatically approve only one specific repo.

### Operator Setup

```bash
nrdocs rules add noam-r/repoA --access public
```

### Matching Behavior

```text
noam-r/repoA    matches
noam-r/repoB    does not match
other/repoA     does not match
```

### Required Outcome

Only the exact repo is auto-approved.

The approved repo receives the access mode specified by the rule.

## Flow 7: Later Push from an Approved Repo

### Goal

Publish updated docs after a repo has already been approved.

### Trigger

Repo owner pushes new docs changes.

### Required Outcome

The GitHub Action builds and uploads a new artifact.

Approval state and access mode are preserved.

If the repo is approved public, the new artifact becomes public immediately after successful upload.

If the repo is approved password-protected, the new artifact becomes available behind the existing password/session policy immediately after successful upload.

### Example State Before Push

```text
build: ready
approval: approved
access: password
latest artifact: build_123
```

### Example State After Successful Push

```text
build: ready
approval: approved
access: password
latest artifact: build_124
```

No operator action is needed for normal updates.

## Flow 8: Later Push from a Pending Repo

### Goal

Allow a repo owner to keep publishing docs while waiting for approval.

### Trigger

Repo owner pushes another docs update before operator approval.

### Required Outcome

The new artifact is uploaded and becomes the latest successful artifact.

The repo remains pending and invisible.

### Resulting State

```text
build: ready
approval: pending
access: none
latest artifact: new build
serving: 404 to anonymous readers
```

When the operator later approves, the most recent successful artifact becomes serveable.

## Flow 9: Operator Disables an Approved Repo

### Goal

Remove visibility from a previously approved repo.

### Command

```bash
nrdocs disable OWNER/REPO
```

### Required Outcome

Disablement is metadata-only.

Artifacts may remain stored, but readers cannot access them.

### Resulting State

```text
build: ready
approval: disabled
access: none
serving: disabled
```

### Reader Behavior

Anonymous request:

```text
GET /OWNER/REPO/
```

Response:

```text
404 Not Found
```

The response must not reveal whether the repo was disabled, pending, unknown, or unapproved.

## Flow 10: Operator Changes Access from Password to Public

### Goal

Change an approved repo from password-protected to public.

### Command

```bash
nrdocs access set OWNER/REPO public
```

### Required Outcome

The change is metadata-only.

The repo owner does not need to push again.

The current latest successful artifact becomes publicly serveable immediately.

### Required Safety

Only an authenticated operator can perform this action.

The action must be audit-logged.

## Flow 11: Operator Changes Access from Public to Password

### Goal

Change an approved repo from public to password-protected.

### Commands

```bash
nrdocs access set OWNER/REPO password
nrdocs password set OWNER/REPO
```

### Required Outcome

The change is metadata-only.

The repo owner does not need to push again.

The public site immediately stops being public and requires password/session validation.

### Reader Behavior

Before change:

```text
GET /OWNER/REPO/ → 200 OK
```

After change:

```text
GET /OWNER/REPO/ → password required
```

## Flow 12: Publish Failure Due to Invalid Docs Config

### Goal

Fail correctly when repo docs config is invalid.

### Trigger

GitHub Action runs with invalid `nrdocs.yml`.

### Required Outcome

The GitHub Action fails.

No new successful artifact should be marked as latest.

The previous successful artifact, if any, remains the latest serveable artifact.

### Example Action Summary

```text
nrdocs publish failed.

Reason: invalid docs config
File: docs/nrdocs.yml
Problem: site.title must be a string

No new artifact was published.
```

## Flow 13: Publish Failure Due to Build Error

### Goal

Fail correctly when docs generation fails.

### Required Outcome

The GitHub Action fails.

No new successful artifact should be marked as latest.

The previous successful artifact, if any, remains active.

Approval and access state are unchanged.

## Flow 14: Publish Failure Due to OIDC/Auth Error

### Goal

Reject unauthenticated or incorrectly authenticated publish attempts.

### Required Outcome

The publish request fails.

No artifact is accepted.

No repo is created or updated unless the implementation explicitly records rejected attempts in audit logs.

The Action fails with a clear error.

Example:

```text
nrdocs publish failed.

Reason: GitHub OIDC token could not be verified.
```

## Flow 15: Reader Requests Unknown Repo

### Goal

Avoid leaking repo existence.

### Request

```text
GET /unknown-owner/unknown-repo/
```

### Required Response

```text
404 Not Found
```

The response should be indistinguishable from pending, disabled, and unapproved repos.

## Flow 16: Reader Requests Pending Repo

### Goal

Avoid leaking pending private repo docs.

### Request

```text
GET /OWNER/REPO/
```

Where repo exists and has uploaded artifacts but is pending approval.

### Required Response

```text
404 Not Found
```

The response must not say:

```text
awaiting approval
pending
private repo exists
```

## Flow 17: Operator Lists Repos

### Goal

Give operators a clear overview of discovered repos and their serving status.

### Command

```bash
nrdocs repos
```

### Example Output

```text
Repo                 Build    Approval   Access     Serving
noam-r/repoA         ready    pending    none       no
noam-r/repoB         ready    approved   password   yes
noam-r/repoC         failed   approved   public     no latest build
noam-r/repoD         ready    disabled   none       no
```

### Required Behavior

This command is operator-authenticated.

It may reveal pending/private repo existence because the operator is trusted.

## Flow 18: Repo Owner Checks Status Locally (Future)

### Goal

Allow a repo owner to see the status of their repo without understanding internals.

### MVP Decision

Do not implement unauthenticated local repo-owner status in MVP. Repo owners receive status through the GitHub Action summary generated by `nrdocs publish`. Operator status is available through `nrdocs status OWNER/REPO`.

### Future Command

```bash
nrdocs status
```

### Expected Output

For pending repo:

```text
Repo:    OWNER/REPO
Build:   ready
Status:  awaiting operator approval
URL:     https://docs.example.com/OWNER/REPO/

Your docs artifacts are uploaded.
They are not visible to readers yet.
```

For approved public repo:

```text
Repo:    OWNER/REPO
Build:   ready
Status:  approved
Access:  public
URL:     https://docs.example.com/OWNER/REPO/
```

For approved password repo:

```text
Repo:    OWNER/REPO
Build:   ready
Status:  approved
Access:  password
URL:     https://docs.example.com/OWNER/REPO/
```

For MVP, repo-owner status is provided by the GitHub Action summary only. Local unauthenticated repo-owner `nrdocs status` must not be implemented unless a later spec defines a complete authentication model. Operators use `nrdocs status OWNER/REPO` with operator authentication.

## Flow 19: Repo Rename

### Goal

Handle GitHub repo renames safely.

### Expected Behavior

The stable GitHub repository ID remains the primary identity.

If `OWNER/REPO` changes but the GitHub repository ID is the same, the system may update display identity and route if safe.

The conservative MVP behavior is:

```text
repo identity changed display name → require operator review or clearly log the change
```

For MVP, the new owner/repo route may become active after verified publish/update, and old owner/repo paths must return 404. Repo aliases and old-path redirects are future work.

## Flow 20: Repo Transfer

### Goal

Handle transfer of a repo to another owner/namespace safely.

### Expected Behavior

Repo transfer is security-sensitive.

If repository owner changes, the system should not blindly preserve approval without operator review unless an explicit spec says otherwise.

Conservative MVP behavior:

```text
mark repo as pending transfer review
stop serving until operator re-approves or confirms
```

## Universal UX Rules

### Repo Owner UX

Repo owner messages should be simple and reassuring.

Good:

```text
Docs artifacts uploaded successfully. Awaiting operator approval.
```

Bad:

```text
Repo record pending in D1; R2 object stored but Worker route disabled.
```

### Operator UX

Operator messages should expose enough state to make safe decisions.

Good:

```text
Repo noam-r/repoA has uploaded docs and is pending approval.
Approve as public or password-protected.
```

### Reader UX

Reader messages must not leak private repo state.

Unknown, pending, disabled, and unapproved repos should all look like 404 to anonymous readers.

## Summary of Required Flow Properties

1. Repo owner publishes once.
2. Artifact upload can succeed before approval.
3. Pending approval is not a GitHub Action failure.
4. Operator approval makes existing artifacts visible immediately.
5. Password setup does not require repo owner action.
6. Public access is never default.
7. Auto-approval rules must specify access mode.
8. Anonymous readers cannot distinguish unknown, pending, disabled, or unapproved repos.
9. All flow-critical state lives in serverless storage, not a persistent server.
