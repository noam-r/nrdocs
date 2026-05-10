# nrdocs Artifact Storage Specification

## Purpose

This document specifies how nrdocs stores, identifies, selects, and serves generated documentation artifacts.

The artifact storage model must support the protected-first, serverless flow defined in:

- [`00-product-brief.md`](./00-product-brief.md)
- [`01-non-negotiable-invariants.md`](./01-non-negotiable-invariants.md)
- [`03-system-architecture.md`](./03-system-architecture.md)
- [`04-data-model.md`](./04-data-model.md)

## Core Rule

> A successful publish uploads generated docs artifacts regardless of approval state. Approval controls visibility, not artifact creation.

Artifact upload and serving access are separate concerns.

A pending repo may have a complete, valid, latest successful artifact in storage. Anonymous readers must still receive `404 Not Found` until operator policy allows serving.

## Storage Backend

MVP artifact storage uses **Cloudflare R2**.

The R2 bucket must be private.

The R2 bucket must not be configured for public static hosting.

All reader access must go through the Cloudflare Worker serving path:

```text
Reader request
  -> Worker route resolution
  -> D1 policy lookup
  -> access-control check
  -> R2 object fetch
  -> response
```

Direct R2 URLs must never be exposed as public docs URLs.

## Artifact Lifecycle

### First Publish

When a repo publishes for the first time:

```text
1. GitHub Action builds docs.
2. GitHub Action packages static output.
3. GitHub Action authenticates with GitHub OIDC.
4. Worker verifies OIDC and derives repo identity.
5. Worker creates or updates repo metadata in D1.
6. Worker stores artifact files in R2.
7. Worker records a successful build in D1.
8. Worker points repo.latest_successful_build_id at the new build.
9. Worker evaluates auto-approval rules.
10. Worker returns current serving status.
```

If no approval rule matches, the repo remains pending but the artifact remains stored.

### Later Publish

When an already-known repo publishes again:

```text
1. New artifact files are stored under a new immutable build prefix.
2. A new build row is created.
3. If upload and validation succeed, latest_successful_build_id is updated.
4. Existing approval/access policy remains unchanged.
```

A later publish must not reset approval state.

A later publish must not change effective access mode.

### Failed Publish

If publish fails before a complete artifact is available:

```text
- Do not update latest_successful_build_id.
- Record failure details if possible.
- Continue serving the previous latest successful build if one exists and policy allows it.
```

Failed builds must not break an already-approved site.

## Artifact Package Format

The publish operation uploads a static site artifact.

MVP package format:

```text
.tar.gz archive containing the generated static site root
```

The archive root represents the docs site root.

Example archive contents:

```text
index.html
assets/main.css
assets/search-index.json
guides/getting-started/index.html
404.html
nrdocs-manifest.json
```

The archive must not contain absolute file paths.

The archive must not contain parent directory traversal entries such as:

```text
../secret.txt
../../file
```

The archive must not contain symlinks in MVP.

The archive must not contain hard links in MVP.

The archive must not contain device files, sockets, FIFOs, or special filesystem objects.

## Required Manifest

Each artifact must include:

```text
nrdocs-manifest.json
```

The manifest describes the generated artifact.

Example:

```json
{
  "schema_version": 1,
  "generator": "nrdocs-cli",
  "repo": {
    "owner": "noam-r",
    "name": "repoA"
  },
  "source": {
    "ref": "refs/heads/main",
    "sha": "abc123",
    "docs_dir": "docs"
  },
  "site": {
    "title": "Repo A Docs",
    "requested_access": "password"
  },
  "build": {
    "created_at": "2026-05-07T12:00:00Z"
  }
}
```

The server must not trust the manifest for repo identity.

Repo identity must come from verified GitHub OIDC claims.

The manifest may be used for display metadata, diagnostics, and validation.

## R2 Key Structure

R2 object keys must be non-guessable enough to avoid accidental discoverability and must not be directly served without policy checks.

Recommended structure:

```text
artifacts/{repo_internal_id}/{build_id}/{object_path}
```

Example:

```text
artifacts/repo_01HY.../build_01HZ.../index.html
artifacts/repo_01HY.../build_01HZ.../assets/main.css
```

Where:

```text
repo_internal_id = internal D1 repo id
build_id = internal D1 build id
object_path = normalized path inside generated site
```

Do not use only human repo names as top-level storage identifiers.

Avoid this:

```text
sites/noam-r/repoA/latest/index.html
```

Reason: human-readable paths are easier to enumerate and make accidental exposure more damaging.

## Immutable Build Prefixes

Each successful build must be stored under an immutable prefix.

Once build files are written and the build is marked successful, files under that build prefix must not be mutated.

To publish new content, create a new build prefix and update D1 metadata.

This enables:

```text
- Safe replacement
- Rollback support later
- Stable audit history
- Partial upload protection
```

## Latest Build Selection

The latest served artifact is selected by D1 metadata, not by a mutable R2 `latest/` directory.

Serving lookup:

```text
1. Resolve route to repo.
2. Load repo.latest_successful_build_id.
3. Load corresponding build.artifact_prefix.
4. Fetch requested object from R2 using artifact_prefix + normalized path.
```

This means approval/access changes do not require any R2 copy or rewrite.

## Upload Atomicity

The publish process must avoid exposing partial builds.

Required behavior:

```text
1. Create build row with status = uploading.
2. Upload all validated files to a new build prefix.
3. Validate required files exist.
4. Mark build status = succeeded.
5. Update repo.latest_successful_build_id.
```

If any upload step fails:

```text
- Mark build status = failed when possible.
- Do not update latest_successful_build_id.
- Leave previous successful build active.
```

## Path Normalization

All artifact paths must be normalized before storage and serving.

Reject paths that:

```text
- Are absolute
- Contain `..` segments
- Contain backslash path traversal
- Contain null bytes
- Normalize outside the artifact root
- Are empty after normalization, except the archive root itself
```

Canonical serving path rules:

```text
/OWNER/REPO/                          -> serve index.html
/OWNER/REPO                           -> redirect to /OWNER/REPO/
/OWNER/REPO/index.html                -> redirect to /OWNER/REPO/
/OWNER/REPO/page/                     -> serve page/index.html
/OWNER/REPO/page                      -> redirect to /OWNER/REPO/page/
/OWNER/REPO/page.html                 -> redirect to /OWNER/REPO/page/ if page/index.html exists
/OWNER/REPO/page/index.html           -> redirect to /OWNER/REPO/page/
/OWNER/REPO/assets/main.css           -> serve assets/main.css
```

Every Markdown page must have a single clean directory-style canonical URL. Non-canonical page variants must redirect to the canonical clean route when the target page exists. Asset paths are served exactly and must not redirect into page routes.

Do not serve directory listings.

## MIME Types

The Worker must set safe MIME types based on file extension.

Minimum supported types:

```text
.html   text/html; charset=utf-8
.css    text/css; charset=utf-8; platform-generated CSS only, repo-provided CSS rejected in MVP
.js     rejected in MVP for repo artifacts
.json   application/json; charset=utf-8; generated manifest/search JSON only, unknown repo-provided JSON rejected unless explicitly generated by nrdocs
.svg    image/svg+xml
.png    image/png
.jpg    image/jpeg
.jpeg   image/jpeg
.gif    image/gif
.webp   image/webp
.ico    image/x-icon
.txt    text/plain; charset=utf-8
.pdf    application/pdf
```

Unknown local asset file types must be rejected in MVP unless an operator explicitly extends the allowed asset extensions.

The Worker should set:

```text
X-Content-Type-Options: nosniff
```

SVG assets are allowed, but SVG responses must also include protective headers:

```text
Content-Type: image/svg+xml
Content-Security-Policy: script-src 'none'; object-src 'none'; base-uri 'none'
X-Content-Type-Options: nosniff
```

## Caching

MVP caching rules:

HTML files:

```text
Cache-Control: no-cache
```

Assets with content hashes may use longer cache lifetimes:

```text
Cache-Control: public, max-age=31536000, immutable
```

Non-hashed assets should use conservative caching.

The implementation may start with conservative caching for all files:

```text
Cache-Control: no-cache
```

Correctness and privacy are more important than cache optimization in MVP.

## Security Headers

Artifact responses must include platform-controlled security headers.

Repo artifacts must not control security headers.

Recommended MVP headers:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
```

If the rendering model later allows JavaScript, CSP must be revisited explicitly.

## Artifact Size Limits

The implementation must define maximum artifact limits.

Recommended MVP defaults:

```text
Max archive size: 50 MB
Max extracted file count: 5,000 files
Max extracted total size: 200 MB
Max single file size: 25 MB
```

These values may be adjusted, but limits must exist.

The publish endpoint must reject artifacts that exceed configured limits.

## Allowed Files

MVP allows static files only.

Allowed categories:

```text
- HTML
- CSS
- Images
- JSON
- Text
- PDF
- Fonts, if explicitly allowed by implementation
```

MVP should avoid arbitrary JavaScript by default.

If generated artifacts include `.js` files, the safer MVP behavior is one of:

```text
1. Reject `.js` files during publish.
2. Store them but serve with CSP `script-src 'none'`, making them inert.
```

Recommended MVP: reject `.js` files unless an explicit deployment setting enables them.

## Deletion and Cleanup

MVP does not need a full garbage collector, but it must avoid unbounded growth eventually.

Recommended cleanup policy:

```text
- Keep latest N successful builds per repo.
- Keep failed build metadata for audit/debugging.
- Delete orphaned R2 prefixes older than a configured threshold.
```

Suggested defaults:

```text
Keep successful builds per repo: 5
Delete failed upload artifacts after: 7 days
```

Cleanup may be implemented later using Cloudflare scheduled Workers.

If cleanup is not implemented in MVP, the limitation must be documented.

## Rollback

Rollback is not required for MVP.

The data model should allow it later by keeping immutable build prefixes.

Future command:

```bash
nrdocs rollback OWNER/REPO --build BUILD_ID
```

Rollback would only update:

```text
repos.latest_successful_build_id
```

It must not copy artifacts.

## Privacy Requirements

Artifacts from pending, disabled, unknown, or unapproved repos must not be visible to anonymous readers.

Anonymous response behavior:

```text
unknown repo    -> 404
pending repo    -> 404
disabled repo   -> 404
no artifact     -> 404 or generic not found
```

Do not return messages like:

```text
This private repo is awaiting approval
```

to anonymous readers.

Operator APIs may expose pending/build status to authenticated operators.

GitHub Action publish responses may expose status to the publishing repo.

## Acceptance Criteria

An implementation satisfies this spec if:

```text
- R2 bucket is private.
- Artifacts are stored under immutable build prefixes.
- latest_successful_build_id controls what is served.
- Approval/access changes never copy, rewrite, or regenerate artifacts.
- Pending repos can have stored artifacts but remain unreachable to anonymous readers.
- Partial uploads never replace the latest successful build.
- Artifact paths are normalized and traversal is rejected.
- Direct R2 URLs are not used as public docs URLs.
```
