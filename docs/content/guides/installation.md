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

Deploying the Workers does **not** install the small **`nrdocs`** program used for repo-owner initialization (`nrdocs init …`) and platform operations (`nrdocs admin …`). Install it on your own machine (see [CLI Reference](cli/index.html)).

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

If the shell still tries **`/usr/local/bin/nrdocs`** and errors, run **`hash -r`** (Bash) or **`rehash`** (zsh), or **`sudo rm -f /usr/local/bin/nrdocs`**, then **`command -v nrdocs`** again.

System-wide install is still **`sudo cp dist-cli/nrdocs.cjs /usr/local/bin/nrdocs`** if you prefer. Alternatively point `install.sh` at a fork that publishes binaries: **`NRDOCS_RELEASES_REPO=owner/repo sh install.sh`**.

**If you cannot use `sudo`** or need a longer PATH walkthrough, see **[Onboarding a repository](onboarding-bootstrap/index.html)** (short install pointer) and the **[CLI Reference](cli/index.html)** troubleshooting notes.

If you **already** ran `install.sh`, you do not need to download again unless you want an update; the onboarding page explains how to fix “command not found” without re-running the installer.

Repo-owner quick path: [Onboarding a repository](onboarding-bootstrap/index.html).

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

This handles everything: account ID detection, D1 database creation, R2 bucket creation, wrangler.toml patching, database migrations, secret generation, Worker deployment, `.env` configuration, and **after the Delivery Worker deploy**, **upload or refresh `site/index.html` in R2** at the configured key (default `site/index.html`) so **`GET /`** on the delivery host returns HTML when that file exists in the repo. No manual copy-paste needed.

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

### Delivery root homepage (`GET /`)

The Delivery Worker serves the platform landing page for **`GET /`** (and **`HEAD /`**) from **one object** in the **same R2 bucket** bound to the delivery Worker (`[[env.delivery.r2_buckets]]` in `wrangler.toml`, binding `BUCKET`). By default it looks for the key **`site/index.html`**.

**Finding your bucket name**

1. **Config (authoritative):** open `wrangler.toml` and read **`bucket_name`** under **`[[env.delivery.r2_buckets]]`** (the template uses **`nrdocs-content`** unless you renamed it).
2. **CLI:** `wrangler r2 bucket list`
3. **Dashboard:** **R2** → bucket list.

After the bucket exists, upload the tracked homepage from the repo root (object path is **`{bucket}/{key}`**):

```bash
wrangler r2 object put nrdocs-content/site/index.html --file=./site/index.html --remote
```

Replace **`nrdocs-content`** with your **`bucket_name`** if it differs. Re-run this whenever you change `site/index.html`. Optional: override or disable the key with **`HOME_PAGE_R2_KEY`** on the delivery Worker — see [Configuration](configuration/index.html).

If this object is missing, **`https://<your-delivery-host>/`** returns **404** even though project docs under **`/<slug>/`** work.

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

The HMAC signing key **must be the same value** in both Workers — it's used to sign and verify session tokens. The TOKEN_SIGNING_KEY is used by the Control Plane to sign repo publish tokens (JWTs).

Now put the API key in your `.env` file so the CLI can use it. Open `.env` and set:

```
NRDOCS_API_KEY=paste-your-api-key-here
```

You don't need to save the HMAC key or token signing key anywhere locally — they're only used by the Workers at runtime. The API key is the only one you need locally (for the CLI and GitHub Actions).

**`HMAC_SIGNING_KEY` in your shell:** Wrangler stores Worker secrets on Cloudflare, not in your environment. `echo $HMAC_SIGNING_KEY` will normally be empty — that does **not** mean the Worker has no secret. To see which secrets exist (names only, never values):

```bash
wrangler secret list --env delivery
wrangler secret list --env control-plane
```

If `HMAC_SIGNING_KEY` is missing from the list, run `wrangler secret put HMAC_SIGNING_KEY --env delivery` (and again for `--env control-plane` with the **same** value).

### Rule out “split D1” before changing secrets or keys

If `set-password` succeeds but readers never accept the password, **one** explanation is that the control plane and delivery workers were deployed with **different** `database_id` values (admin writes one SQLite database; the reader reads another). Rotating `HMAC_SIGNING_KEY` will not fix that.

This is **read-only**: it does not overwrite variables, secrets, or `wrangler.toml`.

```bash
./scripts/verify-d1-alignment.sh
```

To also run a **remote** D1 query for a single repo (prints `slug`, `access_mode`, and **length** of `password_hash` only — never the hash itself), pass your repo UUID:

```bash
REPO_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx ./scripts/verify-d1-alignment.sh
```

- **Mismatch** in the script → fix both `[[env.delivery.d1_databases]]` and `[[env.control-plane.d1_databases]]` in `wrangler.toml` to the **same** `database_id`, then redeploy both workers.
- **OK** in the file **but** workers were last deployed from an **older** copy of `wrangler.toml` → compare what is in the Cloudflare dashboard vs this repo, or redeploy from this file so runtime matches config.
- **OK** and `password_hash_len` is zero for your `REPO_ID` → this database never received that password (wrong repo id, or admin CLI pointed at a different control plane / account than the one backing your reader).

If the remote step prints **Authentication error [code: 10000]** for `/accounts/.../d1/database`, that is a **Wrangler ↔ Cloudflare D1 API** credential issue, not evidence of a split database. `wrangler whoami` can look fine while D1 calls still fail (OAuth token scope friction). The script prints remediation; the usual fix is an **API token** with Account → D1 → Edit (and Account Settings read), exported as `CLOUDFLARE_API_TOKEN` plus `CLOUDFLARE_ACCOUNT_ID` matching `wrangler.toml`, or `wrangler logout && wrangler login`. You can still inspect rows from the dashboard: **Workers & D1** → your database → **Console**.

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
curl -s -o /dev/null -w "%{http_code}" $NRDOCS_API_URL/repos
```

If you get `401`, it's working — the Control Plane is rejecting unauthenticated requests, which is correct.

If you uploaded the delivery homepage (see **Delivery root homepage** under Step 5), check that the delivery origin returns HTML on `/`:

```bash
curl -sI "https://YOUR_DELIVERY_HOST/" | head -5
```

You should see **`HTTP/2 200`** (or **`HTTP/1.1 200`**) and a **`content-type`** that includes **`text/html`**. A **`404`** means the object is missing at the configured R2 key or **`HOME_PAGE_R2_KEY`** is set to **`""`**.

Run the test suite to make sure the codebase is healthy:

```bash
npm test
```

## Operator checklist: OIDC happy path

After **`wrangler deploy --env control-plane`**, confirm the Worker you hit includes **`POST /oidc/publish-credentials`** (matches your local `npm test` / repo version).

1. **`nrdocs admin register`** from a docs checkout (or **`POST /repos`** with **`repo_identity`**: `github.com/<owner>/<repo>`). Without **`repo_identity`**, GitHub Actions OIDC cannot resolve the row.
2. **`nrdocs admin approve <repo-id>`** (optionally **`--repo-identity`** so mint has a binding). If **`GET …/status/<repo-id>`** still shows a blank identity for an **approved** site, run **`nrdocs admin mint-publish-token <repo-id> --repo-identity github.com/<owner>/<repo>`** — the control plane can persist that value when minting.
3. **`curl -s "$NRDOCS_API_URL/status/<repo-id>"`** — response JSON should include **`repo_identity`** matching the GitHub repo.
4. Hand authors the **control plane URL** + **repo id**; they run **`nrdocs config set api-url`** and **`nrdocs init --repo-id`**, commit, push the publish branch.
5. Open the repo’s **GitHub Actions** run for that push and confirm publish succeeded. If the first run registered the repo but exited before publish (awaiting approval), you do **not** need new doc edits: use **Actions → Run workflow** on the publish branch, or **`git commit --allow-empty`** and push (see [Publishing](../publishing/index.html)).

Manual **`nrdocs admin publish`** is optional (uses **`NRDOCS_PUBLISH_TOKEN`** from mint); CI does **not** need that secret when OIDC is configured.

## What's next

Your platform is deployed. Register a project from a docs checkout, approve it, then either **publish once manually** or hand off to a repo owner for **OIDC CI**:

```bash
# Register the project (reads slug/title from docs/project.yml)
nrdocs admin register
```

This prints a repo id (UUID). Then approve (mint is included by default):

```bash
nrdocs admin approve <repo-id> --repo-identity github.com/org/repo
```

Optional one-off build from your laptop:

```bash
nrdocs admin publish <project-id>
```

For more details, see:

- [CLI Reference](../cli/index.html) — all available commands
- [Publishing guide](../publishing/index.html) — happy path, manual curl, and OIDC troubleshooting
- [Repository Setup](../repository-setup/index.html) — how to set up a new docs repo
- [Configuration](../configuration/index.html) — session TTL, cache TTL, rate limits
