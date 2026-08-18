# nrdocs 2.0 Product Brief

## Status

This document defines the locked product scope for nrdocs 2.0.

nrdocs 2.0 is a clean product model. It has no compatibility or migration requirement for nrdocs 1.x. Existing implementation components may be reused when they satisfy this specification, but 1.x concepts and behavior do not constrain 2.0.

## Purpose

nrdocs is a self-hosted system for publishing a directory of Markdown as a safe, shareable minisite.

The product is intentionally narrow. It performs two functions:

1. Publish a validated Markdown directory as a static site.
2. Serve the latest successful publication under administrator-controlled reader access.

## One-Sentence Product Definition

> nrdocs publishes a directory of Markdown as a protected website and serves its latest successful publication.

## Product Problem

Markdown documentation, reports, research notebooks, and technical minisites are often stored locally or inside a larger project. Sharing them commonly requires one of the following:

- creating a dedicated documentation repository;
- exposing an existing source repository;
- configuring and maintaining a static-site generator and hosting service;
- operating a general-purpose content-management system; or
- sending files that lose navigation, formatting, and access control.

nrdocs provides a smaller alternative. A publisher connects a directory to an administrator-created site and publishes it directly. The directory may be inside a Git repository, outside a repository, or used by any CI system. Git is never required and is never part of site identity.

## Primary Promise

The publisher workflow is:

```bash
nrdocs connect ./docs
nrdocs preview ./docs
nrdocs publish ./docs
```

Subsequent publication is:

```bash
nrdocs publish ./docs
```

The administrator workflow is:

```bash
nrdocs deploy
nrdocs site create product-handbook
```

Site creation establishes the public route, reader-access mode, and initial site-scoped publishing token. No discovery, repository approval, or secondary activation step is required.

## Target Users

### Administrator

An administrator controls the Cloudflare account in which an nrdocs instance is deployed.

The administrator can:

- deploy an nrdocs instance;
- create, inspect, rename, enable, disable, and delete sites;
- select public or shared-password reader access;
- set and change reader passwords;
- issue, inspect, expire, and revoke site-scoped publishing tokens; and
- select which locally registered instance administrative commands target.

Administrator authority comes from Cloudflare. nrdocs does not implement administrator accounts, administrator sessions, an administrator token, or an administrator web interface.

### Publisher

A publisher has a token authorizing publication to exactly one site.

The publisher can:

- connect a local Markdown directory to the authorized site;
- preview the rendered site locally;
- generate editable navigation configuration;
- publish a replacement for the currently served content; and
- use the same publishing contract from a local machine or CI system.

A publisher cannot:

- create sites;
- change the site slug;
- change reader access;
- set or change the reader password;
- enable, disable, or delete the site;
- issue additional publishing tokens; or
- administer the nrdocs instance.

### Reader

A reader visits a direct site URL.

The reader can:

- read a public site without authentication;
- enter a shared password for a password-protected site;
- navigate within the site under a site-scoped reader session;
- log out of a password-protected site; and
- open or download assets intentionally linked by the publisher.

nrdocs does not provide reader accounts, site discovery, personalized permissions, or a directory of public sites.

## Core Mental Model

The primary resources are:

```text
Instance
  └── Site
        ├── current publication
        ├── reader-access configuration
        └── publishing tokens
```

### Instance

A self-hosted nrdocs deployment with one canonical origin.

### Site

An administrator-created serving destination with:

- an immutable opaque site ID;
- an administrator-selected URL slug;
- an enabled or disabled lifecycle state;
- public or password reader access; and
- zero or one current publication.

### Publication

The complete static artifact produced from one validated Markdown directory.

A site has only one current publication. A successful publish atomically replaces it. A failed publish leaves it unchanged.

### Publishing token

An opaque credential granting only permission to publish to one site. A site may have multiple independently named and revocable tokens.

### Credential reference

The immutable site ID stored in `nrdocs.yml`. It defines the expected destination and normally names the publisher's protected local credential file without storing the token or server address in the publication directory. A complete environment credential pair may override local credential loading for one invocation but must resolve to the same site ID.

## Product Principles

### 1. Directory-First Publishing

The unit of publication is a directory, not a repository.

The directory name, repository name, Git remote, branch, and commit have no effect on site identity or publication authority.

### 2. Explicit Destination Binding

The publication directory contains an opaque credential reference in `nrdocs.yml`.

The CLI must never infer a publishing destination from:

- the directory name;
- the only locally stored credential;
- the current Git repository;
- a Git remote;
- the active administrative instance; or
- a previously published site.

### 3. Publishing and Serving Are Separate

Publishers control content. Administrators control serving state and reader access.

A publisher token authorizes replacement of site content. It does not authorize access-policy or lifecycle changes.

### 4. Latest Successful Publication Only

nrdocs is not a version-management system.

It does not expose:

- publication history;
- releases;
- branches;
- tags;
- diffs;
- rollback;
- hosted preview deployments; or
- historical URLs.

Users who require version management may use Git or another external system.

Temporary upload state may exist internally to guarantee atomic replacement, but it is not a user-facing version.

### 5. Safe, Fixed Rendering

nrdocs renders a fixed Markdown dialect and a fixed reader interface.

Publishers cannot upload or configure arbitrary HTML, JavaScript, CSS, templates, components, plugins, fonts, analytics scripts, or build commands.

### 6. Intentional Publication Set

Published pages come from navigation. Published assets come from references in those pages.

nrdocs does not copy the source directory wholesale and does not automatically expose original Markdown or generated source archives.

Publication inputs are ordinary files and directories, never symbolic links. nrdocs applies one portable case-and-Unicode collision policy so the same selected content is accepted or rejected on Linux and macOS.

### 7. Provider-Neutral Automation

Local publication and CI publication use the same URL-and-token contract.

The same environment credential pair may establish a safe site pointer with non-interactive `connect`; the token remains environment-only and is not copied into local credential storage.

nrdocs does not detect or integrate with GitHub, GitLab, or another source provider. Provider-specific workflow examples may exist in documentation, but they are not product state or generated configuration.

### 8. Infrastructure-Backed Administration

Cloudflare access defines the administrator boundary.

nrdocs does not maintain a parallel administrator identity system. Administrative CLI commands operate through the Cloudflare control plane against the selected nrdocs instance.

Administrative mutations are human-operated in nrdocs 2.0. Deployment, site changes, password changes, token issuance or revocation, and deletion require an interactive terminal and the specified confirmations. Non-interactive automation is supported for publishing content, not for administering instances or sites.

### 9. Minimal, Deterministic CLI

Each command has one primary responsibility:

- `connect` binds a directory to a site credential;
- `preview` renders locally;
- `publish` validates, renders, and replaces live content;
- `generate nav` materializes editable navigation;
- `site` controls serving destinations;
- `token` controls publishing authority;
- `credentials` controls locally stored publisher secrets; and
- `instance` controls local administrative targeting.

Commands must fail with explicit remediation rather than guessing.

The CLI exposes a small stable process-exit taxonomy so CI can distinguish local input failures, authority failures, retryable remote conditions, compatibility failures, local I/O failures, and internal defects without parsing human text.

## Reader Access

Each enabled site uses exactly one reader-access mode:

```text
public
password
```

Invariants:

- Password mode always has a valid password hash.
- Public mode has no retained password hash.
- Removing a password means changing the site to public.
- Disabling a site does not alter its access mode or password.
- Changing or removing a password invalidates existing reader sessions.
- Reader sessions are scoped to one site.
- Access to one site never grants access to another site.

Unknown, deleted, disabled, and enabled-without-content sites return 404.

## Site URLs

Each site has an administrator-selected root-level slug:

```text
https://docs.example.com/product-handbook/
```

Pages are served below that slug:

```text
https://docs.example.com/product-handbook/installation/
```

Platform routes use the reserved root namespace:

```text
/_nrdocs/
```

The slug `_nrdocs` is forbidden.

The site ID is immutable. The administrator may rename the slug without changing the site ID, publishing tokens, or local credential references. The old URL becomes 404; nrdocs 2.0 does not retain aliases or redirects.

## Content Scope

The supported source is a directory containing:

- Markdown pages;
- `nrdocs.yml`;
- supported images; and
- supported referenced attachments.

The fixed Markdown feature set includes:

- CommonMark;
- GitHub-style tables;
- task lists;
- strikethrough;
- GitHub-style autolink literals;
- fenced code blocks;
- syntax highlighting;
- Mermaid fenced blocks;
- relative links between published pages;
- external links; and
- referenced images and attachments.

Markdown pages are UTF-8 text. A single leading UTF-8 byte-order mark is accepted and removed before parsing; invalid UTF-8 and byte-order marks elsewhere are rejected.

Raw HTML, MDX, iframes, plugins, custom components, custom CSS, custom JavaScript, frontmatter, footnotes, math extensions, emoji shortcodes, definition lists, and directives are unsupported. Soft line breaks retain CommonMark behavior and are not converted automatically to `<br>`.

Publisher-supplied SVG files are also unsupported in nrdocs 2.0. Mermaid remains supported because the publisher supplies inert Mermaid source inside a fenced Markdown block and the fixed nrdocs platform performs the rendering; the publisher does not upload an SVG document.

## Navigation and Routes

Automatic navigation is the default.

Navigation is bounded to eight levels. Site, page, and section titles contain 1–160 Unicode scalar values after trimming and NFC normalization; nrdocs rejects invalid titles and never truncates them. Titles may repeat because routes, not labels, identify pages.

The filename convention is:

```text
index.md
01-introduction.md
02-guides/
  index.md
  01-installation.md
  02-configuration.md
```

Numeric prefixes determine order but are removed from public URLs:

```text
01-introduction.md              -> /introduction/
02-guides/01-installation.md    -> /guides/installation/
```

`index.md` represents its containing directory. If the publication root has no `index.md`, the site root redirects to the first navigable page.

Publishers may materialize automatic navigation into an explicit editable list with:

```bash
nrdocs generate nav
```

## Fixed Reader Interface

All sites use one maintained nrdocs presentation with:

- responsive navigation;
- site and page titles;
- publisher-declared document language and text direction, with safe defaults;
- previous and next page navigation;
- syntax-highlighted code;
- Mermaid rendering; and
- built-in light and dark presentation.

The presentation is native semantic HTML, fixed CSS, and minimal
framework-free JavaScript. shadcn/ui, React, Tailwind CSS, and other UI
frameworks or component libraries are not the reader foundation or runtime
dependencies. This keeps the serving surface small and gives nrdocs one audited
interaction contract rather than an application framework.

nrdocs 2.0 has no:

- site search;
- publisher branding;
- custom themes;
- comments;
- analytics injection;
- public site directory; or
- source-download interface.

The instance root shows a branded fixed page with a GitHub project link and never lists sites.

## Deployment Model

`nrdocs deploy` is self-contained and may run from any directory.

It provisions the fixed Cloudflare deployment and records a non-secret local instance descriptor. It does not generate or require a deployment repository, `wrangler.toml`, package project, or persistent local deployment directory.

nrdocs 2.0 is distributed as version `2.0.0` of the existing public npm package `nrdocs`, exposing the single `nrdocs` executable. That package contains the compiled CLI, deployable Worker bundle, D1 migrations, fixed platform assets, and required deployment metadata as one versioned release unit. Internal workspace packages are not separately published or selected by users.

After the package is installed, deployment never downloads a matching Worker, migration, renderer, or platform-asset package from a repository or a second registry package. This prevents component-version skew and preserves use through either `npm install --global nrdocs` or `npx nrdocs`.

An instance receives a Workers.dev hostname by default. The administrator may instead configure one canonical custom hostname. Per-site domains and hostname aliases are not supported.

## nrdocs 2.0 Scope

nrdocs 2.0 must support:

1. Self-contained Cloudflare deployment.
2. Local administrative instance selection.
3. Administrator-created sites.
4. Public and shared-password reader access.
5. Independently revocable site-scoped publishing tokens.
6. Explicit local credential references and protected credential storage.
7. Local preview using the production renderer.
8. Atomic replacement of the current publication.
9. Automatic and explicit navigation.
10. Nested Markdown sections.
11. Fixed Markdown rendering and supported referenced assets.
12. Provider-neutral local and CI publication.
13. Site enablement, disablement, rename, and permanent deletion.
14. Generic, non-discoverable instance homepage behavior.

## Non-Goals

nrdocs 2.0 must not include:

1. Migration or compatibility with nrdocs 1.x.
2. Git repository identity or repository discovery.
3. GitHub Actions workflow generation.
4. GitHub OIDC publishing.
5. Git, branch, commit, tag, or release management.
6. Publication history or rollback.
7. Server-side repository cloning.
8. Server-side arbitrary build execution.
9. Arbitrary static-site uploads.
10. Custom HTML, JavaScript, CSS, themes, or plugins.
11. Administrator, publisher, or reader accounts.
12. A web administration interface.
13. Per-reader authorization or RBAC.
14. Email or magic-link authentication.
15. Expiring reader share links.
16. Site discovery or public-site listings.
17. Search.
18. Source Markdown or site archive downloads.
19. Per-site custom domains.
20. Persistent servers, VMs, or containers.
21. A general replacement for MkDocs, Docusaurus, or other static-site generators.

## Clean Break from nrdocs 1.x

The following 1.x concepts do not exist in 2.0:

- repository records;
- `owner/repo` routes;
- repository approval;
- pending publication approval;
- repository access requests;
- auto-approval rules;
- repository-owner password permissions;
- GitHub OIDC claims;
- GitHub workflow generation;
- operator application tokens;
- compatibility migrations; and
- source export ZIPs.

The 2.0 implementation may reuse tested rendering, packaging, serving, or Cloudflare components only after adapting them to the site-and-token model defined here.

## Product Acceptance Criteria

nrdocs 2.0 satisfies this brief when:

1. An administrator can deploy an instance without creating a repository or local deployment project.
2. An administrator can create a site and issue a site-scoped token.
3. A publisher can connect and publish a plain local Markdown directory without Git.
4. The same directory can be published from generic CI using environment credentials.
5. A successful publish atomically replaces the served site.
6. A failed publish leaves the existing site unchanged.
7. A publisher cannot alter reader access or site lifecycle.
8. A reader can access public or password-protected content through a direct URL.
9. No directory, repository, provider, or credential-selection inference is required.
10. No version-management or arbitrary-site-hosting behavior is introduced.
