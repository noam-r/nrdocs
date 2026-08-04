# Dependency, license, secret, and bundle-content review

**Date:** 2026-08-04  
**Scope:** Published `nrdocs` release unit and workspace packages  
**Status:** No release blockers identified for the RC; re-check before `v2.0.0` tag

## Dependencies

| Package                                                         | Role                   | Notes                       |
| --------------------------------------------------------------- | ---------------------- | --------------------------- |
| `yaml`                                                          | CLI config parse       | MIT; npm registry           |
| `highlight.js`                                                  | Renderer syntax        | BSD-3-Clause; pinned        |
| `mdast-util-*` / `micromark-extension-gfm` / `unist-util-visit` | Markdown pipeline      | MIT                         |
| `linkedom`                                                      | Worker HTML validation | ISC; bundled into Worker    |
| `esbuild`                                                       | Release bundling only  | MIT; not shipped in tarball |

Workspace packages (`@nrdocs/*`) are private and **inlined** into `dist/bin.bundle.js`
and `packaged/worker.mjs`. The packed `package.json` must not contain `workspace:`.
Registry dependencies (`yaml`, `highlight.js`, and mdast/micromark helpers) remain
declared so Node can resolve them after `npm install`.

## Secrets

- Publisher tokens and reader passwords never appear in argv, logs, or JSON
  success payloads (covered by admin/reader tests).
- `NRDOCS_SESSION_KEY` is a Worker secret; CLI never persists it.
- Cloudflare tokens are resolved ephemerally (`CLOUDFLARE_API_TOKEN` or Wrangler).
- Bundle-content scan: release Worker/CLI bundles must not embed live tokens
  (packaged assets are generated from source only).

## Bundle content

`pnpm --filter nrdocs run pack:check` asserts:

- clean install of the tarball outside the monorepo
- `packaged/worker.mjs` present and not the smoke stub
- `packaged/reader.css` present
- CLI `--help` starts
- no `workspace:` protocol in installed `package.json`
