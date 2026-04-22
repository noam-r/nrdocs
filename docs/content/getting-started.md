# Getting Started

nrdocs is a serverless documentation platform built on Cloudflare Workers, D1, and R2. It serves Markdown-based documentation sites under a single shared hostname like `docs.yourdomain.com/<project-slug>/`.

You're reading the nrdocs documentation right now — it's built and served by nrdocs itself.

## What you need

- A Cloudflare account (free tier works)
- Node.js 18+
- The Wrangler CLI (`npm install -g wrangler`)
- A domain managed by Cloudflare (for the Delivery Worker route)

## Quick start

1. Clone this repository and run `npm install`
2. Create the Cloudflare resources (D1 database, R2 bucket)
3. Configure the Wrangler files with your account ID and database ID
4. Run the database migration
5. Set the required secrets (API key, HMAC signing key)
6. Deploy both Workers
7. Register and approve a project via the Control Plane API
8. Publish content

Each step is covered in detail in the [Installation](guides/installation/index.html) and [Configuration](guides/configuration/index.html) guides.

## Testing without deploying

You can preview the site builder output locally without any Cloudflare account:

```bash
npm install
npm run preview
```

This builds the docs from the `docs/` directory and writes HTML to `dist-preview/`. Open any `index.html` in your browser to see the rendered output — including this page.
