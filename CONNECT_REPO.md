# How to Connect a Repository to nrdocs

This document is an instruction guide for LLM agents. It describes the exact steps to set up a repository for publishing documentation through the nrdocs platform.

## Context

nrdocs is a documentation publishing platform. It takes Markdown files from a repository, builds them into an HTML site with sidebar navigation and in-page TOC, and serves them under the docs hostname. **URLs:** projects in the default org use `https://docs.example.com/<project-slug>/…`; projects in a named org use `https://docs.example.com/<org-slug>/<project-slug>/…`. Project slugs are unique **per organization**, not globally.

This doc involves **two different personas**. Do not mix them when giving instructions:

- **Platform operator (admin)**: runs the Control Plane, has `NRDOCS_API_KEY`, can approve/register projects.
- **Repository owner (author)**: owns a GitHub docs repo, does **not** have `NRDOCS_API_KEY`, only runs `nrdocs init` and pushes to GitHub.

Goal: connect a GitHub repository so its documentation is published automatically by GitHub Actions.

There are two onboarding paths:

- **Path A (recommended): bootstrap token onboarding** — operator issues a bootstrap token; repo owner runs `nrdocs init --token ...`.
- **Path B (operator-only): admin API onboarding** — operator manually registers/approves a project and wires a workflow (use only for recovery or operator-managed repos).

## Path A: Bootstrap Token Onboarding (recommended)

### Who does what

- **Operator**: issues a bootstrap token and (if required by your policy) approves the project.
- **Repo owner**: runs `nrdocs init --token ...`, commits files, pushes to GitHub.

### Repo owner instructions (the only steps they need)

1. Get a bootstrap token from your operator.
2. From the repo root:

```bash
nrdocs init --token <bootstrap-token>
git add -A
git commit -m "Initialize nrdocs"
git push
```

3. Check GitHub Actions for the “Publish Docs to nrdocs” run.

Important: the repo owner does **not** need `NRDOCS_API_KEY`.

### What you need from the user

| Value | What it is | Example |
|---|---|---|
| Bootstrap token | An org-scoped JWT issued by an admin | `eyJhbGciOi...` |

That's it. Everything else is inferred or prompted interactively.

### Run the init command

```bash
nrdocs init --token <bootstrap-token>
```

The CLI will:
1. Validate the token against the control plane
2. Detect the git remote and infer repo identity, slug, and title
3. Prompt the user to confirm or override each value
4. Create the project on the control plane (and bind it to the repo identity)
5. Generate `project.yml`, `nav.yml`, `content/home.md`, and `.github/workflows/publish-docs.yml`
6. Generate a secretless publish workflow using GitHub Actions OIDC (no per-repo secrets/variables)

For non-interactive use (CI, scripts):

```bash
nrdocs init --token <token> --slug my-project --title "My Project" --repo-identity github.com/org/repo --docs-dir docs --publish-branch docs --description "My docs"
```

### After init

The user just needs to:
1. Review the generated files
2. Commit: `git add -A && git commit -m "Initialize nrdocs"`
3. Push to the workflow branch (default `main`, or your `--publish-branch` value): `git push origin <publish-branch>`

The GitHub Actions workflow triggers automatically and publishes the docs.

### Generated workflow differences

The bootstrap-generated workflow uses **GitHub Actions OIDC** to obtain short-lived publish credentials on each run:

- Job permissions include `id-token: write`
- The workflow exchanges the GitHub OIDC token at `POST /oidc/publish-credentials`
- The Control Plane returns `{ project_id, repo_publish_token }`
- The publish call still sends `X-Repo-Identity: github.com/${{ github.repository }}` for repo binding
- The API URL is embedded directly in the workflow file (not a secret)

For details and configuration requirements, see `docs/content/guides/oidc-publishing.md`.

## Path B: Admin API Onboarding

This path is **operator-only**. It exists for:

- operator-managed projects where the repo owner will not run `nrdocs init`, or
- recovery when a repo is already in a specific shape and you want to wire it manually.

### What you need from the user

Before starting, the **operator** must have these values (from the nrdocs platform installation):

| Value | What it is | Example |
|---|---|---|
| `NRDOCS_API_URL` | URL of the Control Plane Worker | `https://nrdocs-control-plane.example.workers.dev` |
| `NRDOCS_API_KEY` | Admin API key (set during nrdocs installation) | `0553c09...` (64-char hex string) |
| `slug` | Project slug (lowercase, hyphens; **unique within the org** that owns the project) | `my-project` |
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

All fields are required. The `slug` must be **unique within the project's organization** and determines the path segment for that project. Admin API registration today assigns the **default** org, so the public URL is `https://<delivery-host>/<slug>/` unless you use multi-tenant org routing (`/<org-slug>/<slug>/`).

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
          NRDOCS_PROJECT_ID=$(echo "$creds" | jq -r '.project_id')
          NRDOCS_PUBLISH_TOKEN=$(echo "$creds" | jq -r '.repo_publish_token')
          if [ -z "$NRDOCS_PROJECT_ID" ] || [ "$NRDOCS_PROJECT_ID" = "null" ]; then echo "::error::OIDC exchange did not return project_id"; echo "$creds"; exit 1; fi
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
          http_code=$(curl -s -o response.json -w '%{http_code}' -X POST -H "Content-Type: application/json" -H "Authorization: Bearer ${NRDOCS_PUBLISH_TOKEN}" -H "X-Repo-Identity: github.com/${{ github.repository }}" -d "$payload" "${NRDOCS_API_URL}/projects/${NRDOCS_PROJECT_ID}/publish")
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
NRDOCS_DOCS_DIR=<docs_dir> nrdocs admin register
# Copy the project ID from the output
nrdocs admin approve <id> --repo-identity github.com/org/repo
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

## Step 4: Optional GitHub repository variables

The OIDC publish workflow does not require any publishing credentials in GitHub.

If docs are in a subdirectory (not repo root), add a **variable**:

| Type | Name | Value |
|---|---|---|
| Variable | `NRDOCS_DOCS_DIR` | Path to docs dir, e.g. `docs` |

## Step 5: Push and verify

After all files are created and secrets are configured, push to `main`. The GitHub Actions workflow will trigger and publish the docs.

The site will be available at `https://<delivery-worker-domain>/<slug>/` when the project lives in the **default** organization, or `https://<delivery-worker-domain>/<org-slug>/<slug>/` when using an explicit org segment.

## Checklist

Before telling the user it's done, verify:

- [ ] `project.yml` exists with correct slug, title, access_mode
- [ ] `nav.yml` exists with at least one page
- [ ] Every `path` in `nav.yml` has a corresponding `content/<path>.md` file
- [ ] `.github/workflows/publish-docs.yml` exists
- [ ] Project is registered and approved via the Control Plane API
- [ ] If docs are in a subdirectory, NRDOCS_DOCS_DIR variable is set

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `Slug mismatch` | `slug` in project.yml doesn't match the registered slug | Make them identical |
| `nav.yml references pages that do not exist` | A `path` in nav.yml has no matching `.md` file | Create the missing file or fix the path |
| `Cannot publish project with status 'awaiting_approval'` | Project wasn't approved | Run the approve API call |
| `A project with slug "X" already exists` | That slug is already used **in the same organization** | Choose a different slug (or a different org) |
| `Publish failed with HTTP 401` | OIDC exchange failed or publish JWT is invalid | Ensure the Control Plane supports `POST /oidc/publish-credentials` and the project `repo_identity` matches `github.com/<owner>/<repo>` |
| `No project is registered for repository github.com/<owner>/<repo>` | Project is missing `repo_identity` or points at a different repo | Set `repo_identity` on the project (or onboard via `nrdocs init` from the correct repo), then retry |
