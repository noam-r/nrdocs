# nrdocs Test Plan

## Purpose

This document defines the required tests for rebuilding nrdocs from scratch.

The test plan is designed to protect the product's core guarantees:

1. Repos are protected by default.
2. Repo owners can upload docs artifacts but cannot make them visible.
3. Operators control approval and effective access.
4. Approval and access changes take effect immediately without another GitHub push.
5. The system is serverless and does not depend on persistent processes.
6. Artifacts are private and are served only through the Worker access-control path.

A build is not complete until the tests in this document pass.

## Related Specs

Read these first:

```text
00-product-brief.md
01-non-negotiable-invariants.md
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
```

## Test Categories

The implementation must include tests in these categories:

```text
unit tests
integration tests
Worker route tests
API tests
CLI tests
GitHub Action behavior tests
artifact storage tests
access-control tests
security tests
configuration tests
migration tests
end-to-end smoke tests
```

The most important tests are access-control and state-transition tests.

## Required Test Environments

The test suite should support at least two environments.

### Local Unit Test Environment

Used for pure logic:

```text
state transitions
policy evaluation
auto-approval matching
path normalization
config parsing
artifact manifest validation
password hashing/session helpers
OIDC claim validation helpers
```

This environment should not require real Cloudflare or GitHub services.

### Local Worker Integration Environment

Used for Worker/API behavior:

```text
D1-like test database
R2-like test storage
Worker request handling
operator API calls
publish API calls
reader serving path
```

The implementation may use Cloudflare's local development tooling or test doubles, but the behavior must match production semantics.

## Critical Invariants to Test

Every release must test these invariants explicitly.

### Invariant 1: Unknown Repos Are Not Visible

Given:

```text
No repo record exists.
```

When:

```text
Anonymous user requests /owner/repo/
```

Then:

```text
Return 404.
Do not reveal whether the repo exists on GitHub.
```

### Invariant 2: First Publish Does Not Make a Repo Public

Given:

```text
No repo record exists.
No auto-approval rule matches.
```

When:

```text
A valid GitHub Action publishes docs artifacts.
```

Then:

```text
Artifact is stored.
Repo record is created.
Build record is created.
Repo approval_state is pending.
Repo access_mode is none.
Anonymous reader receives 404.
GitHub Action receives a success response with pending status.
```

### Invariant 3: Approval Does Not Require Republish

Given:

```text
Repo has published artifacts.
Repo approval_state is pending.
Repo access_mode is none.
```

When:

```text
Operator approves repo with access public.
```

Then:

```text
No new build is required.
No new artifact upload is required.
Next anonymous request serves the latest successful artifact.
```

### Invariant 4: Password Access Does Not Require Republish

Given:

```text
Repo has published artifacts.
Repo is pending.
```

When:

```text
Operator approves repo with access password.
Operator sets password.
```

Then:

```text
No new build is required.
No new artifact upload is required.
Anonymous request receives password page or password challenge.
Request with valid password/session receives docs content.
```

### Invariant 5: Repo Config Cannot Make Docs Public

Given:

```text
Repo config requests public access.
No matching public auto-approval rule exists.
Operator has not manually approved public access.
```

When:

```text
Repo publishes docs artifacts.
```

Then:

```text
Repo is not public.
Effective access remains none or operator-selected mode.
Anonymous reader receives 404.
```

### Invariant 6: Auto-Approval Rule Controls Access Mode

Given:

```text
Auto-approval rule: noam-r/* with access password.
Repo: noam-r/repoA.
Repo config requests public access.
```

When:

```text
Repo publishes docs artifacts.
```

Then:

```text
Repo is approved automatically.
Effective access is password.
Effective access is not public.
```

### Invariant 7: Disabled Repos Never Serve

Given:

```text
Repo is approved public.
Artifact exists.
```

When:

```text
Operator disables repo.
```

Then:

```text
Anonymous reader receives 404.
Password/session does not bypass disabled state.
Future publishes must be rejected before artifact storage unless the operator re-enables the repo.
```

### Invariant 8: R2 Artifacts Are Never Publicly Addressable

Given:

```text
Artifact exists in storage.
```

Then:

```text
There is no direct public R2 URL used by the product.
All reads go through the Worker serving path.
Serving always evaluates repo state and access policy before returning artifact bytes.
```

## Access-Control Matrix

The implementation must have tests covering this matrix.

| Repo exists | Artifact exists | Approval state | Access mode | Password/session | Anonymous result | Authenticated reader result |
|---|---:|---|---|---|---|---|
| no | no | n/a | n/a | n/a | 404 | 404 |
| yes | no | pending | none | n/a | 404 | 404 |
| yes | yes | pending | none | n/a | 404 | 404 |
| yes | yes | approved | public | n/a | 200 | 200 |
| yes | yes | approved | password | none | password page/challenge | password page/challenge |
| yes | yes | approved | password | invalid | password page/challenge or 401 | password page/challenge or 401 |
| yes | yes | approved | password | valid | 200 | 200 |
| yes | yes | disabled | public | n/a | 404 | 404 |
| yes | yes | disabled | password | valid | 404 | 404 |
| yes | yes | rejected | none | n/a | 404 | 404 |

If the implementation uses `rejected`, it must behave like `disabled` for anonymous readers unless a separate operator-visible status endpoint is used. MVP does not include `rejected` as a separate approval state; use `disabled` instead.

## State Transition Tests

### Publish Creates Pending Repo

Input:

```text
valid GitHub OIDC claims
valid artifact package
no existing repo
no matching auto-approval rule
```

Expected:

```text
repo created
approval_state = pending
access_mode = none
latest_successful_build_id set
publish response status = pending
Action-compatible exit behavior = success
```

### Publish Auto-Approves Matching Repo

Input:

```text
valid GitHub OIDC claims for noam-r/repoA
auto-approval rule noam-r/* access password
valid artifact package
```

Expected:

```text
repo created or updated
approval_state = approved
access_mode = password
latest_successful_build_id set
publish response includes `approval_state = approved`, `access_mode = password`, and `serving.status = needs_password` if no password credential exists or `serving.status = live` if a password credential exists
```

### Manual Approval Sets Access

Input:

```text
pending repo with artifact
operator command approve OWNER/REPO --access public
```

Expected:

```text
approval_state = approved
access_mode = public
approved_at set
approved_by set
audit log entry written
```

### Manual Approval Without Access Is Rejected

Input:

```text
operator command approve OWNER/REPO
```

Expected:

```text
validation error
no state change
```

MVP approval requires an explicit access mode: `public` or `password`. There is no implicit safe default.

Recommended MVP behavior:

```text
Require explicit access in API.
CLI may default to password only if the help/output makes this obvious.
```

### Access Change Is Metadata-Only

Input:

```text
approved public repo with artifact
operator changes access to password
operator sets password
```

Expected:

```text
same latest_successful_build_id
same artifact_prefix
new access_mode = password
public anonymous request no longer serves content
valid password serves same artifact
```

### Republish Preserves Approval

Input:

```text
approved password repo with existing artifact
valid later publish from same GitHub repository_id
```

Expected:

```text
new build record created
latest_successful_build_id updated
approval_state remains approved
access_mode remains password
new docs are served after access validation
```

### Disabled Repo Republish Does Not Re-Enable

Input:

```text
disabled repo
valid publish from same GitHub repository_id
```

Expected:

```text
publish API returns `repo_disabled`
no new artifact is stored
latest_successful_build_id does not update
approval_state remains disabled
reader receives 404
GitHub Action fails with an explicit disabled-repo message
```

## GitHub OIDC Tests

The publish endpoint must test OIDC behavior using mocked or fixture tokens/claims.

### Valid OIDC Claims

Required validated claims include:

```text
issuer is GitHub's token issuer
audience matches configured nrdocs audience
repository is present
repository_id is present
repository_owner is present
ref is present
sha is present
workflow context is present where required
```

Expected:

```text
request accepted
repo identity derived from claims, not body
```

### Repo Identity Cannot Be Spoofed

Input:

```text
OIDC claims repository = noam-r/repoA
request body says repo = other/repoB
```

Expected:

```text
server ignores or rejects body repo identity
repo record affected is noam-r/repoA only
other/repoB is not created or modified
```

Recommended behavior:

```text
Reject requests that include conflicting identity fields.
```

### Invalid Audience Is Rejected

Expected:

```text
401 or 403
no artifact stored
no repo created
no build created
```

### Invalid Issuer Is Rejected

Expected:

```text
401 or 403
no side effects
```

### Missing Repository ID Is Rejected

Expected:

```text
400 or 401
no side effects
```

### Repo Transfer Requires Conservative Handling

Input:

```text
Existing repo has github_repository_id X and owner old-owner.
New publish has github_repository_id X and owner new-owner.
```

Expected:

```text
Implementation follows data-model spec.
Conservative recommended behavior:
  mark repo as pending_transfer_review or pending
  do not serve as public without operator review
  write audit log entry
```

If MVP does not support transfer detection yet, it must at least not create a conflicting public route silently.

## Operator Authentication Tests

Operator API endpoints must require operator authentication.

Test all operator endpoints:

```text
GET /api/repos
POST /api/repos/:owner/:repo/approve
POST /api/repos/:owner/:repo/disable
POST /api/repos/:owner/:repo/access
POST /api/repos/:owner/:repo/password
GET /api/auto-approval-rules
POST /api/auto-approval-rules
DELETE /api/auto-approval-rules/:id
GET /api/audit-log
```

For each endpoint:

```text
missing token -> 401
invalid token -> 401
valid token -> allowed if request is valid
```

Operator tokens must not be accepted on publish endpoints as a substitute for GitHub OIDC unless explicitly specified by the API spec for a future admin-only import flow.

## Publish API Tests

### Successful Pending Publish

Expected response shape:

```json
{
  "repo": "noam-r/repoA",
  "build": "ready",
  "approval": "pending",
  "access": "none",
  "serving": "not_visible",
  "url": "https://docs.example.com/noam-r/repoA/"
}
```

Field names must follow `05-api-spec.md`; the semantics must match.

### Successful Approved Public Publish

Expected:

```text
artifact stored
repo approved through rule or previous operator action
publish response says visible public
reader request returns 200
```

### Successful Approved Password Publish

Expected:

```text
artifact stored
repo approved through rule or previous operator action
publish response says password protected
reader without password cannot view content
reader with valid password can view content
```

### Invalid Artifact Package Fails

Expected:

```text
4xx response
no latest_successful_build_id update
old served artifact remains active, if one existed
```

### Upload Failure Does Not Corrupt Latest Build

Expected:

```text
failed build may be recorded as failed
latest_successful_build_id remains previous successful build
reader still receives previous successful docs if repo is approved
```

## Artifact Storage Tests

### Artifact Key Is Internal and Unguessable Enough

Expected:

```text
R2 key includes internal repo/build identifiers, not a public route alone.
No public URL is returned to readers or repo owners.
```

### Manifest Is Required

Expected:

```text
artifact without manifest is rejected
artifact with invalid manifest is rejected
manifest path traversal entries are rejected
```

### Path Traversal Is Rejected

Reject package entries such as:

```text
../secret
../../index.html
/a/b
C:\\temp\\file
nested/../../../escape
```

Expected:

```text
4xx response
no artifact promoted to latest successful build
```

### MIME Type Handling

Expected:

```text
.html served as text/html
.css served as text/css
.js repo artifact files rejected in MVP
.png served as image/png
unknown local asset file types rejected in MVP unless allowlist is extended
```

### Old Artifacts Are Not Served Accidentally

Given:

```text
build 1 exists
build 2 exists and is latest_successful_build_id
```

Expected:

```text
reader receives build 2 content
build 1 is not reachable through public route unless rollback feature is explicitly implemented
```

## Reader Serving Tests

### Route Resolution

Test these routes:

```text
/owner/repo/
/owner/repo/index.html
/owner/repo/page.html
/owner/repo/assets/style.css
/owner/repo/nested/page.html
```

Expected:

```text
routes resolve to the correct repo and artifact path
path normalization prevents traversal
missing files return 404
```

### Pending Route Privacy

Given:

```text
pending repo with artifact
```

Expected:

```text
GET /owner/repo/ returns 404 to anonymous readers
Response body does not say pending, private, exists, or awaiting approval
```

### Password Page Does Not Leak Content

Given:

```text
approved password repo
```

Expected for unauthenticated request:

```text
response does not include docs artifact content
response does not include sensitive repo metadata beyond what is necessary for login page
```

### Session Cookie Security

If password sessions use cookies, test:

```text
HttpOnly
Secure
SameSite=Lax or Strict
reasonable expiration
path scoped appropriately
```

### Security Headers

For docs responses, test required headers from `08-access-control-and-security.md`, such as:

```text
Content-Security-Policy
X-Content-Type-Options: nosniff
Referrer-Policy
X-Frame-Options or frame-ancestors CSP
```

Exact CSP depends on rendering policy.

## CLI Tests

CLI tests should verify behavior, output, and exit codes.

### `nrdocs init`

Expected:

```text
creates docs/nrdocs.yml
creates docs/index.md
creates .github/workflows/nrdocs.yml
uses safe defaults
never writes publish tokens
uses GitHub OIDC permissions in workflow
```

Generated workflow must include permissions similar to:

```yaml
permissions:
  contents: read
  id-token: write
```

### `nrdocs publish`

Expected in GitHub Action context:

```text
builds docs
packages artifact
requests OIDC token
calls publish API
prints status summary
exits 0 when repo is pending approval but publish succeeded
```

### `nrdocs publish` Outside GitHub Action

Expected:

```text
clear error explaining that publish requires GitHub Actions OIDC, unless local dry-run mode is used
nonzero exit
```

### `nrdocs status OWNER/REPO`

Expected:

```text
requires operator authentication
shows build, approval, access, serving status, and next action
unauthenticated local repo-owner status is not implemented in MVP
repo-owner status is covered by GitHub Action summary tests
```


### Operator Commands

Test:

```text
nrdocs repos
nrdocs approve OWNER/REPO --access public
nrdocs approve OWNER/REPO --access password
nrdocs disable OWNER/REPO
nrdocs access set OWNER/REPO public
nrdocs access set OWNER/REPO password
nrdocs password set OWNER/REPO
nrdocs rules list
nrdocs rules add OWNER/* --access password
nrdocs rules remove RULE_ID
```

Expected:

```text
correct API call
clear output
correct exit code
no accidental public default
```

## CLI Local Config Tests

### Config file management

```text
- Config file is created at platform-appropriate path.
- Config directory is created with 0700 permissions on Unix.
- Config file is created with 0600 permissions on Unix.
- Overly broad permissions produce a warning.
```

### Auth commands

```text
- nrdocs auth login validates token against API before saving.
- nrdocs auth login with invalid token fails without saving.
- nrdocs auth status shows profile without printing token.
- nrdocs auth logout removes token from profile.
- nrdocs auth login --profile staging saves to named profile.
```

### Deploy profile saving

```text
- nrdocs deploy writes a default profile after successful deployment.
- nrdocs deploy --no-save-profile does not write local config.
- nrdocs deploy --non-interactive does not save profile by default.
- nrdocs deploy --non-interactive --save-profile saves profile when values are available.
```

### Credential resolution

```text
- Explicit --token flag takes priority over env var.
- Env var NRDOCS_OPERATOR_TOKEN takes priority over local config.
- Local config is used when flags and env vars are absent.
- --profile flag selects a specific named profile.
- NRDOCS_PROFILE env var selects a profile when --profile is absent.
- Missing credentials returns helpful error pointing to nrdocs auth login.
```

### Operator session persistence

Given an operator has run `nrdocs deploy` successfully, when they close and reopen their terminal, then `nrdocs repos` works without re-exporting environment variables.

This test directly validates the UX improvement.

## GitHub Action Behavior Tests

These may be implemented as generated workflow snapshot tests plus CLI publish tests.

### Generated Workflow Snapshot

The generated workflow must:

```text
trigger on push to configured branch or branches
checkout source
set up runtime
build docs
call nrdocs publish
request id-token: write permission
not require NRDOCS_PUBLISH_TOKEN
not require NRDOCS_REPO_ID
```

### Pending Is Success

Given publish API returns pending status:

Expected:

```text
GitHub Action exits 0
step summary says docs uploaded and awaiting approval
```

### Real Build Error Is Failure

Expected:

```text
invalid markdown/config/build command causes nonzero exit
no successful artifact uploaded
```

### Upload Error Is Failure

Expected:

```text
network/API storage failure causes nonzero exit
summary says upload failed
```

## Rendering and Content Tests

### Minimal Docs Render

Input:

```text
docs/nrdocs.yml
docs/index.md
```

Expected:

```text
static index.html generated
site title applied
safe default layout applied
```

### Requested Access Is Advisory

Input repo config:

```yaml
site:
  requested_access: public
```

Expected:

```text
publish stores requested_access metadata
serving does not become public unless operator policy allows it
```

### Raw HTML Policy

Input:

```markdown
# Page
<script>alert('x')</script>
```

Expected:

```text
raw HTML is escaped
served page displays or omits the raw markup safely
served page does not execute arbitrary script
```

MVP must not include a raw HTML allowlist. If raw HTML is allowed in a later phase, tests must verify isolation and CSP requirements.

### Navigation Behavior

Test:

```text
auto-discovered pages
explicit nav entries
missing nav targets
invalid nav entries
```

Expected:

```text
valid nav produces links
invalid nav fails build or emits clear warning according to spec
```

## Configuration Tests

### Deployment Defaults Are Protected

Given no auto-approval rules:

Expected:

```text
manual approval required
access defaults to none while pending
public is not default
```

### Auto-Approval Rule Validation

Valid patterns:

```text
noam-r/*
noam-r/repoA
my-company/docs
```

Invalid patterns:

```text
*
*/*
/noam-r/*
noam-r/
noam-r/**
http://github.com/noam-r/repoA
```

Expected:

```text
invalid patterns rejected
no state change
audit log entry for successful rule changes
```

### Rule Precedence

If multiple rules match, the implementation must have deterministic precedence.

Recommended:

```text
most specific rule wins
exact owner/repo beats owner/*
disabled/block rules beat approval rules if block rules exist
```

Tests must verify chosen precedence.

## Migration Tests

D1 migrations must be tested for:

```text
clean database creation
idempotent migration application where supported
schema constraints
indexes required by query paths
foreign key behavior if used
```

Required constraints to test:

```text
github_repository_id unique where appropriate
owner/name route uniqueness where appropriate
latest_successful_build_id references a valid build
invalid approval/access combinations rejected or normalized
```

If D1 does not enforce all constraints directly, application-level tests must cover them.

## Audit Log Tests

Audit log entries are required for security-sensitive operations.

Test audit entries for:

```text
manual approval
manual disable
access mode change
password set/change
password removal if supported
auto-approval rule creation
auto-approval rule deletion
repo transfer/review event if implemented
publish from repo
failed auth attempts if implemented
```

Audit entries should include:

```text
action
actor type
actor id or token id where available
repo id where applicable
timestamp
before/after summary for operator changes
```

Do not store plaintext passwords or sensitive tokens in audit logs.

## Security Regression Tests

### Path Traversal

Requests such as:

```text
/owner/repo/../other/repo/index.html
/owner/repo/%2e%2e/secret
/owner/repo/assets/../../../secret
```

Expected:

```text
404 or 400
no artifact outside resolved repo is served
```

### Route Squatting

Repo owner cannot publish as:

```text
admin/panel
login/index
api/repos
```

Expected:

```text
routes are derived safely from GitHub owner/repo or operator-controlled route config
reserved paths cannot be claimed by repo config
```

### Header Injection

Repo config cannot inject dangerous headers.

Test values containing:

```text
newlines
Set-Cookie
Location
Content-Security-Policy
Access-Control-Allow-Origin
```

Expected:

```text
rejected or safely escaped
platform-controlled headers remain authoritative
```

### Password Hashing

Expected:

```text
passwords are stored only as hashes
plaintext password is not returned from API
plaintext password is not logged
password verification uses hash comparison
```

### Timing and Enumeration

For unknown, pending, disabled, and rejected repos:

Expected:

```text
anonymous response status is 404
response body is generic
no repo-specific state is revealed
```

## End-to-End Smoke Tests

At minimum, the implementation must support these smoke tests.

### E2E 1: Manual Public Approval

Steps:

```text
1. Initialize test repo docs fixture.
2. Publish via mocked valid GitHub OIDC.
3. Verify anonymous route returns 404.
4. Approve repo with public access via operator API/CLI.
5. Verify anonymous route returns 200 and expected docs content.
6. Publish updated docs.
7. Verify anonymous route returns updated content without reapproval.
```

### E2E 2: Manual Password Approval

Steps:

```text
1. Publish docs from test repo.
2. Verify anonymous route returns 404 while pending.
3. Approve repo with password access.
4. Set password.
5. Verify anonymous route does not show docs content.
6. Authenticate with password.
7. Verify docs content is served.
8. Publish updated docs.
9. Verify authenticated reader sees updated content without reapproval.
```

### E2E 3: Auto-Approval Password

Steps:

```text
1. Add auto-approval rule noam-r/* access password.
2. Publish docs from noam-r/repoA.
3. Verify repo is approved automatically.
4. Verify route is password protected, not public.
5. Set or use configured password behavior.
6. Verify valid password serves docs.
```

### E2E 4: Disabled Repo

Steps:

```text
1. Publish and approve repo public.
2. Verify route returns 200.
3. Disable repo.
4. Verify route returns 404.
5. Publish updated docs.
6. Verify route still returns 404.
```

### E2E 5: Failed Publish Does Not Break Existing Site

Steps:

```text
1. Publish valid docs and approve public.
2. Verify route returns version A.
3. Attempt invalid publish.
4. Verify publish fails.
5. Verify route still returns version A.
```

## Acceptance Criteria for MVP

The MVP test suite is complete when:

1. All critical invariants are tested.
2. Access-control matrix tests pass.
3. Publish pending behavior exits successfully in GitHub Action flow.
4. Manual approval makes already-uploaded docs visible without another publish.
5. Password approval makes already-uploaded docs password-protected without another publish.
6. Auto-approval never defaults to public unless the matching rule explicitly says public.
7. Disabled repos never serve docs.
8. Repo config cannot set effective public access.
9. R2/object storage is reachable only through Worker-controlled serving logic.
10. CLI tests cover all MVP commands.
11. API tests cover auth, validation, side effects, and error schemas.
12. Security regression tests cover path traversal, route squatting, password handling, and pending repo privacy.

## Non-MVP Tests

These are not required for MVP unless the feature is implemented:

```text
custom domains
custom slugs
GitHub OAuth repo-owner requests
operator web UI
multi-tenant SaaS behavior
server-side builds
rollbacks
full-text search
custom JavaScript support
invite-based reader auth
SSO reader auth
```

If any non-MVP feature is added, it must include tests that preserve all MVP invariants.

## Final Rule

No feature is considered done if it weakens protected-first behavior.

If a test requires choosing between convenience and privacy, the expected result must favor privacy.

## Canonical Route Tests

For an approved public repo with `index.html` and `page/index.html`:

| Request | Expected |
|---|---|
| `/OWNER/REPO` | redirect to `/OWNER/REPO/` |
| `/OWNER/REPO/` | 200, serves repo index |
| `/OWNER/REPO/index.html` | redirect to `/OWNER/REPO/` |
| `/OWNER/REPO/page` | redirect to `/OWNER/REPO/page/` |
| `/OWNER/REPO/page/` | 200, serves page index |
| `/OWNER/REPO/page.html` | redirect to `/OWNER/REPO/page/` if the page exists |
| `/OWNER/REPO/page/index.html` | redirect to `/OWNER/REPO/page/` |
| `/OWNER/REPO/assets/logo.png` | 200, serves asset without page redirect |

Canonical redirects must not be returned for unknown, pending, disabled, or unapproved repos; those requests must remain non-revealing.

## SVG Header Tests

For an approved repo with a valid SVG asset:

```text
GET /OWNER/REPO/assets/logo.svg
```

Expected headers include:

```text
Content-Type: image/svg+xml
Content-Security-Policy: script-src 'none'; object-src 'none'; base-uri 'none'
X-Content-Type-Options: nosniff
```

## needs_password Tests

For a repo that is approved with password access and has uploaded artifacts but has no configured password credential:

```text
Operator API: serving.reason = needs_password
nrdocs repos: Next = password set
GitHub Action: success with needs-password warning
Anonymous reader: non-revealing response
```
