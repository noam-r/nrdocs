# nrdocs 2.0 CLI, Configuration, and Credentials

## Status

This document specifies the nrdocs 2.0 command-line interface, publication-directory configuration, local state, and credential-resolution behavior.

It is authoritative for user-visible command names and local filesystem behavior. API payloads, Cloudflare resource schemas, token hashing, reader-session cryptography, and artifact transport are defined in later specifications.

## CLI Design Principles

### 1. One Publisher Path

The complete local publisher path is:

```bash
nrdocs connect ./docs
nrdocs preview ./docs
nrdocs publish ./docs
```

The repeat path is:

```bash
nrdocs publish ./docs
```

There is no `init` command.

### 2. One Directory Is One Publication Unit

The supplied directory is the publication root.

`nrdocs.yml` must be located directly inside that directory. The CLI does not:

- search parent directories;
- detect a project or repository root;
- follow a `source_dir` setting;
- infer the publication root from Git; or
- infer the site from the directory name.

### 3. Explicit Credential Pointer

`nrdocs.yml` identifies the intended destination through an opaque immutable site ID.

The secret token and server URL remain outside the publication directory. Unless a complete environment credential pair is supplied for the invocation, the CLI opens the exact local credential file named by the pointer. Environment credentials must resolve to that same expected site ID. The CLI never selects a credential heuristically.

### 4. Commands Have Narrow Responsibilities

- `connect` validates and stores publishing authority and creates or updates configuration.
- `preview` validates and renders locally.
- `publish` validates, renders, uploads, and promotes content.
- `generate nav` materializes editable navigation.
- `credentials` manages publisher-side local token storage.
- `site` manages serving destinations and reader access.
- `token` manages server-side publishing credentials.
- `instance` manages local administrative targeting.
- `deploy` provisions a new instance.

### 5. No Hidden Mutations

`publish` does not create configuration, connect a site, write credentials, alter reader access, or change site lifecycle.

`preview` does not write configuration or persistent output.

`generate nav` modifies only `nrdocs.yml`.

### 6. Secrets Do Not Appear in Arguments or Output

The CLI does not accept publishing tokens or reader passwords as ordinary command-line argument values.

Secrets are supplied through masked prompts, approved environment variables, or protected local credential files. Plaintext publishing tokens are printed only once at issuance.

### 7. Fail Rather Than Guess

Ambiguous or incomplete state is an error with a concrete remediation command.

The CLI must not guess based on:

- the only stored site credential;
- the active administrative instance;
- a directory or repository name;
- a Git remote;
- the most recently used site; or
- a token belonging to a different site.

### 8. Supported Operating Systems

nrdocs 2.0 officially supports Linux and macOS on the pinned Node.js runtime.

Windows is outside the 2.0 support contract. The CLI must fail at startup on Windows with a clear unsupported-platform message; it must not continue with best-effort credential protection or silently weaken filesystem requirements. Windows support may be added in a later release only with a normative credential-storage and ACL contract plus Windows CI coverage.

### 9. Administration Is Interactive

Every administrative mutation requires an attached interactive terminal before any durable or external mutation begins. This includes `deploy`, site creation and mutation, password changes, token issuance and revocation, and deletion.

The administrative command surface has no:

- `--yes`, confirmation-bypass, or unattended mode;
- JSON mode for mutating commands;
- reader-password or publishing-token secret supplied through an ordinary argument;
- nrdocs-specific administrator secret environment variable; or
- supported stdin pipe for secret or confirmation input.

Masked prompts and confirmations read directly from the terminal. If no interactive terminal is available, the command fails before mutation with a message directing the administrator to rerun it interactively.

Cloudflare authentication may still be resolved from the separately specified Cloudflare/Wrangler environment. That external authentication source does not bypass nrdocs interaction or confirmation requirements.

Publisher CI remains non-interactive through `nrdocs publish`, `NRDOCS_URL`, and `NRDOCS_TOKEN`. It does not gain administrative authority.

## Executable and Global Options

The executable name is:

```bash
nrdocs
```

It is provided by the public npm package `nrdocs`. Version 2.0 is installed or invoked through:

```bash
npm install --global nrdocs@2
npx nrdocs@2
```

There is no separate administrator, publisher, Worker, renderer, or platform-assets package for users to install.

All commands support:

```text
--help
--version
```

Read-oriented and status commands support:

```text
--json
```

Administrative commands support a one-command instance override:

```text
--instance <instance-id>
```

No global `--token`, `--profile`, or `--api-url` option exists.

## Command Surface

### Publisher commands

```text
nrdocs connect [directory]
nrdocs publish [directory]
nrdocs preview [directory]
nrdocs generate nav [directory]
nrdocs credentials list
nrdocs credentials remove <site-id>
```

### Administrative commands

```text
nrdocs deploy [--domain <hostname>] [--instance <instance-id>]

nrdocs instance list
nrdocs instance show [instance-id]
nrdocs instance use <instance-id>

nrdocs site create <slug>
nrdocs site list
nrdocs site show <slug>
nrdocs site access <slug> public|password
nrdocs site password change <slug>
nrdocs site enable <slug>
nrdocs site disable <slug>
nrdocs site rename <old-slug> <new-slug>
nrdocs site delete <slug>

nrdocs token issue <slug> --name <name> [--ttl <duration>]
nrdocs token list <slug>
nrdocs token revoke <slug> <name-or-token-id>
```

## Removed 1.x Commands

The following command concepts do not exist in 2.0:

```text
init
repos
status
approve
access set
password set
password allow
password disallow
rules
auth login
auth status
auth logout
profiles
config show
doctor
nav generate
```

`nrdocs generate nav` is the 2.0 navigation-materialization command.

## Directory Argument Resolution

Commands accepting `[directory]` use:

```text
1. The explicit positional directory when supplied.
2. Otherwise, the current working directory.
```

The selected directory is resolved to an absolute path before use.

The CLI looks only for:

```text
<resolved-directory>/nrdocs.yml
```

It does not search ancestors or descendants for another configuration.

## Publication Configuration

### File location

```text
<publication-root>/nrdocs.yml
```

### Minimal connected configuration

```yaml
publish:
  credential: site_01K3X9M7Q2F8

title: Product Handbook
navigation: auto
```

### Minimal preview-only configuration

```yaml
title: Product Handbook
navigation: auto
```

The preview-only form may be created by `generate nav` before the publisher receives a token. `publish` requires `publish.credential` even when environment credentials are supplied, because the pointer defines the expected destination.

### Allowed top-level fields

The initial 2.0 schema contains:

```text
publish
title
language
direction
navigation
```

No repository, build command, access request, password, server URL, theme, domain, plugin, JavaScript, CSS, search, export, or deployment setting is allowed in publication configuration.

Unknown fields are validation errors. This prevents misspelled settings from being silently ignored.

## `publish.credential`

Type:

```text
string
```

Required for:

```text
connect state
publish
```

Not required for:

```text
preview
generate nav
```

The value is the server-issued immutable site ID:

```yaml
publish:
  credential: site_01K3X9M7Q2F8
```

It is:

- an opaque lookup key;
- safe to commit;
- stable across slug rename;
- different after site deletion and recreation; and
- never inferred from a token filename, directory name, slug, or server URL.

## `title`

Type:

```text
valid title string
```

Required for:

```text
preview
publish
```

nrdocs never infers the site title from:

- an H1;
- a filename;
- the publication directory;
- the administrator-created slug; or
- the connected site metadata.

When creating configuration, `connect` and `generate nav` prompt for the title or accept:

```bash
nrdocs generate nav ./docs --title "Product Handbook"
```

The title is controlled by the publisher and becomes part of the rendered artifact. It follows the common title rules below.

### Common title rules

Site titles, explicit page and section titles, and automatically derived page and section titles use one validation contract. nrdocs:

1. removes leading and trailing code points with the Unicode `White_Space` property;
2. normalizes the result to Unicode NFC;
3. requires 1–160 Unicode scalar values after normalization; and
4. rejects code points in Unicode General Category `Cc`.

The normalized value is the value stored in the normalized publication graph, manifest, and rendered document. nrdocs never truncates, abbreviates, or otherwise rewrites an overlong title. Duplicate titles are allowed, including among siblings, because route uniqueness—not title uniqueness—identifies pages.

## `language`

Type:

```text
optional BCP 47 language tag
```

When omitted, the effective value is:

```yaml
language: und
```

`und` means that the document language is undetermined. An explicit value must contain exactly one structurally valid BCP 47 language tag. nrdocs canonicalizes it using the pinned runtime's BCP 47 canonicalization behavior and rejects malformed tags, lists of tags, and values that cannot be canonicalized.

nrdocs never infers language from page content, headings, filenames, the host locale, or the site slug. The effective canonical value becomes `site.language` in the manifest and the exact `lang` attribute on every rendered page.

## `direction`

Type:

```text
ltr | rtl | auto
```

When omitted, the effective value is:

```yaml
direction: auto
```

The effective value becomes `site.direction` in the manifest and the exact `dir` attribute on every rendered page. `auto` uses the browser's standard first-strong-character directionality behavior; nrdocs does not scan content to replace it with `ltr` or `rtl`.

`language` and `direction` are presentation metadata only. They do not affect site identity, authorization, routing, credential selection, or artifact ownership.

## `navigation`

The field accepts either:

```yaml
navigation: auto
```

or an explicit list:

```yaml
navigation:
  - title: Home
    file: index.md
  - title: Overview
    file: 01-overview.md
  - title: Guides
    file: 02-guides/index.md
    children:
      - title: Installation
        file: 02-guides/01-installation.md
      - title: Configuration
        file: 02-guides/02-configuration.md
```

### Explicit entry schema

Each entry contains:

```text
title: required valid title string
file: optional relative Markdown path
children: optional non-empty list of entries
```

An entry must contain `file`, `children`, or both.

When an entry contains both, its title is a navigable section landing page with nested children.

Root entries have depth 1. Each `children` edge increases depth by one, and depth 8 is the maximum. An explicit navigation tree deeper than eight levels is invalid.

### Explicit navigation validation

- Every file must exist within the publication root.
- Every file must have a `.md` extension.
- Every file and each of its directory components below the publication root must be a real filesystem entry, not a symbolic link.
- No path may escape the publication root.
- A file may appear only once.
- Generated routes must be unique.
- An explicit list defines the complete published page allowlist.
- A link to an unlisted Markdown file is a validation error.

## Automatic Navigation

### Naming convention

Automatic navigation uses:

```text
index.md
NN-slug.md
NN-slug/
```

`NN` is a two-digit ordering prefix within the containing directory.

Example:

```text
docs/
├── index.md
├── 01-overview.md
└── 02-guides/
    ├── index.md
    ├── 01-installation.md
    └── 02-configuration.md
```

### Ordering

- `index.md` is first within its directory.
- Discovery never follows a symbolic link.
- A symbolic link whose name would otherwise qualify as `index.md`, `NN-slug.md`, or `NN-slug/` is a validation error rather than a silently omitted page or section.
- Numbered files and Markdown-bearing directories are ordered by numeric prefix.
- Duplicate prefixes within one directory are validation errors.
- Asset-only directories do not participate in navigation.
- A Markdown-bearing directory becomes a navigation section.
- A section with `index.md` is navigable at the directory route and contains its child entries.
- A section without `index.md` is a non-clickable navigation heading containing its child entries.

### Titles

Automatic page-title resolution is:

```text
1. First H1 in the page.
2. Filename remainder with numeric prefix removed and words humanized.
```

Automatic directory-section titles are derived from the directory name with the numeric prefix removed and words humanized.

This page-title behavior does not determine the required site-level `title` setting.

Every derived title must satisfy the common title rules. Automatic discovery fails rather than truncating a title. Directory nesting that would create a navigation entry at depth 9 or greater is also a validation error.

### Nonconforming Markdown

When `navigation: auto` is active, a Markdown page other than `index.md`, or a directory containing Markdown descendants, that does not follow the numbered convention is a validation error.

The error recommends one of:

- renaming the file to the convention; or
- running `nrdocs generate nav` and editing explicit navigation.

## `nrdocs generate nav`

### Purpose

Materialize discovered Markdown pages into an explicit, editable navigation list.

### Usage

```bash
nrdocs generate nav [directory]
nrdocs generate nav [directory] --dry-run
nrdocs generate nav [directory] --force
nrdocs generate nav [directory] --title "Site Title"
```

### Discovery behavior

The command:

1. Recursively discovers Markdown files.
2. Places `index.md` first within each directory.
3. Uses numeric-aware path ordering for remaining files and directories.
4. Uses the first H1 as the proposed page title, then a humanized filename fallback.
5. Produces nested entries reflecting directory structure.

Unlike `navigation: auto`, generation may include nonconforming filenames because the resulting explicit list becomes the source of truth.

Generated navigation must satisfy the same eight-level depth and common title limits. The command fails without writing configuration when a generated title or tree violates them; it never truncates a title or flattens a tree.

### Write behavior

- If `nrdocs.yml` does not exist, the command creates it and requires a title.
- If `navigation: auto`, the command replaces it with the generated list.
- If explicit navigation exists, the command refuses unless `--force` is supplied.
- `--dry-run` prints the proposed navigation and writes nothing.
- The command preserves `publish`, `title`, `language`, `direction`, and unrelated settings.
- It never creates, modifies, renames, or deletes Markdown files.

The maximum total published page count is not a second navigation-specific setting. It is the shared artifact page-count limit defined by the security and resource-limit contract and enforced by automatic discovery, explicit navigation, preview, packaging, and Worker validation.

## Route Generation

### Site route

```text
https://<instance-origin>/<site-slug>/
```

### Page routes

The `.md` extension and ordering prefix are removed from every route segment:

```text
index.md                         -> /
01-overview.md                   -> /overview/
02-guides/index.md               -> /guides/
02-guides/01-installation.md     -> /guides/installation/
```

Routes are relative to the site root.

If the root has no `index.md`, `/` redirects to the first explicit or automatically navigable page.

Generated-route collisions are validation errors. For example:

```text
01-overview.md
02-overview.md
```

cannot both produce `/overview/`.

## Published Page and Asset Selection

### Pages

- Automatic navigation publishes all pages accepted by automatic discovery.
- Explicit navigation publishes only listed pages.

### Assets

The renderer parses selected pages and includes only supported local assets they reference.

Referenced assets must exist within the publication root. Broken, escaping, or unsupported references are validation errors.

Unreferenced files are not packaged or uploaded.

### Displayable image extensions

```text
.png
.jpg
.jpeg
.gif
.webp
.avif
.ico
```

Publisher-supplied `.svg` files are unsupported as both displayable assets and attachments. Mermaid fences remain supported and are rendered by the fixed nrdocs platform; they do not authorize SVG file upload.

### Linked attachment extensions

```text
.pdf
.txt
.csv
.json
.yaml
.yml
.toml
.xml
.ndjson
.zip
```

### Forbidden publisher-controlled web assets

```text
.html
.htm
.js
.mjs
.cjs
.css
.wasm
```

There is no extension override or per-site asset policy.

## Filesystem Portability and Symbolic Links

The selected publication root must be a real directory rather than a symbolic link, and `nrdocs.yml` must be a regular non-symbolic-link file directly inside it.

nrdocs never follows symbolic links while discovering or reading publication content. A selected page, referenced asset, or referenced attachment is invalid when either the entry itself or any directory component below the publication root is a symbolic link. A symbolic link that is neither a navigation candidate nor selected or referenced content is ignored and is never traversed or packaged.

All selected source-relative paths, generated public paths, and artifact object paths must be unique both exactly and by a portable collision key. The collision key is computed without changing the published spelling:

1. use `/` as the logical separator;
2. normalize the complete path to Unicode NFC; and
3. apply the pinned Node runtime's locale-independent Unicode lowercase conversion.

Two distinct paths with the same collision key are a validation error even when the current filesystem permits both. This rule applies across pages, assets, and attachments, including collisions between collections. Preview, artifact construction, and Worker validation use the same shared contract and conformance fixtures.

## Markdown Validation

Every Markdown page must be valid UTF-8. Before parsing, nrdocs:

1. accepts and removes one UTF-8 byte-order mark only when it is the first byte sequence in the file;
2. rejects a second or non-leading byte-order mark;
3. rejects malformed, truncated, or overlong UTF-8 sequences; and
4. normalizes CRLF and standalone CR line endings to LF in the parser input.

Line and column diagnostics refer to the normalized parser input after removal of an allowed leading byte-order mark.

The supported dialect is CommonMark plus only these extensions:

- GitHub-style tables;
- task lists;
- strikethrough;
- GitHub-style autolink literals;
- fenced code with an optional language identifier;
- Mermaid fences whose information string is exactly the lowercase token `mermaid` after trimming surrounding ASCII whitespace;
- relative links between published pages;
- safe external links; and
- referenced images and attachments.

CommonMark soft line breaks remain soft breaks and are not converted automatically to `<br>`.

The following are validation errors:

- raw HTML;
- MDX;
- iframes;
- YAML or TOML frontmatter delimiters at the beginning of a page;
- footnote definitions or references;
- math fences and TeX math delimiters;
- emoji-shortcode constructs;
- definition-list constructs;
- plugin or generic directive constructs;
- custom components;
- publisher-controlled scripts or styles; and
- unsupported local embeds.

A leading JSON object is not interpreted as frontmatter or metadata; without a code fence it is parsed as ordinary Markdown text. Dollar signs and colon-delimited text that do not form a recognized unsupported construct remain ordinary text. nrdocs never extracts page behavior or publication metadata from Markdown extensions.

The parser and every enabled extension are pinned implementation dependencies. A dependency update may not add syntax or change existing rendered fixtures without an explicit specification and fixture update.

Validation errors identify the source file and line where possible.

## Local Publisher Credential Store

### Root

```text
~/.nrdocs/sites/
```

### File naming

Each credential file is named only by the opaque immutable site ID:

```text
~/.nrdocs/sites/site_01K3X9M7Q2F8.json
```

The filename does not contain:

- the site slug;
- the site title;
- the server hostname;
- a directory name; or
- a publisher name.

### File contents

```json
{
  "server": "https://docs.example.com",
  "token": "nrd_pub_..."
}
```

No site name is required. The token resolves to its site on the server, and the CLI verifies that result against the filename and `nrdocs.yml` pointer.

### Filesystem permissions

On supported Linux and macOS systems:

```text
~/.nrdocs/                                  0700
~/.nrdocs/sites/                            0700
~/.nrdocs/sites/<site-id>.json              0600
```

Credential files are written atomically. The CLI refuses to use an invalid or insecure regular-file target or any credential path for which the required Unix permissions cannot be established and verified.

The initial 2.0 implementation stores the bearer token as plaintext inside the protected file. It does not implement application-level encryption or an operating-system keychain integration.

### `.env` behavior

nrdocs does not create, update, discover, or automatically load a project `.env` file.

Environment variables are supplied by the invoking shell or CI environment.

## Publisher Environment Variables

```text
NRDOCS_URL
NRDOCS_TOKEN
```

Rules:

- Both must be present together.
- They override the local credential-file contents for that invocation.
- They are never persisted.
- For `publish`, `nrdocs.yml` must contain `publish.credential`; environment-backed `connect` may establish that pointer after validating the token.
- When a configured pointer already exists, the server-reported site ID must match it unless interactive `connect` performs the separately confirmed rebinding flow.
- A mismatch aborts before artifact promotion.

No environment variable selects a site by slug.

## Credential Resolution for `publish`

The exact resolution algorithm is:

```text
1. Resolve the publication directory.
2. Load <directory>/nrdocs.yml.
3. Validate required title and navigation.
4. Read publish.credential as expected_site_id.
5. If NRDOCS_URL or NRDOCS_TOKEN is present:
     a. Require both.
     b. Use them for this invocation.
   Otherwise:
     a. Open ~/.nrdocs/sites/<expected_site_id>.json.
     b. Read server and token.
6. Validate the token with the server.
7. Require token_site_id == expected_site_id.
8. Continue validation, rendering, and upload.
```

There is no fallback after a missing file, incomplete environment pair, invalid token, or site mismatch.

## `nrdocs connect`

### Usage

```bash
nrdocs connect [directory] [--title <title>]
```

### Mode selection

`connect` has exactly two input modes:

1. If either `NRDOCS_URL` or `NRDOCS_TOKEN` is present, require both and use non-interactive environment-backed mode.
2. Otherwise, require an interactive terminal and use masked interactive mode.

An incomplete environment pair is a validation failure and never falls back to prompts. Environment-backed mode never prompts and never persists the URL or token.

### Interactive inputs

- Server URL through an interactive prompt.
- Publishing token through a masked interactive prompt.
- Site title through `--title` or, when the configuration lacks one and the option is absent, an interactive prompt.

The token is not accepted as an argument.

### Environment-backed inputs

- Server URL from `NRDOCS_URL`.
- Publishing token from `NRDOCS_TOKEN`.
- Site title from an existing valid configuration or `--title`.

In either mode, when a valid title already exists, an omitted `--title` preserves it. A supplied `--title` is normalized using the common title rules: an equal normalized value is an idempotent success, while a different value fails and instructs the publisher to edit `nrdocs.yml` explicitly. `connect` never acts as a site-title editing command. When no title exists, environment-backed mode requires `--title`; interactive mode prompts if it is absent.

### Validation

The server validation response must identify:

- the immutable site ID;
- the current slug;
- token status; and
- token expiration, when present.

If `nrdocs.yml` already contains a different site ID, the command refuses silent rebinding.

Interactive mode may continue only after showing both immutable site IDs and receiving explicit confirmation. Environment-backed mode fails with `site_mismatch` and writes nothing; it has no rebinding flag or confirmation bypass.

### Writes

Interactive mode writes:

```text
~/.nrdocs/sites/<site-id>.json
<directory>/nrdocs.yml
```

Environment-backed mode writes only:

```text
<directory>/nrdocs.yml
```

It does not create, replace, or delete `~/.nrdocs/sites/<site-id>.json`, even when such a file already exists.

For either mode, a new configuration contains the validated normalized title, the resolved opaque site ID as `publish.credential`, and `navigation: auto`. An existing configuration preserves all valid unrelated fields and existing navigation; if navigation is absent, `navigation: auto` is added. No write occurs until remote validation and all proposed local configuration validation succeed.

It does not write `.env`, Git configuration, CI configuration, or repository files.

## `nrdocs preview`

### Usage

```bash
nrdocs preview [directory]
```

### Requirements

- `nrdocs.yml` exists.
- `title` is valid.
- `navigation` is valid.

`publish.credential` and local credentials are not required.

### Behavior

- Uses production validation and rendering.
- Starts an ephemeral HTTP server bound only to `127.0.0.1`.
- Tries port 4173, then the first free port through 4273; if all are occupied,
  exits with a local-environment error and does not bind elsewhere.
- Prints the selected `http://127.0.0.1:<port>/` URL.
- Creates no persistent build directory.
- Uploads nothing.
- Does not mutate configuration.
- Does not watch files or launch a browser in the initial scope.

## `nrdocs publish`

### Usage

```bash
nrdocs publish [directory]
```

### Behavior

The command performs:

```text
configuration validation
credential resolution and destination validation
navigation and route validation
Markdown validation and rendering
reference and asset validation
manifest construction
artifact packaging
upload
atomic server promotion
```

The CLI prints the number of pages, images, and attachments before upload and the final site URL after promotion.

It never exposes, retains, lists, or labels previous publications.

## Local Administrative Instance Store

### Layout

```text
~/.nrdocs/
├── active-instance
├── cloudflare.env          # optional; operator-managed API token (mode 0600)
├── sites/
│   └── site_….json         # publisher credentials
└── instances/
    ├── inst_01K4A7Q2M9.json
    └── inst_01K5B3R8T1.json
```

`cloudflare.env` is created by the operator only. It is never written by deploy
and must not appear in instance descriptors.

### Active pointer

`active-instance` contains exactly one opaque instance ID:

```text
inst_01K4A7Q2M9
```

### Instance descriptor

```json
{
  "instance_id": "inst_01K4A7Q2M9",
  "display_name": "company-docs",
  "canonical_origin": "https://docs.example.com",
  "account_id": "cloudflare-account-id",
  "resource_suffix": "3f6m8p0q2r4s6t8v0w2x",
  "database_id": "d1-database-id",
  "bucket_name": "nrdocs-account3-3f6m8p0q2r4s6t8v0w2x-r2",
  "worker_name": "nrdocs-3f6m8p0q2r4s6t8v0w2x",
  "status": "active",
  "deployed_version": "2.0.0",
  "reconciliation": null
}
```

The descriptor contains no Cloudflare credential.

`status` is `provisioning`, `active`, or `degraded`. `reconciliation` is either
`null` or non-secret resumable progress written by deploy. Resource identity,
creation, resume, ownership-marker checks, and upgrade behavior are defined by
`08-cloudflare-deployment-and-operations.md`.

Instance filenames are opaque IDs. Hostnames and human-readable instance names do not appear in filenames.

`display_name` is required, persisted in both the local descriptor and D1 instance metadata, and used only for human-readable output. It is normalized to Unicode NFC, trimmed, 1–80 Unicode scalar values long, and contains no control characters. It need not be unique. It never selects an instance, grants authority, determines a hostname, or serves as a Cloudflare resource identifier; `instance use`, `instance show <instance-id>`, and `--instance` accept only the opaque instance ID.

## Administrative Authentication Resolution

Administrative commands:

1. Resolve the target instance from `--instance` or `active-instance`.
2. Resolve Cloudflare authentication through the exact API-token/OAuth order in
   `08-cloudflare-deployment-and-operations.md`.
3. Verify access to the targeted Cloudflare account and resource.
4. Perform the control-plane operation.

nrdocs does not write Cloudflare credentials into instance descriptors. The
operator may place an API token in `~/.nrdocs/cloudflare.env` (mode `0600`); the
CLI reads that file according to `08-cloudflare-deployment-and-operations.md`
but never creates or updates it during deploy.

If authentication is unavailable, the CLI directs the user to create
`~/.nrdocs/cloudflare.env`, set `CLOUDFLARE_API_TOKEN`, or run `wrangler login`.

Publisher credentials never authorize administrative commands, and the active administrative instance never selects a publisher destination.

## Site Command Semantics

### `site create`

Creates an enabled empty site, requires an access choice, prompts for a reader password when needed, and issues one initial named publishing token.

### `site list`

Displays slug, opaque site ID, lifecycle, access mode, content availability, token count, and last successful publication time.

It does not expose reader passwords, token values, or token hashes.

### `site show`

Displays one site's administrative state and current URL.

### `site access`

Performs an atomic access-mode transition.

- `public -> password` requires a new password.
- `password -> public` deletes the hash and requires explicit exposure confirmation.
- The command does not enable or disable the site.

### `site password change`

Replaces the password hash for a password-protected site and invalidates reader sessions. It is invalid for a public site.

### `site enable` and `site disable`

Change lifecycle only. They preserve content, access configuration, password, and tokens.

### `site rename`

Changes the public slug while preserving immutable identity and all other state. It warns that the previous URL will become 404.

### `site delete`

Permanently deletes site state and the current artifact after exact-slug confirmation. It creates no soft-delete or recovery state.

## Token Command Semantics

### Token properties

Each token has:

```text
opaque token ID
site ID
administrator-selected name
creation time
optional expiration
optional last-use time
active, expired, or revoked status
token hash
```

Token names are unique within a site.

Tokens do not expire by default.

### `token issue`

Generates an opaque high-entropy token, stores only its server-side verifier, and prints the plaintext once.

`--ttl` accepts one positive integer followed immediately by one lowercase unit, for example:

```bash
nrdocs token issue product-handbook \
  --name contractor \
  --ttl 7d
```

The grammar is:

```text
^[1-9][0-9]*(m|h|d|w)$
```

| Unit |  Exact duration |
| ---- | --------------: |
| `m`  |      60 seconds |
| `h`  |   3,600 seconds |
| `d`  |  86,400 seconds |
| `w`  | 604,800 seconds |

Whitespace, zero, signs, decimals, compound durations, uppercase units, months, and years are invalid. Numeric overflow and durations outside the limits defined by the security contract are rejected before mutation.

The persistence operation adds the exact duration to the authoritative D1 time inside the issuance transaction and stores the result as the canonical UTC RFC 3339 `expires_at` instant. The administrator workstation clock, timezone, and daylight-saving rules do not participate. An omitted option stores `expires_at: null`; tokens therefore have no scheduled expiration by default.

### `token list`

Displays token metadata and status without secret values.

### `token revoke`

Revokes one token without changing current content or other tokens.

## Output Requirements

### Human output

- Lead with the result.
- Identify the targeted site or instance.
- Print the next corrective command for recoverable errors.
- Never print stored secrets.
- Distinguish local credential removal from server token revocation.
- State explicitly when a failed publish left the live site unchanged.

### JSON output

List and show commands support `--json` with stable machine-readable fields.

Administrative mutating commands do not support `--json`. A newly issued publishing token is one-time human output written to the attached terminal after successful issuance and is never mixed with diagnostic logging.

### Destructive confirmation

- Public exposure requires explicit confirmation when removing password protection.
- Rename requires confirmation after showing both URLs.
- Delete requires typing the exact current slug.
- Token revocation identifies the token name and site before confirmation.

## Process Exit Codes

Every released command uses this stable process-exit taxonomy:

|  Code | Category                     | Required use                                                                                                                                                                                        |
| ----: | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   `0` | Success                      | Completed work, `unchanged`, valid dry run, already-satisfied idempotent operation, or an administrator intentionally declining confirmation                                                        |
|   `2` | Usage                        | Unknown command or option, missing or malformed argument, or invalid option combination                                                                                                             |
|  `10` | Local validation             | Invalid or missing `nrdocs.yml`, Markdown, navigation, local reference, title, route, artifact size precheck, or other publisher-controlled input                                                   |
|  `20` | Credential or authority      | Missing or unsafe credential, failed authentication, insufficient authority, deleted credential target, descriptor identity mismatch, or publishing site mismatch                                   |
|  `30` | Retryable external condition | Publication conflict, rate limit, network failure, timeout, or temporary Cloudflare or nrdocs service failure                                                                                       |
|  `40` | Compatibility or protocol    | Unsupported API or artifact version, non-retryable API contract rejection, invalid server response, or a server rejection showing that the installed CLI and instance cannot interoperate correctly |
|  `50` | Local I/O or state           | Filesystem read/write failure, atomic local-state replacement failure, or inability to establish the required local permissions                                                                     |
|  `70` | Internal software            | Unexpected invariant violation or uncategorized nrdocs defect                                                                                                                                       |
| `130` | Interrupted                  | User interruption handled by the CLI                                                                                                                                                                |

`--help` and `--version` return `0`. A command never returns `0` after a partial or uncertain mutation unless the command has positively established the documented successful or unchanged state.

When more than one problem could apply, the command reports the first failure encountered in its specified execution order. The numeric exit code represents the remediation category; it does not replace a precise safe human message or stable string error code. Commands supporting `--json` include both the string error code and numeric `exit_code` on failure.

### Publisher HTTP mapping

The publisher CLI maps the API contract as follows:

| API or transport result                                                                                                                     | Exit code |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------: |
| `invalid_token`, `site_mismatch`, or equivalent target-authority failure                                                                    |      `20` |
| `publish_in_progress`, HTTP `429`, `publication_failed`, `temporarily_unavailable`, network error, or timeout                               |      `30` |
| `artifact_too_large`                                                                                                                        |      `10` |
| `invalid_request`, `unsupported_artifact_format`, `invalid_artifact`, `digest_mismatch`, unsupported version, or malformed success response |      `40` |

An unrecognized HTTP `4xx` response maps to `40`; an unrecognized HTTP `5xx` response maps to `30`. Administrative Cloudflare failures use the same semantic categories: authority failures map to `20`, retryable platform failures to `30`, and local descriptor or filesystem failures to their local categories.

## Required Error Messages

### Missing configuration

```text
nrdocs.yml was not found in:
  /work/product/docs

Run:
  nrdocs connect /work/product/docs

Or prepare an unconnected preview configuration with:
  nrdocs generate nav /work/product/docs
```

### Missing local credential

```text
No local credential exists for:
  site_01K3X9M7Q2F8

Run:
  nrdocs connect /work/product/docs
```

### Site mismatch

```text
Publishing credential does not match this directory.

Expected site: site_01K3X9M7Q2F8
Token site:    site_01K8D4R6P1A3

Nothing was uploaded.
```

### Invalid navigation filename

```text
Automatic navigation cannot order:
  guides.md

Rename it using the NN-slug.md convention, or run:
  nrdocs generate nav
```

### Failed publish

```text
Publish failed during upload.

The currently published site was not changed.
```

## CLI Acceptance Criteria

The CLI and local configuration satisfy this specification when:

1. A publisher can connect and publish without Git or a project repository.
2. A directory selects its destination through one opaque configuration pointer.
3. Site names and server hostnames do not appear in local credential filenames.
4. Tokens never appear in project configuration or ordinary command arguments.
5. Multiple sites and multiple instances can be managed without inference.
6. `preview` requires no publishing authority and writes no persistent artifact.
7. `publish` cannot silently target a different site.
8. Automatic navigation requires deterministic naming.
9. Explicit navigation can be generated and edited without another generation command being required.
10. Administrative commands use Cloudflare authority and do not require nrdocs administrator credentials.
11. Site access, password lifecycle, lifecycle state, and publishing tokens remain distinct command concepts.
12. Removed 1.x repository and approval commands do not reappear under new names.
