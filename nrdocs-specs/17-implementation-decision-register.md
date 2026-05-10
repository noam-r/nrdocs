# 17 — Implementation Decision Register

This file is the authoritative MVP decision register for nrdocs. When another spec file appears ambiguous, implementation must follow this register and the non-negotiable invariants in [`01-non-negotiable-invariants.md`](./01-non-negotiable-invariants.md).

The purpose of this file is to prevent an implementation agent from choosing between multiple possible designs. MVP behavior must have exactly one selected behavior.

## Product Shape

| Topic | MVP Decision | Explicitly Not MVP |
|---|---|---|
| Product type | Self-hosted, single-operator/company docs publishing layer | Multi-tenant SaaS |
| Primary user unit | GitHub repository | Project UUIDs or user-created projects |
| Visibility model | Protected-first; invisible until operator policy allows serving | Public-by-default publishing |
| Server model | Serverless only | Persistent app server, VM daemon, background server |
| Build execution | GitHub Actions runs builds/rendering | nrdocs server cloning repos or executing repo code |

## Human Flows

| Topic | MVP Decision | Notes |
|---|---|---|
| Operator deploy | `nrdocs deploy` is the supported deployment path | Manual Wrangler use is advanced/debugging only |
| Repo owner init | `nrdocs init` creates docs skeleton and workflow | Default prompt does not ask for requested access |
| Repo owner publish | `git push` triggers GitHub Action; Action runs `nrdocs publish` | No publish token or repo UUID required |
| Pending approval | Publish succeeds and uploads artifacts; site remains hidden | Pending is not a GitHub Action failure |
| Manual approval | `nrdocs approve OWNER/REPO --access public|password` | Access mode is required |
| Password approval | `approve --access password` prompts to set password if missing | Separate `nrdocs password set OWNER/REPO` remains available |
| Auto-approval | Pattern rules `OWNER/*` and `OWNER/REPO` are supported | Rules grant approval/access only; no other privileges |
| Pre-approval | Use auto-approval/pre-approval rules | Do not create fake approved repo rows without verified GitHub repo ID |
| Repo-owner status | GitHub Action summary | Local unauthenticated `nrdocs status` is not MVP |
| Operator status | `nrdocs repos` and `nrdocs status OWNER/REPO` | Requires operator token |

## Identity and Approval

| Topic | MVP Decision |
|---|---|
| Stable repo identity | GitHub `repository_id` from verified OIDC claims |
| Display identity | Lowercase-normalized `owner/repo` for routing, matching, and storage; display casing is optional metadata only |
| Case normalization | All `owner/repo` identity keys (`full_name`, `owner`, `name`) are stored lowercase in D1. Route matching normalizes incoming paths to lowercase before lookup. Auto-approval patterns are stored and matched lowercase. Case never affects security or routing decisions. |
| Repo identity source | Server derives identity from verified GitHub OIDC token, not request body |
| Manual approval target | Existing discovered repo record with verified GitHub repository ID |
| Pre-approval target | Auto-approval/pre-approval rule matching `OWNER/*` or `OWNER/REPO` |
| Repo rename | New route may become active after verified publish/update; old route returns 404 in MVP |
| Repo transfer | Conservative review/reapproval behavior; do not silently preserve old approval across owner transfer |
| Disabled repo | Publish is rejected before artifact validation or storage; serving always returns 404 |

## State Model

| Topic | MVP Decision |
|---|---|
| Approval states | `pending`, `approved`, `disabled` |
| Access modes | `none`, `public`, `password` |
| Build states | `uploading`, `success`, `failed` (data model canonical values) |
| Serving status | Derived from approval, access, artifact, and password state |
| `needs_password` | Approved password repo with no password credential; not live and not an Action failure |
| Approval changes | Metadata-only; no rebuild, artifact copy, or repush |
| Access changes | Metadata-only; no rebuild, artifact copy, or repush |

## Rendering and Content

| Topic | MVP Decision | Explicitly Not MVP |
|---|---|---|
| Rendering model | nrdocs CLI renders Markdown to static HTML | Custom output upload such as `nrdocs publish --output dist/docs` |
| Markdown parser | `markdown-it` with `html: false` and GFM tables enabled | Other parsers, MDX, custom plugins |
| Source format | Markdown `.md` | MDX, arbitrary site generators |
| Raw HTML | Escaped/disabled | Raw HTML allowlist or sanitizer path |
| JavaScript | Repo-provided JavaScript rejected/unsupported | Custom repo JS, external scripts via raw HTML |
| CSS | Platform-provided CSS only | Repo-provided CSS |
| Navigation | Auto-discovery by default; optional explicit nav list supported | Complex nav plugins |
| Internal links | Markdown `.md` links normalized to canonical clean URLs | Leaving `.md` links in generated HTML |
| External links/images | Allowed with publish notices | Blocking normal external URLs |

## Media and Assets

| Topic | MVP Decision |
|---|---|
| Local assets | Copied from docs source into artifact after validation |
| Site-root local paths | `/assets/image.png` resolves relative to docs source root and serves under `/OWNER/REPO/assets/image.png` |
| Relative local paths | Resolve relative to the Markdown file, then must remain inside docs source root |
| Boundary checks | Reject paths that escape docs root, unsafe archive paths, unsafe filenames, symlinks/hardlinks/device files, and duplicates after normalization |
| External references | Allowed with notice; nrdocs only protects assets it stores and serves |
| Archive upload | Single-request `multipart/form-data` through Worker API |
| Archive format | `.tar.gz` only in MVP; `.zip` is future work |
| Archive size | Configured limit, default 50 MB |
| Multipart/direct upload | Future work |
| Unknown asset types | Rejected in MVP |
| `.js` assets | Rejected in MVP |
| SVG | Allowed; served with explicit protective headers |
| PDFs | Allowed if extension is allowlisted and size limits pass |

## Routing

| Topic | MVP Decision |
|---|---|
| Repo docs base | `/OWNER/REPO/` |
| Page URL style | Clean directory-style canonical URLs |
| `docs/index.md` | `/OWNER/REPO/` |
| `docs/page.md` | `/OWNER/REPO/page/` |
| `docs/guide/setup.md` | `/OWNER/REPO/guide/setup/` |
| Generated artifact for page | `page/index.html` |
| Canonical HTML | Every generated HTML page includes `<link rel="canonical" ...>` |
| Redirects | `/OWNER/REPO`, `/OWNER/REPO/index.html`, `/OWNER/REPO/page`, `/OWNER/REPO/page.html`, and `/OWNER/REPO/page/index.html` redirect to canonical URLs after access checks |
| Pending/unknown/disabled redirects | Do not redirect; return non-revealing 404 |
| Reserved paths | `/api/*`, `/_nrdocs/*`, `/`, `/favicon.ico`, `/robots.txt`, `/.well-known/*` |
| Reserved path collision | Reserved platform paths take unconditional priority. A repo whose canonical route starts with a reserved segment may publish and appear in operator listings, but is unroutable until future custom slug support. |

## Instance Static Files

| Topic | MVP Decision |
|---|---|
| Homepage | `/` serves operator-owned static homepage |
| Default static files | Initial deployment installs bundled defaults |
| Supported instance static routes | `/`, `/favicon.ico`, `/robots.txt`, `/.well-known/*` |
| Static management | `nrdocs static list`, `nrdocs static set TYPE PATH`, `nrdocs static remove TYPE` |
| Static ownership | Operator-owned, separate from repo docs artifacts |

## Operator CLI Configuration

| Topic | MVP Decision |
|---|---|
| Default credential store | Local per-user config file; no env var exports required for normal usage |
| Config path (Linux/macOS) | `$XDG_CONFIG_HOME/nrdocs/config.json` or `~/.config/nrdocs/config.json` |
| Config path (Windows) | `%APPDATA%\nrdocs\config.json` |
| Config file permissions | User-only (0700 directory, 0600 file on Unix) |
| Deploy saves profile | `nrdocs deploy` saves local profile by default after successful deployment |
| Resolution priority | 1. CLI flags → 2. Environment variables → 3. Local config profile → 4. Interactive prompt (deploy/auth only) |
| Multi-profile support | MVP supports named profiles; `default` is used when no profile is specified |
| Auth commands | `nrdocs auth login`, `nrdocs auth status`, `nrdocs auth logout` |
| Env vars for CI | `NRDOCS_API_URL` and `NRDOCS_OPERATOR_TOKEN` remain supported as overrides |
| Security model | Local config is a convenience credential store; OS keychain integration is future work |

## API and Auth

| Topic | MVP Decision |
|---|---|
| Publish auth | GitHub OIDC only |
| Operator auth | Exactly one deployment-level operator token configured as a Worker secret |
| Operator token storage | No D1 operator token table in MVP |
| Operator token comparison | Constant-time comparison or equivalent safe comparison |
| Password hashing | Web Crypto PBKDF2-HMAC-SHA-256 with per-password salt, deployment-configured iteration count (default 100,000), and password version metadata. Implementation must include a CPU impact acceptance test before raising the default. |
| Password storage | Store only derived hash, salt, iteration count, and metadata |
| Password policy | Minimum 8 characters, maximum 128 characters, no complexity requirements; deployment-configurable |
| Reader sessions | Signed HttpOnly cookies or equivalent serverless-compatible mechanism |
| Session secret | `NRDOCS_SESSION_SECRET` Worker secret; auto-generated by `nrdocs deploy`; signs/encrypts password-session cookies; never stored in D1/R2; rotation invalidates all active sessions |
| API errors | Use structured `{ ok: false, error: { code, message, details? } }` |

## Security Headers

| Asset/Page | MVP Decision |
|---|---|
| HTML pages | CSP disallows repo JS; deny framing; no sniffing |
| SVG assets | `Content-Security-Policy: script-src 'none'; object-src 'none'; base-uri 'none'` and `X-Content-Type-Options: nosniff` |
| R2 | Private bucket only; no direct public R2 URLs |
| Pending/disabled/unknown | Anonymous readers receive non-revealing 404 |

## Rate Limiting

| Topic | MVP Decision |
|---|---|
| Password throttle | 5 failed attempts per repo per client key per 5 minutes → 5-minute lockout |
| Client key | IP address or Cloudflare-provided client identifier |
| Other rate limits | Deferred to post-MVP; rely on Cloudflare platform limits |

## Deployment

| Topic | MVP Decision |
|---|---|
| Supported deploy path | `nrdocs deploy` |
| Instance naming | All resources use `nrdocs-{instance}` prefix: Worker = `nrdocs-{instance}`, D1 = `nrdocs-{instance}-db`, R2 = `nrdocs-{instance}-artifacts` |
| Instance name rules | Lowercase alphanumeric + hyphens, 1–20 chars, no leading/trailing hyphens |
| Default instance name | `default` (produces `nrdocs-default`, `nrdocs-default-db`, `nrdocs-default-artifacts`) |
| Uniqueness check | First deploy verifies instance name is not already in use on the Cloudflare account |
| Multi-instance | Supported — same account can have `nrdocs-prod` and `nrdocs-staging` |
| Deploy responsibilities | create/check D1, create/check R2, apply migrations, configure Worker env/secrets, deploy Worker, install static defaults, health check |
| Non-interactive deploy | Supported with flags for automation |
| Manual Wrangler | Advanced/debugging escape hatch only |

## Testing Gate

Implementation is not considered MVP-complete unless tests prove:

1. Protected-first behavior for all repo states.
2. Publish succeeds for pending repos but fails for disabled repos.
3. Approval/access changes are metadata-only.
4. `needs_password` does not serve docs.
5. Canonical redirects occur only after access checks.
6. Unknown/pending/disabled repos are indistinguishable to anonymous readers.
7. Raw HTML and repo JavaScript cannot execute.
8. SVG protective headers are present.
9. `nrdocs deploy` installs default instance static files.
10. The GitHub Action summary is sufficient for repo-owner status.
