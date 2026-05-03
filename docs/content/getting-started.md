# Getting Started

nrdocs is a serverless documentation platform built on Cloudflare Workers, D1, and R2. It serves Markdown-based documentation sites under a single shared hostname. Typical reader URLs are **`https://<delivery-host>/<site-slug>/…`** (single-tenant flat routing).

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

1. Ask your platform operator for:
   - the **Control Plane URL** (the HTTPS base URL of the Control Plane Worker — same idea as `NRDOCS_API_URL` in operator docs)
   - your **repo id**: a **UUID** assigned when the site was **registered on the control plane**. It is not something you derive from the repo name or from `project.yml` slug; someone with operator access must register the site (or look up an existing row) and send you that id.

   **If you operate the platform yourself:** run **`nrdocs admin register`** from the docs tree (or use **`POST /repos`**); the response and CLI output include the **repo id**. **`nrdocs admin list`** shows the same value in the **ID** column. Use that UUID in **`nrdocs init --repo-id`**.

   **After a successful `init` on your machine:** the id is stored in **`.nrdocs/status.json`** and shown by **`nrdocs status`** — useful for the same checkout, not for “discovering” an id before the operator registers the site.

2. In your docs repo:

```bash
nrdocs config set api-url '<control-plane-url>'
nrdocs init --repo-id '<repo-id>'
# Alternative: nrdocs init --api-url '<control-plane-url>' --repo-id '<repo-id>'
git add -A
git commit -m "Initialize nrdocs"
git push
```

Then check GitHub Actions and visit the URL printed by `nrdocs init` / `nrdocs status`.

If you choose `password` access mode during `init`, the CLI will prompt you to set an initial password so the site is private from the first publish.

Docs:
- [Onboarding a repository](guides/onboarding-bootstrap/index.html)
- [OIDC publishing (secretless)](guides/oidc-publishing/index.html)

**If you operate the platform** (first-time install on Cloudflare):

1. Clone this repository and run `npm install`
2. Create the Cloudflare resources (D1 database, R2 bucket)
3. Configure the Wrangler files with your account ID and database ID
4. Run the database migration
5. Set the required secrets (API key, HMAC signing key)
6. Deploy both Workers
7. Register and approve a site so authors can publish via OIDC — registration must set **`repo_identity`** to `github.com/<owner>/<repo>` (use **`nrdocs admin register`** or **`POST /repos`** with that field; see [Publishing](guides/publishing/index.html))
8. Hand authors the control plane URL + repo id; they run **`nrdocs config`** / **`nrdocs init --repo-id`** and push (content publishes from CI)

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
