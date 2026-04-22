# How to Connect a Repository to nrdocs

This document is an instruction guide for LLM agents. It describes the exact steps to set up a repository for publishing documentation through the nrdocs platform.

## Context

nrdocs is a documentation publishing platform. It takes Markdown files from a repository, builds them into an HTML site with sidebar navigation and in-page TOC, and serves them at a URL like `https://docs.example.com/<slug>/`.

The user has a running nrdocs platform (two Cloudflare Workers deployed). They want to connect a repository so its documentation is published automatically on push to `main`.

## What you need from the user

Before starting, ask the user for these values. They come from the nrdocs platform installation:

| Value | What it is | Example |
|---|---|---|
| `NRDOCS_API_URL` | URL of the Control Plane Worker | `https://nrdocs-control-plane.example.workers.dev` |
| `NRDOCS_API_KEY` | Admin API key (set during nrdocs installation) | `0553c09...` (64-char hex string) |
| `slug` | URL path segment for this project (lowercase, hyphens, unique) | `my-project` |
| `title` | Display title for the sidebar header | `My Project Docs` |
| `access_mode` | `public` (open) or `password` (requires login) | `public` |
| `docs_dir` | Where docs live in the repo (default: repo root `.`) | `docs` or `.` |

If the user doesn't know the API URL or key, they can find them in the `.env` file of their nrdocs installation.

## Step 1: Create the docs file structure

Create these files in the repository. If `docs_dir` is `.` (repo root), create them at the root. If `docs_dir` is `docs`, create them under `docs/`.

### project.yml

```yaml
slug: <slug>
title: "<title>"
description: "<one-line description>"
publish_enabled: true
access_mode: <access_mode>
```

All fields are required. The `slug` must be unique across all projects on the platform and will be used in the URL.

### nav.yml

This defines the sidebar navigation. Every page must be listed here. nrdocs does NOT auto-discover pages from the filesystem.

```yaml
nav:
  - label: "Getting Started"
    path: getting-started
  - label: "Guides"
    section: true
    children:
      - label: "Installation"
        path: guides/installation
      - label: "Usage"
        path: guides/usage
  - label: "API Reference"
    path: api-reference
```

Rules:
- Leaf items have `label` and `path`. The `path` maps to `content/<path>.md`.
- Section items have `label`, `section: true`, and a `children` array.
- Every `path` must have a corresponding `.md` file under `content/`.
- The `label` is used as the page title in the browser tab.

### content/ directory

Create a `content/` directory with Markdown files matching the paths in `nav.yml`.

Pages are plain Markdown — no frontmatter required:

```markdown
# Getting Started

Your content here. Supports **bold**, `code`, lists, tables, code blocks, etc.

## Section heading

h2 and h3 headings automatically appear in the "On this page" TOC on the right.
```

The file `content/getting-started.md` corresponds to `path: getting-started` in nav.yml.
The file `content/guides/installation.md` corresponds to `path: guides/installation`.

### Example structure

```
<docs_dir>/
├── project.yml
├── nav.yml
└── content/
    ├── getting-started.md
    ├── guides/
    │   ├── installation.md
    │   └── usage.md
    └── api-reference.md
```

## Step 2: Copy the GitHub Actions workflow

Copy the file `.github/workflows/publish-docs.yml` from the nrdocs repository into the target repository at the exact same path:

```
<repo>/
└── .github/
    └── workflows/
        └── publish-docs.yml
```

The content of this file is:

```yaml
name: Publish Docs to nrdocs

on:
  push:
    branches:
      - main

jobs:
  publish:
    name: Publish documentation
    runs-on: ubuntu-latest

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Build payload and publish
        env:
          NRDOCS_API_URL: ${{ secrets.NRDOCS_API_URL }}
          NRDOCS_API_KEY: ${{ secrets.NRDOCS_API_KEY }}
          NRDOCS_PROJECT_ID: ${{ secrets.NRDOCS_PROJECT_ID }}
          NRDOCS_DOCS_DIR: ${{ vars.NRDOCS_DOCS_DIR || '.' }}
        run: |
          set -euo pipefail
          DOCS_DIR="${NRDOCS_DOCS_DIR:-.}"
          if [ -z "${NRDOCS_API_URL:-}" ]; then echo "::error::NRDOCS_API_URL secret is not set"; exit 1; fi
          if [ -z "${NRDOCS_API_KEY:-}" ]; then echo "::error::NRDOCS_API_KEY secret is not set"; exit 1; fi
          if [ -z "${NRDOCS_PROJECT_ID:-}" ]; then echo "::error::NRDOCS_PROJECT_ID secret is not set"; exit 1; fi
          project_yml=$(jq -Rs '.' < "$DOCS_DIR/project.yml")
          nav_yml=$(jq -Rs '.' < "$DOCS_DIR/nav.yml")
          if [ -f "$DOCS_DIR/allowed-list.yml" ]; then allowed_list_yml=$(jq -Rs '.' < "$DOCS_DIR/allowed-list.yml"); else allowed_list_yml="null"; fi
          pages_json=$(jq -n '{}')
          while IFS= read -r -d '' file; do
            relative="${file#"$DOCS_DIR/content/"}"
            key="${relative%.md}"
            page_content=$(jq -Rs '.' < "$file")
            pages_json=$(echo "$pages_json" | jq --arg k "$key" --argjson v "$page_content" '. + {($k): $v}')
          done < <(find "$DOCS_DIR/content" -name '*.md' -type f -print0 | sort -z)
          payload=$(jq -n --argjson project_yml "$project_yml" --argjson nav_yml "$nav_yml" --argjson allowed_list_yml "$allowed_list_yml" --argjson pages "$pages_json" '{repo_content: {project_yml: $project_yml, nav_yml: $nav_yml, allowed_list_yml: $allowed_list_yml, pages: $pages}}')
          http_code=$(curl -s -o response.json -w '%{http_code}' -X POST -H "Content-Type: application/json" -H "Authorization: Bearer ${NRDOCS_API_KEY}" -d "$payload" "${NRDOCS_API_URL}/projects/${NRDOCS_PROJECT_ID}/publish")
          echo "Response status: ${http_code}"
          cat response.json
          if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then echo "::error::Publish failed with HTTP ${http_code}"; exit 1; fi
          echo "Publish succeeded."
```

## Step 3: Register the project with the Control Plane

This step requires the nrdocs CLI or a direct API call. The project must be registered and approved before publishing works.

### Option A: Using the nrdocs CLI (if available)

If the user has the nrdocs repo cloned with the CLI set up:

```bash
NRDOCS_DOCS_DIR=<docs_dir> ./scripts/nrdocs.sh register
# Copy the project ID from the output
NRDOCS_PROJECT_ID=<id> ./scripts/nrdocs.sh approve
```

### Option B: Using curl

```bash
# Register
curl -X POST "$NRDOCS_API_URL/projects" \
  -H "Authorization: Bearer $NRDOCS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "<slug>",
    "repo_url": "https://github.com/<org>/<repo>",
    "title": "<title>",
    "description": "<description>",
    "access_mode": "<access_mode>"
  }'

# Response includes "id" — save it as PROJECT_ID

# Approve
curl -X POST "$NRDOCS_API_URL/projects/$PROJECT_ID/approve" \
  -H "Authorization: Bearer $NRDOCS_API_KEY"
```

### For password-protected projects

If `access_mode` is `password`, also set the password:

```bash
curl -X POST "$NRDOCS_API_URL/projects/$PROJECT_ID/password" \
  -H "Authorization: Bearer $NRDOCS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"password": "<password>"}'
```

## Step 4: Configure GitHub repository secrets

Tell the user to go to their GitHub repository → Settings → Secrets and variables → Actions, and add:

| Type | Name | Value |
|---|---|---|
| Secret | `NRDOCS_API_URL` | The Control Plane Worker URL |
| Secret | `NRDOCS_API_KEY` | The admin API key |
| Secret | `NRDOCS_PROJECT_ID` | The project UUID from Step 3 |

If docs are in a subdirectory (not repo root), also add a **variable** (not secret):

| Type | Name | Value |
|---|---|---|
| Variable | `NRDOCS_DOCS_DIR` | Path to docs dir, e.g. `docs` |

## Step 5: Push and verify

After all files are created and secrets are configured, push to `main`. The GitHub Actions workflow will trigger and publish the docs.

The site will be available at: `https://<delivery-worker-domain>/<slug>/`

## Checklist

Before telling the user it's done, verify:

- [ ] `project.yml` exists with correct slug, title, access_mode
- [ ] `nav.yml` exists with at least one page
- [ ] Every `path` in `nav.yml` has a corresponding `content/<path>.md` file
- [ ] `.github/workflows/publish-docs.yml` exists
- [ ] Project is registered and approved via the Control Plane API
- [ ] GitHub repository secrets are configured (NRDOCS_API_URL, NRDOCS_API_KEY, NRDOCS_PROJECT_ID)
- [ ] If docs are in a subdirectory, NRDOCS_DOCS_DIR variable is set

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `Slug mismatch` | `slug` in project.yml doesn't match the registered slug | Make them identical |
| `nav.yml references pages that do not exist` | A `path` in nav.yml has no matching `.md` file | Create the missing file or fix the path |
| `Cannot publish project with status 'awaiting_approval'` | Project wasn't approved | Run the approve API call |
| `A project with slug "X" already exists` | Slug is taken | Choose a different slug |
| `Publish failed with HTTP 401` | Wrong or missing API key in GitHub secrets | Check NRDOCS_API_KEY secret |
| `Publish failed with HTTP 404` | Wrong project ID in GitHub secrets | Check NRDOCS_PROJECT_ID secret |
