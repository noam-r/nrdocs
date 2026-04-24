# Local Testing

There are two ways to test nrdocs locally:

1. **Preview mode** — test the site builder output (HTML, CSS, navigation) without any Cloudflare account. No deployment, no credentials. Just run a script and open HTML files in your browser.

2. **Full deployment** — deploy both Workers to Cloudflare, register a project via the API, publish content, and view it live. Requires a Cloudflare account with Workers, D1, and R2.

This guide covers both.

---

## 1. Preview mode (no Cloudflare needed)

This tests the Markdown rendering, navigation generation, page template, and in-page TOC — everything the site builder produces.

### Install dependencies

```bash
npm install
```

### Run the preview

```bash
npm run preview
```

This reads the docs from `docs/`, builds the site, and writes HTML to `dist-preview/`. Open any `index.html` file in your browser:

```
dist-preview/
├── api-reference/index.html
├── getting-started/index.html
└── guides/
    ├── configuration/index.html
    └── installation/index.html
```

### Point it at your own docs

```bash
npx tsx scripts/preview.ts /path/to/your/docs /path/to/output
```

### Run the test suite

```bash
npm test            # single run
npm run test:watch  # watch mode
npx tsc --noEmit    # type-check only
```

---

## 2. Full deployment testing

This deploys the actual Workers to Cloudflare and tests the complete flow: project registration, approval, publishing via the API, and serving content.

### What you need from Cloudflare

You need a free or paid Cloudflare account. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and note:

| Item | Where to find it | Used in |
|---|---|---|
| Account ID | Dashboard sidebar → your account → Overview → right side | `wrangler.toml` |
| A domain on Cloudflare | Websites section (needed for the Delivery Worker route) | `wrangler.toml` routes |

You do NOT need to pre-create the D1 database or R2 bucket — Wrangler creates them for you in the steps below.

### Run the setup script

```bash
./scripts/setup.sh
```

This installs dependencies, Wrangler, and creates `wrangler.toml` and `.env` from their templates.

### Deploy (automated)

The fastest path is the automated deploy script:

```bash
wrangler login
./scripts/deploy.sh
```

This handles D1/R2 creation, wrangler.toml patching, migrations, secret generation, and deployment in one step.

### Deploy (manual)

If you prefer manual control:

```bash
wrangler login
```

This opens a browser window. Authorize Wrangler to access your account. You only need to do this once.

### Configure wrangler.toml

Open `wrangler.toml` and replace the placeholders with your account ID:

```toml
account_id = "YOUR_ACCOUNT_ID"
```

Then create the D1 database and put the database ID in the same file:

```bash
wrangler d1 create nrdocs
```

```toml
[[d1_databases]]
binding = "DB"
database_name = "nrdocs"
database_id = "THE_ID_FROM_THE_COMMAND_ABOVE"
```

Enable R2 in the Cloudflare dashboard (R2 Object Storage → enable), then create the bucket:

```bash
wrangler r2 bucket create nrdocs-content
```

### Run the database migration

```bash
wrangler d1 execute nrdocs --remote --file=migrations/0001_initial_schema.sql
```

### Set secrets

```bash
openssl rand -hex 32   # → API_KEY
openssl rand -hex 32   # → HMAC_SIGNING_KEY

wrangler secret put HMAC_SIGNING_KEY --env delivery
wrangler secret put API_KEY --env control-plane
wrangler secret put HMAC_SIGNING_KEY --env control-plane
```

### Deploy both Workers

```bash
wrangler deploy --env delivery
wrangler deploy --env control-plane
```

Wrangler prints the URL of each deployed Worker. The Control Plane URL is your API base URL.

### Configure the CLI

Edit `.env` and fill in:

```
NRDOCS_API_URL=https://nrdocs-control-plane.YOUR_SUBDOMAIN.workers.dev
NRDOCS_API_KEY=the-api-key-you-generated-above
NRDOCS_DOCS_DIR=docs
```

Leave `NRDOCS_PROJECT_ID` empty for now — you'll get it after registering.

### Test the full flow

```bash
# Register a new project (reads slug, title, access_mode from docs/project.yml)
./scripts/nrdocs.sh register

# Copy the project ID from the output into .env as NRDOCS_PROJECT_ID

# Approve the project
./scripts/nrdocs.sh approve

# Publish the docs
./scripts/nrdocs.sh publish
```

Or do register + approve in one step:

```bash
./scripts/nrdocs.sh init
```

### CLI commands reference

| Command | What it does |
|---|---|
| `./scripts/nrdocs.sh init` | Register + approve in one step |
| `./scripts/nrdocs.sh register` | Register a new project (starts in `awaiting_approval`) |
| `./scripts/nrdocs.sh approve` | Approve a registered project for publishing |
| `./scripts/nrdocs.sh publish` | Build docs from `docs/` and publish to the Control Plane |
| `./scripts/nrdocs.sh status` | Show project details from the Control Plane |
| `./scripts/nrdocs.sh disable` | Disable a project (returns 404, preserves data) |
| `./scripts/nrdocs.sh delete` | Delete a project and all its data |
| `./scripts/nrdocs.sh help` | Show all commands |

You can also use `npm run nrdocs -- <command>`:

```bash
npm run nrdocs -- publish
npm run nrdocs -- status
```

### Testing without a custom domain

If you don't have a domain on Cloudflare, you can still test the Control Plane Worker (registration, approval, publish) using the `*.workers.dev` URL that Wrangler assigns.

The Delivery Worker requires a route binding to a Cloudflare-managed domain to serve content. For testing without a domain, you can temporarily comment out the `routes` section in `wrangler.toml` and access the Worker at its `*.workers.dev` URL instead.

### Cleaning up

To remove everything after testing:

```bash
wrangler delete --env delivery
wrangler delete --env control-plane
wrangler d1 delete nrdocs
wrangler r2 bucket delete nrdocs-content
```
