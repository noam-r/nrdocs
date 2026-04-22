# nrdocs — Executive Summary

## What nrdocs is
**nrdocs** is a serverless platform for publishing private or public documentation minisites from Markdown repositories.

Each project is published under a single shared hostname using a path-based slug:

- `docs.example.com/<slug>/`

The platform is designed to be simple, low-cost, and easy to operate while still supporting protected content.

## Core idea
A project owner keeps documentation in a single repository.
That repository contains Markdown content plus a small project configuration contract.

When a project is approved and published:
- the content is built into a static site
- the static files are uploaded to Cloudflare R2
- platform state is updated in the database
- access rules are reconciled as needed
- requests are served through a thin Cloudflare Worker

This keeps the content static while allowing access control to be handled dynamically.

## Why this approach
The platform exists to solve a specific problem:
- GitHub Pages and similar static hosting approaches expose content too easily when artifacts or repositories are public
- browser-side encryption is not enough if the built site itself is publicly retrievable

nrdocs fixes this by making access control part of the delivery path, not part of the page rendering logic.

## Main design principles
- **One repo per project** for simplicity and isolation
- **One shared hostname** for all projects
- **Immutable slug** per project
- **Custom Markdown format** instead of MkDocs
- **Serverless architecture** using Cloudflare only
- **Static content + dynamic access control**
- **Admin-controlled effective state** in the database
- **Repo config as desired state**, not final authority

## Access model
Phase 1 supports two access modes:
- `public`
- `password`

A future phase adds:
- `invite_list`

Access evaluation follows these rules:
- deny always wins
- repos may only declare `allow` entries
- repos may only affect their own project
- database policy overrides take precedence over repo-declared desired state

This allows platform admins to enforce global or project-level policy while still letting repo owners manage their own intended sharing.

## Main building blocks
- **GitHub repository**: source of content and project config
- **GitHub Actions**: build and publish workflow
- **Cloudflare R2**: storage for built static site artifacts
- **Cloudflare Worker**: thin request router and auth gate
- **Platform database**: projects, policy overrides, repo-derived access state, publish state
- **Cloudflare Access**: planned enforcement mechanism for future identity-aware invite-based access

## Publish model
Projects are explicitly registered through an admin API.
A project must be approved before it can publish.

Publishing:
1. reads repo configuration
2. builds the site
3. uploads files to R2
4. updates repo-derived desired access state in the DB
5. reconciles edge access rules when needed

If a project is disabled, it returns `404` and publishing is blocked.

## Why a Worker is included
The site content is static, but protected access requires a thin server-side layer.
The Cloudflare Worker provides that layer.

It is responsible for:
- resolving the project slug from the path
- deciding whether a project is `public` or `password` protected
- validating password sessions for protected projects
- serving the correct static content from R2

This keeps the platform fully serverless while still enabling real access control.

## Outcome
nrdocs is best understood as a **private docs publishing platform**, not just a static site host.

It combines:
- repo-driven content
- admin-governed access control
- low-cost serverless delivery
- a simple upgrade path from `public` and `password` to future invite-based sharing
