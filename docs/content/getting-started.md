# Getting Started

nrdocs is a serverless documentation platform built on Cloudflare Workers, D1, and R2. It serves Markdown-based documentation sites under a single shared hostname. Typical reader URLs are `docs.yourdomain.com/<project-slug>/` for projects in the **default** organization, or `docs.yourdomain.com/<org-slug>/<project-slug>/` when routing by organization.

You're reading the nrdocs documentation right now — it's built and served by nrdocs itself.

## What you need

- A Cloudflare account (free tier works)
- Node.js 18+
- The Wrangler CLI (`npm install -g wrangler`)
- A domain managed by Cloudflare (for the Delivery Worker route)

## Quick start

This project has two personas. Pick the one that matches you.

### Repo owners (authors): publish docs from your repo

You do **not** deploy Workers or use the platform admin API key.

1. Ask your platform operator for a **bootstrap token**
2. In your docs repo:

```bash
nrdocs init --token '<bootstrap-token>'
git add -A
git commit -m "Initialize nrdocs"
git push
```

Then check GitHub Actions and visit the URL printed by `nrdocs init` / `nrdocs status`.

Docs:
- [Onboarding (bootstrap token)](guides/onboarding-bootstrap/index.html)
- [OIDC publishing (secretless)](guides/oidc-publishing/index.html)

**If you operate the platform** (first-time install on Cloudflare):

1. Clone this repository and run `npm install`
2. Create the Cloudflare resources (D1 database, R2 bucket)
3. Configure the Wrangler files with your account ID and database ID
4. Run the database migration
5. Set the required secrets (API key, HMAC signing key)
6. Deploy both Workers
7. Register and approve a project via the Control Plane API, **or** issue bootstrap tokens so authors use **`nrdocs init`** instead
8. Publish content

Each operator step is covered in detail in the [Installation](guides/installation/index.html) and [Configuration](guides/configuration/index.html) guides.

Operator docs:
- [Administrator guide](guides/administrator/index.html)

## Testing without deploying

You can preview the site builder output locally without any Cloudflare account:

```bash
npm install
npm run preview
```

This builds the docs from the `docs/` directory and writes HTML to `dist-preview/`. Open any `index.html` in your browser to see the rendered output — including this page.
