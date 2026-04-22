# How It Works

nrdocs has three moving parts: your documentation repository, the Control Plane (admin API), and the Delivery Worker (serves content to readers). Here's how they fit together.

## The big picture

```
Your repo          GitHub Actions         Control Plane         R2 Storage
─────────          ──────────────         ─────────────         ──────────
project.yml   ──▶  reads files,      ──▶  validates config,    artifacts
nav.yml             packages JSON,         builds HTML,     ──▶  stored under
content/*.md        POSTs to API           uploads to R2        versioned prefix
                                           updates D1 pointer
                                                │
                                                ▼
                                           Delivery Worker
                                           ──────────────
Reader ──GET──▶    looks up project in D1
                   resolves URL to R2 path
                   serves HTML with nav + TOC
```

## Your documentation repository

Every project that wants to publish docs through nrdocs needs a specific file structure in its repository. This is the "contract" between your repo and the platform.

### Required files

```
your-repo/
├── project.yml          # Project identity and settings
├── nav.yml              # Sidebar navigation structure
└── content/             # All Markdown pages live here
    ├── getting-started.md
    ├── guides/
    │   ├── installation.md
    │   └── configuration.md
    └── api-reference.md
```

### project.yml

Declares who this project is. The `slug` must match what was registered in the Control Plane — if they don't match, the publish is rejected.

```yaml
slug: my-project
title: "My Project Docs"
description: "Internal documentation for My Project"
publish_enabled: true
access_mode: public
```

| Field | Required | Description |
|---|---|---|
| `slug` | yes | Must match the registered slug exactly. Used in the URL path. |
| `title` | yes | Displayed in the sidebar header on every page. |
| `description` | yes | Project description (metadata). |
| `publish_enabled` | yes | Must be `true` for publishing to work. |
| `access_mode` | yes | `public` or `password`. Must match the registered mode. |

### nav.yml

Defines the sidebar navigation. This is the only thing that controls what appears in the sidebar — nrdocs does not auto-discover pages from the filesystem.

```yaml
nav:
  - label: "Getting Started"
    path: getting-started
  - label: "Guides"
    section: true
    children:
      - label: "Installation"
        path: guides/installation
      - label: "Configuration"
        path: guides/configuration
  - label: "API Reference"
    path: api-reference
```

There are two types of nav items:

- **Leaf items** — have a `label` and a `path`. The path maps to a Markdown file under `content/` (without the `.md` extension). So `path: guides/installation` maps to `content/guides/installation.md`.
- **Section items** — have a `label`, `section: true`, and a `children` array. They render as a heading in the sidebar with their children indented below.

Every `path` referenced in `nav.yml` must have a corresponding `.md` file in `content/`. If a file is missing, the build fails with a clear error.

The `label` in nav.yml is also used as the page title in the browser tab — unless the page overrides it with frontmatter (see [Repository Setup](guides/repository-setup/index.html) for details on optional frontmatter).

### content/ directory

All Markdown pages go here. Pages are plain Markdown — no special metadata required. Just write your content:

```markdown
# Installation Guide

Your content here. Supports **bold**, `code`, lists, tables, and fenced code blocks.
```

The page title in the browser tab comes from the `label` in `nav.yml`. If you need to override it or set page-specific options like `hidden`, you can add optional YAML frontmatter — see the [Repository Setup](guides/repository-setup/index.html) guide.

### Optional: allowed-list.yml

For future `invite_list` access mode. Declares who can access this project's docs:

```yaml
allow:
  - alice@example.com
  - "*@team.example.com"
```

## The Control Plane

The Control Plane is a Cloudflare Worker that exposes an admin REST API. It handles:

- **Project registration** — you tell it about a new project (slug, title, access mode)
- **Project approval** — new projects start in `awaiting_approval` and must be explicitly approved before they can publish or serve content
- **Publish orchestration** — receives repo content as JSON, validates configs, builds HTML from Markdown, uploads artifacts to R2, and atomically updates the live pointer
- **Access policy management** — admin overrides for allow/deny rules

Every API call requires an `Authorization: Bearer <key>` header. The key is a secret you generate yourself and set on the Worker during installation — it's not provided by Cloudflare.

### Project lifecycle

```
register → awaiting_approval → approve → approved → publish → live
                                                   → disable → 404
                                                   → delete  → gone
```

A project cannot serve content or accept publishes until it's approved. Disabling a project makes it return 404 immediately but preserves all data. Deleting removes everything.

## The Delivery Worker

The Delivery Worker is the public-facing Cloudflare Worker bound to your docs hostname (e.g., `docs.yourdomain.com/*`). When a reader visits a URL:

1. It extracts the project slug from the first path segment (`/my-project/guides/installation/` → slug is `my-project`)
2. It looks up the project in D1 by slug
3. If the project doesn't exist, is disabled, or is awaiting approval → 404 (identical response, no information disclosure)
4. If the project is `public` → serves the content directly from R2
5. If the project is `password` → checks for a valid session cookie, shows a login page if not authenticated

### URL resolution

| URL pattern | What happens |
|---|---|
| `/slug/page/` | Resolves to `<publish-prefix>/page/index.html` in R2 |
| `/slug/page` | 301 redirect to `/slug/page/` (adds trailing slash) |
| `/slug/assets/style.css` | Serves the literal file from R2 (file extension detected) |

## The build process

When a publish is triggered (either manually via curl or automatically via GitHub Actions), here's what happens inside the Control Plane:

1. Validates the project exists and is `approved`
2. Parses `project.yml` and checks the slug matches the registered slug
3. Parses `nav.yml` and validates every referenced page exists in the content
4. Renders each Markdown page to HTML
5. Generates the sidebar navigation HTML
6. Extracts h2/h3 headings for the in-page table of contents
7. Wraps everything in the page template (sidebar + content + TOC)
8. Uploads all artifacts to R2 under a versioned prefix (`publishes/<slug>/<publish-id>/`)
9. Atomically updates the active publish pointer in D1
10. Cleans up the previous version's artifacts from R2

If any step fails, the previous version stays live. Partial uploads are cleaned up automatically.

## GitHub Actions integration

Publishing is triggered by a GitHub Actions workflow file that **must exist in the repo** that wants to publish. Without it, nothing happens — there's no external trigger or webhook.

The typical flow: push to `main` → GitHub Actions reads your repo files → POSTs them to the Control Plane → Control Plane builds and publishes.

### Setup

1. Copy `templates/publish-docs.yml` from the nrdocs repo into your project repo at `.github/workflows/publish-docs.yml`
2. Set three repository **secrets** in GitHub (Settings → Secrets → Actions):

| Secret | What it is |
|---|---|
| `NRDOCS_API_URL` | The URL of your Control Plane Worker |
| `NRDOCS_API_KEY` | The API key you generated during installation |
| `NRDOCS_PROJECT_ID` | The project UUID returned when you registered the project |

3. If your docs live in a subdirectory (e.g., `docs/` instead of the repo root), also set a repository **variable**:

| Variable | What it is |
|---|---|
| `NRDOCS_DOCS_DIR` | Path to the docs directory, e.g. `docs` |

See the [Repository Setup](guides/repository-setup/index.html) guide for the full walkthrough, or the [Publishing guide](guides/publishing/index.html) for the manual alternative.
