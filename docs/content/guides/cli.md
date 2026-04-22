# CLI Reference

The nrdocs CLI (`scripts/nrdocs.sh`) is a local management tool that wraps the Control Plane API. Instead of manually constructing curl commands with JSON payloads, you run short commands like `./scripts/nrdocs.sh publish`.

## Prerequisites

- `bash` (included on macOS and Linux)
- `curl` (included on most systems)
- `jq` (JSON processor) — install from [jqlang.github.io/jq](https://jqlang.github.io/jq/download/)
- A deployed Control Plane Worker (see [Installation](../installation/index.html))

## Setup

### 1. Create your .env file

```bash
cp .env.example .env
```

### 2. Fill in the values

Open `.env` in your editor:

```
NRDOCS_API_URL=https://nrdocs-control-plane.YOUR_SUBDOMAIN.workers.dev
NRDOCS_API_KEY=your-api-key-here
NRDOCS_PROJECT_ID=
NRDOCS_DOCS_DIR=docs
```

| Variable | Required | Description |
|---|---|---|
| `NRDOCS_API_URL` | yes | The URL of your deployed Control Plane Worker. Wrangler prints this when you run `wrangler deploy --env control-plane`. |
| `NRDOCS_API_KEY` | yes | The admin API key you generated during installation and set via `wrangler secret put API_KEY`. This is not a Cloudflare-provided key — it's a secret you created yourself. |
| `NRDOCS_PROJECT_ID` | after register | The project UUID. Leave empty initially — you'll get it from the `register` command output. |
| `NRDOCS_DOCS_DIR` | no | Path to your docs directory relative to the project root. Defaults to `docs`. |

The `.env` file is gitignored — your secrets stay local.

## Commands

### init

Registers a new project and approves it in one step. A shortcut for running `register` then `approve`.

```bash
./scripts/nrdocs.sh init
```

Reads from: `.env` (API_URL, API_KEY), `docs/project.yml` (slug, title, access_mode).

If `NRDOCS_PROJECT_ID` is not set in `.env`, the command registers the project and prints the new ID, then asks you to add it to `.env` before running `approve` separately.

If `NRDOCS_PROJECT_ID` is already set, it registers and approves in sequence.

### register

Registers a new project with the Control Plane. The project starts in `awaiting_approval` status.

```bash
./scripts/nrdocs.sh register
```

Reads from:
- `.env` — `NRDOCS_API_URL`, `NRDOCS_API_KEY`
- `docs/project.yml` — `slug`, `title`, `description`, `access_mode`

The command parses your `project.yml` and sends a registration request to the Control Plane. On success, it prints the new project UUID:

```
Registering project: nrdocs
Success (201)
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "slug": "nrdocs",
  "status": "awaiting_approval",
  ...
}

Project ID: 550e8400-e29b-41d4-a716-446655440000
Add this to your .env file:
  NRDOCS_PROJECT_ID=550e8400-e29b-41d4-a716-446655440000
```

Copy the ID into your `.env` file. You need it for all subsequent commands.

### approve

Approves a registered project, transitioning it from `awaiting_approval` to `approved`. Only approved projects can accept publishes and serve content.

```bash
./scripts/nrdocs.sh approve
```

Reads from: `.env` — `NRDOCS_API_URL`, `NRDOCS_API_KEY`, `NRDOCS_PROJECT_ID`.

### publish

Reads all files from your docs directory, packages them into a JSON payload, and sends it to the Control Plane's publish endpoint. The Control Plane then builds the HTML and uploads it to R2.

```bash
./scripts/nrdocs.sh publish
```

Reads from:
- `.env` — `NRDOCS_API_URL`, `NRDOCS_API_KEY`, `NRDOCS_PROJECT_ID`, `NRDOCS_DOCS_DIR`
- `docs/project.yml` — sent as-is to the Control Plane
- `docs/nav.yml` — sent as-is to the Control Plane
- `docs/allowed-list.yml` — sent if present, otherwise null
- `docs/content/**/*.md` — every Markdown file is read and included in the payload

The command:
1. Validates that `project.yml`, `nav.yml`, and `content/` exist in the docs directory
2. Reads all files and constructs the JSON payload
3. POSTs it to `$NRDOCS_API_URL/projects/$NRDOCS_PROJECT_ID/publish`
4. Prints the result (success with publish ID, or failure with error details)

The project must be in `approved` status. If it's still `awaiting_approval` or has been `disabled`, the publish will be rejected.

### status

Fetches and displays the current project details from the Control Plane.

```bash
./scripts/nrdocs.sh status
```

Reads from: `.env` — `NRDOCS_API_URL`, `NRDOCS_API_KEY`, `NRDOCS_PROJECT_ID`.

### disable

Disables a project. Disabled projects return 404 to all readers and reject publish requests. All data (D1 records, R2 artifacts) is preserved — you can re-approve the project later.

```bash
./scripts/nrdocs.sh disable
```

Reads from: `.env` — `NRDOCS_API_URL`, `NRDOCS_API_KEY`, `NRDOCS_PROJECT_ID`.

### delete

Permanently deletes a project and all associated data: D1 records, R2 artifacts, and access configuration. This cannot be undone.

```bash
./scripts/nrdocs.sh delete
```

Reads from: `.env` — `NRDOCS_API_URL`, `NRDOCS_API_KEY`, `NRDOCS_PROJECT_ID`.

Prompts for confirmation before proceeding:

```
Are you sure you want to delete project 550e8400-...? This removes all data. [y/N]
```

### help

Shows the usage summary and all available commands.

```bash
./scripts/nrdocs.sh help
```

## Typical workflow

### First time

```bash
# 1. Set up your .env
cp .env.example .env
# Edit .env: set NRDOCS_API_URL and NRDOCS_API_KEY

# 2. Register the project
./scripts/nrdocs.sh register
# Copy the project ID into .env

# 3. Approve it
./scripts/nrdocs.sh approve

# 4. Publish
./scripts/nrdocs.sh publish
```

### Subsequent publishes

After the initial setup, publishing is a single command:

```bash
./scripts/nrdocs.sh publish
```

Edit your Markdown files, run publish, and the live site updates.

### Using npm

You can also run the CLI through npm:

```bash
npm run nrdocs -- publish
npm run nrdocs -- status
npm run nrdocs -- help
```

## Error messages

| Error | Cause | Fix |
|---|---|---|
| `NRDOCS_API_URL is not set` | `.env` is missing or `NRDOCS_API_URL` is empty | Create `.env` from `.env.example` and fill in the URL |
| `NRDOCS_API_KEY is not set` | `NRDOCS_API_KEY` is empty in `.env` | Add your API key to `.env` |
| `NRDOCS_PROJECT_ID is not set` | `NRDOCS_PROJECT_ID` is empty in `.env` | Run `register` first, then add the ID to `.env` |
| `jq is required but not installed` | `jq` is not on your PATH | Install jq from [jqlang.github.io/jq](https://jqlang.github.io/jq/download/) |
| `project.yml not found` | The docs directory doesn't have a `project.yml` | Check `NRDOCS_DOCS_DIR` in `.env` and make sure the file exists |
| `Failed (409)` on register | A project with that slug already exists | Use a different slug in `project.yml`, or delete the existing project first |
| `Failed (409)` on publish | Project is not in `approved` status | Run `approve` first |
