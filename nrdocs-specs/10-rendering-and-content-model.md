# nrdocs Rendering and Content Model Specification

## Purpose

This document specifies the repository-side documentation format, generated content behavior, and rendering rules for nrdocs MVP.

The goal is to make the repo-owner experience simple while preserving the protected-first, operator-controlled security model.

## Core Rule

> Repo owners control documentation content. Operators control visibility and effective access.

Repo content may request access preferences, but it must never determine whether docs are public, password-protected, or hidden.

## MVP Content Goal

The MVP content model should make this flow work:

```bash
nrdocs init
git push
```

The repo owner should get a working docs site without learning a complex static site generator.

The default should be Markdown-first, simple, and predictable.

## Default Repository Layout

`nrdocs init` creates:

```text
docs/
  nrdocs.yml
  index.md
.github/
  workflows/
    nrdocs.yml
```

The default docs source directory is:

```text
docs/
```

The generated static site output directory during CI is implementation-defined, but should not be committed by default.

Recommended local output path:

```text
.nrdocs/site/
```

## Repo Config File

The repository config file is:

```text
docs/nrdocs.yml
```

Minimal example:

```yaml
site:
  title: Repo Docs
  requested_access: password
```

Full MVP example:

```yaml
site:
  title: Repo A Docs
  requested_access: password

export: true

content:
  source_dir: .
  index: index.md
  nav: auto
```

`export` (optional, default `true`): when `true`, publish bundles original Markdown for nav pages under `_nrdocs/sources/` plus `_nrdocs/export/site.zip`, and rendered HTML includes export download links. When `false`, export UI and source artifacts are omitted.

Because the config file lives inside `docs/`, `content.source_dir: .` means the docs directory itself.

## Config Ownership

Repo owners may control:

```text
- Site title
- Docs source directory within the repo
- Navigation preference
- Markdown page content
- Requested access mode
- Whether readers may download Markdown exports (`export`)
```

Repo owners may not control:

```text
- Effective access mode
- Approval state
- Password values
- Public route ownership beyond the derived OWNER/REPO route
- Security headers
- Server-side redirects
- Cookies
- Operator policy
```

## Requested Access

Repo config may include:

```yaml
site:
  requested_access: public
```

or:

```yaml
site:
  requested_access: password
```

This value is advisory only.

The effective access mode is decided by operator policy in D1.

Valid values:

```text
public
password
```

If omitted, the default requested access is:

```text
password
```

Even if requested access is `public`, the repo must remain invisible until an operator manually approves it as public or an auto-approval rule approves it as public.

## Routes and Slugs

MVP route format:

```text
https://DOCS_BASE_URL/OWNER/REPO/
```

Example:

```text
https://docs.example.com/noam-r/repoA/
```

Repo owners must not be able to claim arbitrary top-level slugs in MVP.

Do not support this in MVP:

```yaml
site:
  slug: engineering/api
```

Custom routes may be introduced later as an operator-controlled feature.

## Markdown Source

MVP supports Markdown files with extension:

```text
.md
```

Markdown files are converted to HTML.

Example:

```text
docs/index.md
docs/getting-started.md
docs/guides/configuration.md
```

Recommended output:

```text
index.html
getting-started/index.html
guides/configuration/index.html
```

Canonical URLs:

```text
docs/index.md                  -> /OWNER/REPO/
docs/getting-started.md        -> /OWNER/REPO/getting-started/
docs/guides/configuration.md   -> /OWNER/REPO/guides/configuration/
```

Generated HTML must use canonical clean URLs for internal page links and must include a canonical link element for each page:

```html
<link rel="canonical" href="https://DOCS_BASE_URL/OWNER/REPO/getting-started/">
```

Markdown links to `.md` files must be normalized to canonical page URLs. Site-root paths in Markdown, such as `/assets/logo.png` or `/getting-started.md`, are resolved relative to the repo docs root and served under `/OWNER/REPO/...`, not the deployment domain root.

## Markdown Features

MVP uses `markdown-it` with `html: false` and GFM-style tables enabled (via `markdown-it-gfm-table` or equivalent plugin).

MVP supports:

```text
- Headings
- Paragraphs
- Bold and italic
- Links
- Images
- Ordered and unordered lists
- Blockquotes
- Inline code
- Fenced code blocks
- Tables (GFM-style)
```

MVP does not support:

```text
- Task lists
- Strikethrough
- Raw HTML (disabled via html: false)
- Custom containers
- Plugin-dependent Markdown extensions
```

These may be added in a later version with explicit spec updates.

## Raw HTML Policy

Default MVP policy:

```text
Raw HTML is disabled.
```

The renderer must escape raw HTML from Markdown input. Repo-provided Markdown must not be allowed to inject arbitrary scripts, event handlers, iframes, forms, or dangerous HTML.

Examples that must not execute:

```html
<script>alert(1)</script>
<img src=x onerror=alert(1)>
<iframe src="https://example.com"></iframe>
<form action="https://attacker.example"></form>
```

MVP must not implement a raw HTML allowlist. Sanitized raw HTML may be considered in a later version only with a dedicated security spec and tests.

## JavaScript Policy

Default MVP policy:

```text
No arbitrary repo-provided JavaScript.
```

The generated docs should be readable without JavaScript.

If the implementation ships its own platform JavaScript later, it must be reviewed alongside Content Security Policy changes in [`08-access-control-and-security.md`](./08-access-control-and-security.md).

## CSS Policy

MVP may use platform-provided CSS for generated pages.

Repo-provided CSS files are not supported in MVP. The renderer uses platform-provided CSS only. Repo-provided CSS can be specified in a future version with a dedicated allowlist and tests.

Recommended MVP:

```text
- nrdocs provides the page template and CSS.
- Repo owners write Markdown content only.
```

This keeps the security model simple.

## Images and Static Assets

MVP may allow static assets under the docs directory.

Example:

```text
docs/assets/diagram.png
docs/assets/logo.svg
```

Markdown image references:

```markdown
![Architecture](./assets/diagram.png)
```

The renderer should copy referenced assets to the generated site.

Path traversal must be rejected.

Assets outside the docs directory must not be included unless explicitly configured later.

## Navigation

MVP default navigation mode:

```yaml
content:
  nav: auto
```

Auto navigation behavior:

```text
1. Discover Markdown files under docs source directory.
2. Sort files by path.
3. Put index.md first.
4. Derive page titles from first H1, then filename fallback.
```

MVP supports optional explicit navigation:

```yaml
nav:
  - title: Home
    path: index.md
  - title: Getting Started
    path: getting-started.md
  - title: Guides
    children:
      - title: Configuration
        path: guides/configuration.md
```

If explicit nav is present:

```text
- All paths must be inside docs source directory.
- Missing files are config errors.
- Duplicate paths are config errors.
```

Auto navigation is preferred for MVP simplicity.

## Page Titles

Page title resolution order:

```text
1. First level-1 heading in Markdown file
2. Explicit nav title
3. Filename converted to title case
```

Site title resolution:

```text
1. site.title in nrdocs.yml
2. OWNER/REPO fallback
```

## Links

Internal Markdown links should be rewritten to generated HTML routes.

Example source:

```markdown
[Configuration](./guides/configuration.md)
```

Generated link:

```text
/guides/configuration/
```

The implementation must prevent links from escaping the site root when resolving local files.

External links are allowed:

```markdown
[GitHub](https://github.com/)
```

External links should include safe attributes when rendered:

```html
rel="noopener noreferrer"
```

## Build Command

MVP should not require custom build commands.

The default build is:

```bash
nrdocs build
```

This reads `docs/nrdocs.yml`, renders Markdown, copies allowed assets, and creates a static artifact.

Custom build commands are not part of MVP.

Do not support this in MVP:

```yaml
build:
  command: npm run docs:build
  output: dist/docs
```

Reason: custom build commands create additional complexity and security expectations. Builds already run in GitHub Actions, but the MVP concept should remain Markdown-first.

Custom build support can be added later.

## Generated GitHub Workflow Integration

`nrdocs init` creates a GitHub Actions workflow that runs:

```bash
nrdocs publish
```

`nrdocs publish` internally performs:

```text
1. Validate repo config.
2. Build static docs from Markdown.
3. Package generated site.
4. Authenticate with GitHub OIDC.
5. Upload artifact to nrdocs Worker API.
```

The repo owner should not need separate manual steps.

## Local Preview

MVP may include:

```bash
nrdocs preview
```

This preview command is not required for MVP implementation.

If implemented, preview must use the same renderer as CI.

Preview must not imply approval or visibility.

## Config Validation

Invalid config should fail the GitHub Action.

Examples of invalid config:

```text
- Missing docs/nrdocs.yml
- Invalid YAML
- Missing index.md
- Unsupported requested_access value
- Explicit nav references missing file
- File path escapes docs directory
- Artifact size/file count exceeds limits
```

Pending approval must not fail the GitHub Action.

## Ignored Files

The renderer should ignore common non-content files:

```text
.DS_Store
Thumbs.db
.gitkeep
node_modules/
.git/
```

The renderer must not include secrets or hidden files by default.

Recommended rule:

```text
Ignore dotfiles and dot-directories unless explicitly allowlisted by the implementation.
```

## Search

Search is not required for MVP.

If a search index is generated, it must be static and must contain only content from the generated docs.

Search must not include hidden/pending/private metadata beyond the served docs content.

## Theming

Custom theming is not required for MVP.

The default theme should be clean, readable, and minimal.

Repo-configurable theme options should be avoided in MVP unless they are simple and safe.

## Non-Goals for MVP

The MVP rendering model does not include:

```text
- Docusaurus compatibility
- MkDocs compatibility
- Custom JavaScript
- Server-side rendering
- Server-side repo cloning
- Arbitrary build commands
- Custom domains per repo
- Custom slugs controlled by repo owners
- Multi-tenant SaaS theming
- Reader identity management beyond password sessions
```

## Acceptance Criteria

An implementation satisfies this spec if:

```text
- `nrdocs init` creates a minimal docs directory and GitHub workflow.
- Markdown docs can be rendered into static HTML.
- The default config requests password access but does not control effective access.
- Raw HTML/JavaScript cannot execute by default.
- Auto navigation works without requiring a separate nav file.
- Repo owners cannot claim arbitrary public routes.
- Invalid config fails publish.
- Pending approval does not fail publish.
```
