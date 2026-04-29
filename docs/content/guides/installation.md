# Installation

This guide walks through setting up the nrdocs platform from scratch on your Cloudflare account.

## Step 1: Run the setup script

Start here. This checks all dependencies and installs anything missing (Node.js must be pre-installed):

```bash
git clone https://github.com/example/nrdocs.git
cd nrdocs
./scripts/setup.sh
```

The script checks for Node.js (>= 18), npm, jq, and Wrangler. It installs Wrangler and jq automatically if they're missing, runs `npm install`, and creates local config files from the templates:

- `.env` from `.env.example`
- `wrangler.toml` from `wrangler.toml.example`

These local files contain your credentials and are gitignored — only the `.example` templates are committed to the repo.

If you just want to preview the site builder output without deploying, you can stop here and run `npm run preview`. The rest of this guide covers deploying to Cloudflare.

## Standalone `nrdocs` CLI

Deploying the Workers does **not** install the small **`nrdocs`** program used for author onboarding (`nrdocs init --token …`) and platform operations (`nrdocs admin …`). Install it on your own machine (see [CLI Reference](cli/index.html)).

**Simplest approach when GitHub Releases are set up:** `install.sh` downloads a native binary from GitHub. You may need your **computer password** once:

```bash
sudo sh install.sh --system
```

Then open a **new** terminal and run **`nrdocs --help`**. If that works, you are finished.

**If that fails with HTTP 404 / “Failed to download”:** there is no matching release asset yet (see the message from `install.sh`). From this repo, with Node.js 20+, run **`npm install && npm run build:cli`**, then install the bundle:

```bash
mkdir -p "$HOME/.local/bin"
cp dist-cli/nrdocs.cjs "$HOME/.local/bin/nrdocs"
chmod +x "$HOME/.local/bin/nrdocs"
command -v nrdocs   # should show .../.local/bin/nrdocs
```

If the shell still tries **`/usr/local/bin/nrdocs`** and errors, run **`hash -r`** (Bash) or **`rehash`** (zsh), or **`sudo rm -f /usr/local/bin/nrdocs`**, then **`command -v nrdocs`** again. Full walkthrough: [Onboarding → Build from this repo](onboarding-bootstrap/index.html#build-from-this-repo-and-copy-to-localbin).

System-wide install is still **`sudo cp dist-cli/nrdocs.cjs /usr/local/bin/nrdocs`** if you prefer. Alternatively point `install.sh` at a fork that publishes binaries: **`NRDOCS_RELEASES_REPO=owner/repo sh install.sh`**.

**If you cannot use `sudo`**, or you already used **`sh install.sh`** without flags and see **`command not found`**, follow the full step-by-step (macOS vs Linux, full-path fallback, no assumed shell knowledge) in **[Onboarding (bootstrap token) → Install the CLI](onboarding-bootstrap/index.html#install-the-cli)**.

If you **already** ran `install.sh`, you do not need to download again unless you want an update; the onboarding page explains how to fix “command not found” without re-running the installer.

Author-only quick path: [Onboarding (bootstrap token)](onboarding-bootstrap/index.html).

### GitHub Actions authentication (OIDC, recommended)

The default generated publish workflow uses **GitHub Actions OIDC**. This means:

- No repository secrets are required for publishing
- No repository variables are required for publishing
- No `gh` CLI authentication is required for onboarding

If you see OIDC exchange failures in GitHub Actions, ensure you deployed the updated Control Plane that includes `POST /oidc/publish-credentials`.

## Quick deploy (recommended)

After setup, the fastest path is the automated deploy script:

```bash
wrangler login
./scripts/deploy.sh
```

This handles everything: account ID detection, D1 database creation, R2 bucket creation, wrangler.toml patching, database migrations, secret generation, Worker deployment, and `.env` configuration. No manual copy-paste needed.

If you prefer to understand each step or need to customize the process, the manual steps are documented below.

## Manual deployment (step by step)

## Step 2: Log in to Cloudflare

```bash
wrangler login
```

This opens a browser window where you authorize Wrangler. You only need to do this once.

## Step 3: Get your Account ID and put it in the config

Go to the [Cloudflare dashboard](https://dash.cloudflare.com), select your account, and find the **Account ID** on the right side of the Overview page.

Open `wrangler.toml` and replace `REPLACE_WITH_ACCOUNT_ID` with your actual account ID:

```toml
account_id = "your-actual-account-id-here"
```

This single file configures both Workers. The account ID, D1 binding, and R2 binding are shared at the top level. Each Worker has its own `[env.delivery]` or `[env.control-plane]` section.

## Step 4: Create the D1 database

```bash
wrangler d1 create nrdocs
```

This prints output like:

```
✅ Successfully created DB 'nrdocs'

[[d1_databases]]
binding = "DB"
database_name = "nrdocs"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy the `database_id` value. Open `wrangler.toml` and replace `REPLACE_WITH_D1_DATABASE_ID` in **both** environment sections (`env.delivery` and `env.control-plane`):

```toml
[[env.delivery.d1_databases]]
binding = "DB"
database_name = "nrdocs"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# ... and the same value in:

[[env.control-plane.d1_databases]]
binding = "DB"
database_name = "nrdocs"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

## Step 5: Create the R2 bucket

R2 must be enabled on your Cloudflare account before you can create buckets. If you haven't used R2 before:

1. Go to the [Cloudflare dashboard](https://dash.cloudflare.com)
2. Click **R2 Object Storage** in the left sidebar
3. Follow the prompt to enable R2 (it may ask you to add a payment method — R2 has a generous free tier but requires billing info)

Once R2 is enabled:

```bash
wrangler r2 bucket create nrdocs-content
```

No config changes needed — the bucket name `nrdocs-content` is already in the config.

## Step 6: Update the domain route (optional — can do later)

This step connects the Delivery Worker to your custom domain so docs are served at `docs.yourdomain.com/<project-slug>/` (default org) or `docs.yourdomain.com/<org-slug>/<project-slug>/` (named orgs). You don't need to do this now — the Worker is also accessible at its `*.workers.dev` URL, which is enough for testing.

If you want to set up the custom domain now, open `wrangler.toml` and update the `routes` under `[env.delivery]`:

```toml
[env.delivery]
routes = [
  { pattern = "docs.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

The domain must already be added as a zone in your Cloudflare account (Websites section in the dashboard). You also need a DNS record pointing the subdomain to Cloudflare:

1. Go to your domain in the Cloudflare dashboard → **DNS** → **Records**
2. Add an **AAAA** record: name = `docs`, content = `100::`, proxied (orange cloud on)

This is a dummy record — Cloudflare's proxy intercepts the request and routes it to your Worker. The `100::` address is never actually used.

The route takes effect when you deploy in Step 9. If you skip this step, the Delivery Worker is still deployed and accessible at `https://nrdocs-delivery.YOUR_SUBDOMAIN.workers.dev`.

Set the same public base URL on the Control Plane Worker so `nrdocs init` can tell repo owners exactly where their docs will be published:

```toml
[env.control-plane.vars]
DELIVERY_URL = "https://docs.yourdomain.com"
```

## Step 7: Run the database migrations

Apply every SQL file in `migrations/` **in filename order** (e.g. `0001_initial_schema.sql`, then `0002_add_org_support.sql`, then `0003_org_scoped_project_slug.sql`). The automated `./scripts/deploy.sh` script does this in a loop.

```bash
for f in migrations/*.sql; do
  wrangler d1 execute nrdocs --remote --file="$f"
done
```

The `--remote` flag is important — without it, Wrangler runs against a local SQLite file instead of the D1 database on Cloudflare.

If you run these commands **by hand** on a database that already has the schema, Wrangler may print `✘ [ERROR]` and a message like `table projects already exists`. That is SQLite refusing to recreate an existing object — it does **not** mean your database is corrupt. The `./scripts/deploy.sh` script detects that case and reports a normal “skipped / already applied” line instead of treating it as a failed deploy.

Together, the migrations create and evolve tables for `projects`, `organizations`, token tables, `access_policy_entries`, `operational_events`, and `rate_limit_entries`, including org-scoped project slugs.

## Step 8: Generate and set secrets

You need three secret values. Generate them now and keep them visible in your terminal — you'll paste each one into Wrangler prompts and into your `.env` file in the next few minutes.

```bash
openssl rand -hex 32
```

Run this three times. The first output is your **API_KEY**, the second is your **HMAC_SIGNING_KEY**, and the third is your **TOKEN_SIGNING_KEY**.

Now set them on the Workers. Wrangler will prompt "Enter a secret value:" — paste the value and press Enter. Since the Workers haven't been deployed yet, Wrangler will also ask "Do you want to create a new Worker?" — answer **yes**:

```bash
# Delivery Worker — needs only the HMAC signing key
wrangler secret put HMAC_SIGNING_KEY --env delivery
# → paste your HMAC_SIGNING_KEY, press Enter
# → if asked "create a new Worker?", answer: y

# Control Plane Worker — needs all three secrets
wrangler secret put API_KEY --env control-plane
# → paste your API_KEY, press Enter
# → if asked "create a new Worker?", answer: y

wrangler secret put HMAC_SIGNING_KEY --env control-plane
# → paste the SAME HMAC_SIGNING_KEY as above, press Enter

wrangler secret put TOKEN_SIGNING_KEY --env control-plane
# → paste your TOKEN_SIGNING_KEY, press Enter
```

The HMAC signing key **must be the same value** in both Workers — it's used to sign and verify session tokens. The TOKEN_SIGNING_KEY is used by the Control Plane to sign bootstrap tokens and repo publish tokens.

Now put the API key in your `.env` file so the CLI can use it. Open `.env` and set:

```
NRDOCS_API_KEY=paste-your-api-key-here
```

You don't need to save the HMAC key or token signing key anywhere locally — they're only used by the Workers at runtime. The API key is the only one you need locally (for the CLI and GitHub Actions).

## Step 9: Deploy

```bash
wrangler deploy --env delivery
wrangler deploy --env control-plane
```

Wrangler prints the URL of each Worker. The Control Plane URL looks like:

```
https://nrdocs-control-plane.YOUR_SUBDOMAIN.workers.dev
```

Save this URL — it's your API base URL. Add it to `.env`:

```bash
# Edit .env and set:
NRDOCS_API_URL=https://nrdocs-control-plane.YOUR_SUBDOMAIN.workers.dev
```

## Step 10: Verify

Test that the Control Plane is running:

```bash
curl -s -o /dev/null -w "%{http_code}" $NRDOCS_API_URL/projects
```

If you get `401`, it's working — the Control Plane is rejecting unauthenticated requests, which is correct.

Run the test suite to make sure the codebase is healthy:

```bash
npm test
```

## What's next

Your platform is deployed. The last thing to do is register your first project and publish content. Registration prints the project ID you will pass to the next commands:

```bash
# Register the project (reads slug/title from docs/project.yml)
nrdocs admin register
```

This prints a project UUID. Then approve and publish:

```bash
nrdocs admin approve <project-id> --repo-identity github.com/org/repo
nrdocs admin publish <project-id>
```

For more details, see:

- [CLI Reference](../cli/index.html) — all available commands
- [Publishing guide](../publishing/index.html) — manual and automated publishing
- [Repository Setup](../repository-setup/index.html) — how to set up a new docs repo
- [Configuration](../configuration/index.html) — session TTL, cache TTL, rate limits
