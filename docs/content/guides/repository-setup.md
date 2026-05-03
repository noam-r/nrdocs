---
hidden: false
tags:
  - setup
  - example
---

# Repository Setup

> This page intentionally uses YAML frontmatter as an example. Most pages don't need it — see the "Optional frontmatter" section below.

This guide is for project owners who want to publish documentation through nrdocs. It covers the exact file structure, formats, and conventions your repository needs to follow.

## Required structure

Your repository must have this layout:

```
your-repo/
├── project.yml                    # required
├── nav.yml                        # required
├── allowed-list.yml               # optional
├── content/                       # required
│   ├── index.md                   # your landing page
│   ├── some-page.md
│   └── section/
│       ├── page-one.md
│       └── page-two.md
└── .github/
    └── workflows/
        └── publish-docs.yml       # copy from nrdocs repo
```

## Step by step

### Quickest path: Operator-approved init

If your platform operator has already registered and approved the project, the `nrdocs` CLI can scaffold all required files and generate the secretless OIDC workflow:

```bash
nrdocs init --api-url '<control-plane-url>' --repo-id '<repo-id>'
```

This generates all required files and writes a secretless publish workflow using GitHub Actions OIDC. Skip to "Push and verify" below.

### Manual setup

If you're setting up manually (without `nrdocs init`), follow these steps:

### 1. Create project.yml

This file declares your project's identity. Every field except `description` is validated during publish.

```yaml
slug: my-project
title: "My Project Documentation"
description: "Docs for the My Project service"
publish_enabled: true
access_mode: public
```

The `slug` is critical — it must exactly match the slug you used when registering the project via the Control Plane API. If they don't match, the publish will fail with a "Slug mismatch" error. On the platform, slugs are **unique per organization** (two different orgs may both have a project slug `docs`, with different URL paths). Projects registered via the admin API today belong to the **default** org and are served at `/<slug>/…` on the delivery host.

`access_mode` must be either `public` (anyone can read) or `password` (readers must enter a shared password). This must also match what was registered.

### 2. Create nav.yml

This defines your sidebar navigation. nrdocs does not auto-discover pages — if a page isn't in `nav.yml`, it won't appear in the sidebar (though it's still accessible by direct URL).

```yaml
nav:
  - label: "Home"
    path: index
  - label: "Tutorials"
    section: true
    children:
      - label: "Quick Start"
        path: tutorials/quick-start
      - label: "Advanced Usage"
        path: tutorials/advanced
  - label: "FAQ"
    path: faq
```

The `label` for each page is used as the browser tab title. You don't need to repeat it in the Markdown file.

Rules:

- Every `path` must correspond to a file at `content/<path>.md`
- Paths use forward slashes, no `.md` extension, no leading slash
- Section items must have `section: true` and a non-empty `children` array
- A nav item cannot have both `path` and `section: true`
- If a referenced file doesn't exist, the build fails

### 3. Write your content pages

Put all Markdown files under `content/`. Just write Markdown — no metadata required:

```markdown
# Quick Start

Write your documentation here using standard Markdown.

## Installation

Run `npm install` to get started.
```

That's it. The page title in the browser tab comes from the `label` in `nav.yml`.

### 4. Set up the GitHub Actions workflow

This is what makes publishing automatic. Without this file in your repo, nothing triggers — there's no external hook.

Copy `templates/publish-docs.yml` from the nrdocs repository into your repo at `.github/workflows/publish-docs.yml`:

```
your-repo/
└── .github/
    └── workflows/
        └── publish-docs.yml   ← copy this file here
```

Then go to your repository's Settings → Secrets and variables → Actions, and add these **secrets**:

With the default (recommended) workflow, **you do not need any secrets for publishing**. The workflow uses GitHub Actions OIDC to authenticate to the Control Plane and obtain short-lived publish credentials.

If your docs live in a subdirectory, you may still set an optional repository variable:

- `NRDOCS_DOCS_DIR`: Path to the docs directory, e.g. `docs`

Now every push to `main` will automatically publish your docs.

### 5. Register your project (if not done yet)

If a platform admin hasn't registered your project yet, they need to run:

```bash
curl -X POST "$API_URL/repos" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "my-project",
    "repo_url": "https://github.com/org/my-project",
    "title": "My Project Documentation",
    "description": "Docs for My Project",
    "access_mode": "public"
  }'
```

Then approve it:

```bash
curl -X POST "$API_URL/repos/$REPO_ID/approve" \
  -H "Authorization: Bearer $API_KEY"
```

## Optional frontmatter

Most pages don't need any YAML frontmatter. But if you want to override the page title or set page-specific options, you can add a frontmatter block at the top of the file:

```markdown
---
title: "Custom Browser Tab Title"
hidden: true
tags:
  - draft
  - internal
---

# My Page

Content here.
```

| Field | What it does |
|---|---|
| `title` | Overrides the browser tab title (default: the `label` from `nav.yml`) |
| `hidden` | If `true`, excludes the page from the sidebar nav. The page is still built and accessible by direct URL. |
| `tags` | Metadata tags (array of strings). Not displayed, available for future use. |
| `order` | Sort order (for future use). |

If you don't include frontmatter, the page works fine — the title comes from `nav.yml` and the page appears in the sidebar normally.

## Supported Markdown features

nrdocs renders standard Markdown with these features:

- Headings (h1–h6)
- Bold, italic, inline code
- Fenced code blocks with language hints
- Ordered and unordered lists
- Tables
- Blockquotes
- Links (including absolute `https://…` URLs)
- Horizontal rules

### Images and other static files under `content/`

You can keep **images next to your Markdown** under `content/` (for example `content/guides/img/screen.png`) and reference them with normal Markdown **relative to the `.md` file**, e.g. `![](img/screen.png)` from `content/guides/page.md` so the browser resolves `…/guides/img/screen.png` on the published site.

Supported binary types in this release: **`.png`**, **`.jpg`**, **`.jpeg`**, **`.gif`**, **`.webp`**, **`.ico`**. GitHub Actions and `nrdocs admin publish` include those files in `repo_content.assets` as Base64; the Control Plane uploads them next to the built HTML in R2. Limits: **200** files, **5 MiB** per file, **25 MiB** total (decoded sizes). **`.svg`** is not accepted via `assets` yet (use an external HTTPS URL in Markdown if you need SVG).

**Remote images** (`![](https://example.com/path/to/image.png)`) still work unchanged and do not count toward `assets` limits.

Headings at h2 and h3 level automatically get anchor IDs and appear in the "On this page" table of contents on the right side of the page.

## Common mistakes

### "Slug mismatch" error

The `slug` in your `project.yml` doesn't match the slug used when the project was registered. They must be identical.

### "nav.yml references pages that do not exist"

A `path` in your `nav.yml` points to a file that doesn't exist under `content/`. Check for typos in the path and make sure the `.md` file is there.

### Pages not showing in the sidebar

If a page exists but doesn't appear in the sidebar, it's not listed in `nav.yml`. Add it there. nrdocs does not auto-discover pages.

### Hidden pages still accessible

This is by design. `hidden: true` only removes the page from the sidebar navigation. The page is still built and served at its URL. This is useful for draft pages or pages you want to share by direct link only.
