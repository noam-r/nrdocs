# nrdocs

**GitHub Pages-style documentation publishing for private repositories.**

nrdocs lets you publish documentation from a private GitHub repository without making the repository public and without maintaining a separate public docs repo.

Keep your docs next to your code, publish from a dedicated branch like `nrdocs`, and serve the generated site publicly or behind simple password protection on Cloudflare Workers, D1, and R2.

## Why nrdocs?

GitHub Pages is great when your source repository can be public. But many projects cannot expose their source code:

* private products
* client work
* internal tools
* commercial libraries
* closed-source apps with public documentation
* projects where docs should be public but code must remain private

The usual workaround is awkward: create a second public repository just for docs, copy files between repos, wire up deployment separately, and keep documentation in sync with code by hand.

nrdocs avoids that.

You keep documentation in the same repo as the project, optionally on a dedicated `nrdocs` branch, and publish it through GitHub Actions to a Cloudflare-hosted docs site.

## What nrdocs does

nrdocs provides the missing publishing layer between Markdown documentation in a private repository and a hosted documentation website.

It handles:

* publishing docs from private GitHub repositories
* keeping docs in the same repo as the code
* using a dedicated docs branch such as `nrdocs`
* serving docs publicly or behind password protection
* routing many docs projects under one shared hostname
* registering and approving projects through a control plane
* publishing through GitHub Actions without exposing the platform API key to repo owners
* storing generated artifacts in Cloudflare R2
* serving docs through Cloudflare Workers
* tracking project state in Cloudflare D1

nrdocs is not trying to replace MkDocs, Docusaurus, or other documentation generators. Those tools build static documentation sites. nrdocs focuses on the publishing, routing, access, and serving layer for docs that live in private repositories.

The built-in Markdown renderer gives you a zero-config path for simple docs. Future versions may support bringing your own static site output from tools like MkDocs or Docusaurus.

## Core workflow

```text
Private GitHub repo
  └─ nrdocs branch or docs directory
       └─ GitHub Actions publish workflow
            └─ nrdocs Control Plane Worker
                 ├─ build docs
                 ├─ upload static artifacts to R2
                 └─ update live project state in D1

Reader
  └─ docs.example.com/my-project
       └─ nrdocs Delivery Worker
            ├─ resolve project
            ├─ enforce access policy
            └─ serve static files from R2
```

## Example use cases

### Public docs for a private codebase

Your product source code is private, but the documentation should be public.

Put docs in the same repo, publish through nrdocs, and expose only the generated documentation site.

### Private docs for a private project

Your team wants internal documentation without exposing the repository or setting up a full documentation platform.

Publish docs through nrdocs and protect them with a password.

### Same-repo docs without a public mirror

Your project already has code, issues, pull requests, and releases in one repository.

Use a dedicated `nrdocs` branch or docs directory so documentation changes can be reviewed and updated alongside code changes without creating a second public docs repository.

### Many small documentation sites under one domain

A platform operator can run nrdocs once and let multiple repo owners publish docs under a shared hostname:

```text
docs.example.com/project-a/
docs.example.com/project-b/
docs.example.com/acme/project-c/
```

## Who is nrdocs for?

### Repository owners

You own a project repo and want to publish its docs.

You should be able to:

1. receive a bootstrap token from your platform operator
2. run `nrdocs init`
3. commit the generated docs structure and workflow
4. push the docs branch
5. get a hosted docs URL

You should not need to know how Cloudflare Workers, D1, R2, Wrangler, or the platform API key work.

### Platform operators

You run the shared nrdocs infrastructure.

You are responsible for:

* deploying the Control Plane Worker
* deploying the Delivery Worker
* configuring D1 and R2
* issuing bootstrap tokens
* approving projects
* managing platform secrets
* keeping the platform API key private

Repo owners should never need the platform API key.

## Quick start

### 1. Deploy nrdocs infrastructure

```bash
git clone https://github.com/noam-r/nrdocs.git
cd nrdocs
./scripts/setup.sh
wrangler login
./scripts/deploy.sh
```

The deploy script creates and configures the required Cloudflare resources:

* Workers
* D1 database
* R2 bucket
* secrets
* migrations
* environment configuration

For local preview without Cloudflare:

```bash
npm run preview
```

For full deployment details, see the installation guide.

### 2. Onboard a repository

If you are a repo owner and received a bootstrap token from your operator:

```bash
nrdocs init --token <bootstrap-token>
nrdocs status
```

`nrdocs init` scaffolds the documentation structure, registers the project, and generates a GitHub Actions workflow for publishing.

After that, commit and push:

```bash
git add -A
git commit -m "Initialize nrdocs"
git push
```

Push to the configured publish branch to publish the docs.

## Repository structure

A basic nrdocs project looks like this:

```text
my-project-docs/
├── project.yml               # slug, title, description
├── nav.yml                   # sidebar navigation
├── content/                  # Markdown pages
│   ├── getting-started.md
│   └── guides/
│       └── installation.md
└── .github/workflows/
    └── publish-docs.yml      # generated by nrdocs init
```

Pages are plain Markdown. Page titles come from `nav.yml` labels, so frontmatter is not required for basic usage.

## URL structure

nrdocs serves many documentation projects under one shared hostname.

For the default organization:

```text
docs.example.com/<project-slug>/...
```

For named organizations:

```text
docs.example.com/<org-slug>/<project-slug>/...
```

Project slugs are unique within an organization.

## Architecture

nrdocs runs on Cloudflare:

* **Delivery Worker** — serves reader traffic, resolves projects from URLs, enforces access policies, and serves static assets from R2.
* **Control Plane Worker** — handles project registration, approval, publishing, lifecycle management, and access policy changes.
* **D1** — stores project metadata, approval state, access policy, and live deployment pointers.
* **R2** — stores generated static site artifacts.
* **GitHub Actions** — publishes documentation from the source repository.

```text
GitHub Repo ──push──▶ GitHub Actions ──publish──▶ Control Plane Worker
                                                        │
                                                        ├─ build site
                                                        ├─ upload artifacts to R2
                                                        └─ update D1 state

Reader ──GET──▶ Delivery Worker ──lookup D1──▶ serve from R2
```

## Access modes

Each project can be served as:

* **public** — anyone with the URL can read the docs
* **password-protected** — readers must enter the project password before accessing the docs

More advanced access policies can be added later without changing the core publishing model.

## CLI

The `nrdocs` CLI supports both repository-owner onboarding and platform-operator commands.

### Repository-owner commands

```bash
nrdocs init --token <bootstrap-token>
nrdocs status
```

These commands are for project authors. They do not require the platform API key.

### Operator commands

```bash
nrdocs admin register
nrdocs admin list
nrdocs admin approve <project-id> --repo-identity github.com/org/repo
nrdocs admin disable <project-id>
nrdocs admin delete <project-id>
nrdocs admin status <project-id>
nrdocs admin quick-guide
```

Admin commands are for platform operators only and require access to the control plane configuration.

## Development

```bash
npm test
npm run build:cli
npm run nrdocs:cli -- --help
npm run preview
npx tsc --noEmit
```

## Project status

nrdocs is an early open-source tool. The current focus is making the private-repo publishing flow simple, reliable, and easy to operate.

The most important product goal is friction reduction: a repo owner should be able to publish docs from a private repo with one initialization command and a normal Git push.

## License

Apache License 2.0.

nrdocs is open source and may be used, modified, and distributed for private, commercial, and open-source projects under the terms of the Apache-2.0 license.