# How to Connect a Repository to nrdocs

This document is an instruction guide for LLM agents. It describes the exact steps to set up a repository for publishing documentation through the nrdocs platform.

## Context

nrdocs is a documentation publishing platform. It takes Markdown files from a repository, builds them into an HTML site with sidebar navigation and in-page TOC, and serves them under the docs hostname. **URLs:** `https://<delivery-host>/<site-slug>/…` (single-tenant; slugs are unique in the deployment).

This doc involves **two different personas**. Do not mix them when giving instructions:

- **Platform operator (admin)**: runs the Control Plane, has `NRDOCS_API_KEY`, can register and approve sites.
- **Repository owner (author)**: owns a GitHub docs repo, does **not** have `NRDOCS_API_KEY`, only runs `nrdocs init` and pushes to GitHub.

Goal: connect a GitHub repository so its documentation is published automatically by GitHub Actions.

Single onboarding path (operator-only registration):

- **Operator** registers and approves the site (and sets password if needed).
- **Repo owner** runs tokenless `nrdocs init` to generate local files + the secretless OIDC workflow, then pushes.

Repo owners do **not** need `NRDOCS_API_KEY`.

### What you need from the user

Before starting, the **operator** must have these values (from the nrdocs platform installation):

| Value | What it is | Example |
|---|---|---|
| `NRDOCS_API_URL` | URL of the Control Plane Worker | `https://nrdocs-control-plane.example.workers.dev` |
| `NRDOCS_API_KEY` | Admin API key (set during nrdocs installation) | `0553c09...` (64-char hex string) |
| `slug` | Site slug (lowercase, hyphens; **unique** in this nrdocs deployment) | `my-project` |
| `title` | Display title for the sidebar header | `My Project Docs` |
| `access_mode` | `public` (open) or `password` (requires login) | `public` |
| `docs_dir` | Where docs live in the repo (default: repo root `.`) | `docs` or `.` |

Repo owners should **not** be asked for the API key. Operators keep it in an operator-only `.env`.

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

All fields are required. The `slug` must be **unique** in this deployment and determines the path segment. The public URL is `https://<delivery-host>/<slug>/`.

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

## Step 2: Copy the GitHub Actions workflow (OIDC)

Copy the file `templates/publish-docs.yml` from the nrdocs repository into the target repository at `.github/workflows/publish-docs.yml`:

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

      - name: Build payload and publish (OIDC)
        permissions:
          contents: read
          id-token: write
        env:
          NRDOCS_API_URL: https://<control-plane-worker>
          NRDOCS_DOCS_DIR: ${{ vars.NRDOCS_DOCS_DIR || '.' }}
        run: |
          set -euo pipefail
          DOCS_DIR="${NRDOCS_DOCS_DIR:-.}"

          oidc_json=$(curl -sSf -H "Authorization: Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${NRDOCS_API_URL}")
          oidc_token=$(echo "$oidc_json" | jq -r '.value')
          if [ -z "$oidc_token" ] || [ "$oidc_token" = "null" ]; then echo "::error::Failed to acquire GitHub OIDC token"; exit 1; fi

          creds=$(curl -sSf -X POST -H "Authorization: Bearer $oidc_token" "${NRDOCS_API_URL}/oidc/publish-credentials")
          NRDOCS_REPO_ID=$(echo "$creds" | jq -r '.repo_id')
          NRDOCS_PUBLISH_TOKEN=$(echo "$creds" | jq -r '.repo_publish_token')
          if [ -z "$NRDOCS_REPO_ID" ] || [ "$NRDOCS_REPO_ID" = "null" ]; then echo "::error::OIDC exchange did not return repo_id"; echo "$creds"; exit 1; fi
          if [ -z "$NRDOCS_PUBLISH_TOKEN" ] || [ "$NRDOCS_PUBLISH_TOKEN" = "null" ]; then echo "::error::OIDC exchange did not return repo_publish_token"; echo "$creds"; exit 1; fi

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
          http_code=$(curl -s -o response.json -w '%{http_code}' -X POST -H "Content-Type: application/json" -H "Authorization: Bearer ${NRDOCS_PUBLISH_TOKEN}" -H "X-Repo-Identity: github.com/${{ github.repository }}" -d "$payload" "${NRDOCS_API_URL}/repos/${NRDOCS_REPO_ID}/publish")
          echo "Response status: ${http_code}"
          cat response.json
          if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then echo "::error::Publish failed with HTTP ${http_code}"; exit 1; fi
          echo "Publish succeeded."
```

## Step 3: Register the site with the Control Plane

This step requires the nrdocs CLI or a direct API call. The repo row must be registered and approved before publishing works.

### Using the nrdocs CLI

```bash
NRDOCS_DOCS_DIR=<docs_dir> nrdocs admin register
# Copy the repo id from the output
nrdocs admin approve <repo-id> --repo-identity github.com/org/repo
```
Then give the repo owner the Control Plane URL and the repo id, and have them run:

```bash
nrdocs init --api-url '<control-plane-url>' --repo-id '<repo-id>'
git push
```

### Using curl (operator alternative)

```bash
# Register
curl -X POST "$NRDOCS_API_URL/repos" \
  -H "Authorization: Bearer $NRDOCS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "<slug>",
    "repo_url": "https://github.com/<org>/<repo>",
    "title": "<title>",
    "description": "<description>",
    "access_mode": "<access_mode>",
    "repo_identity": "github.com/<org>/<repo>"
  }'

# Response includes "id" — save it as REPO_ID

# Approve
curl -X POST "$NRDOCS_API_URL/repos/$REPO_ID/approve" \
  -H "Authorization: Bearer $NRDOCS_API_KEY"
```

### For password-protected sites

If `access_mode` is `password`, also set the password:

```bash
curl -X POST "$NRDOCS_API_URL/repos/$REPO_ID/password" \
  -H "Authorization: Bearer $NRDOCS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"password": "<password>"}'
```

## Step 4: Optional GitHub repository variables

The OIDC publish workflow does not require any publishing credentials in GitHub.

If docs are in a subdirectory (not repo root), add a **variable**:

| Type | Name | Value |
|---|---|---|
| Variable | `NRDOCS_DOCS_DIR` | Path to docs dir, e.g. `docs` |

## Step 5: Push and verify

After all files are created and secrets are configured, push to `main`. The GitHub Actions workflow will trigger and publish the docs.

The site will be available at `https://<delivery-worker-domain>/<slug>/`.

## Checklist

Before telling the user it's done, verify:

- [ ] `project.yml` exists with correct slug, title, access_mode
- [ ] `nav.yml` exists with at least one page
- [ ] Every `path` in `nav.yml` has a corresponding `content/<path>.md` file
- [ ] `.github/workflows/publish-docs.yml` exists
- [ ] The site is registered and approved via the Control Plane API, with **`repo_identity`** set to `github.com/<org>/<repo>` (required for OIDC)
- [ ] If docs are in a subdirectory, NRDOCS_DOCS_DIR variable is set

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `Slug mismatch` | `slug` in project.yml doesn't match the registered slug | Make them identical |
| `nav.yml references pages that do not exist` | A `path` in nav.yml has no matching `.md` file | Create the missing file or fix the path |
| `Cannot publish project with status 'awaiting_approval'` | Site wasn't approved | Run the approve API call |
| `A project with slug "X" already exists` | That slug is already used in this deployment | Choose a different slug |
| `Publish failed with HTTP 401` | OIDC exchange failed or publish JWT is invalid | Ensure the Control Plane supports `POST /oidc/publish-credentials` and `repo_identity` matches `github.com/<owner>/<repo>` |
| `No project is registered for repository github.com/<owner>/<repo>` | Row is missing `repo_identity` or points at a different repo | Set `repo_identity` at registration (or mint with `--repo-identity`), then retry |
