# nrdocs 2.0 User Journeys and Lifecycle

## Status

This document specifies the user-visible journeys and lifecycle behavior for nrdocs 2.0.

Implementation details are intentionally limited. API schemas, database tables, storage keys, cryptography, Cloudflare permissions, and security controls belong in later specifications.

## Actors

### Administrator

The administrator has valid Cloudflare authority over the account containing the nrdocs instance.

Administrator actions are performed through the nrdocs CLI and Cloudflare control plane. nrdocs has no separate administrator login.

All administrator mutations require an interactive terminal. nrdocs 2.0 provides no unattended administrator mode, confirmation-bypass flag, or environment-variable channel for reader passwords and newly issued publishing tokens. This restriction does not prevent Cloudflare authentication from being resolved through its supported external environment.

### Publisher

The publisher possesses an opaque token granting publication authority to one site.

The publisher may use that token from a local CLI credential store or through environment variables in CI.

### Reader

The reader visits a direct site URL. The reader is anonymous for public sites and receives a site-scoped session after entering the shared password for a protected site.

## User-Visible Resources

### Instance

A deployed nrdocs service with one canonical public origin.

### Site

An administrator-created serving destination identified internally by an immutable opaque ID and publicly by a mutable slug.

### Publishing Token

An independently named, revocable credential authorizing content replacement for one site.

### Publication Directory

A local directory containing `nrdocs.yml`, selected Markdown pages, and referenced assets.

### Current Publication

The only artifact served for a site. A successful publish replaces it atomically.

## Site State Model

A site has independent content, lifecycle, and reader-access state.

### Content state

```text
empty
published
```

### Lifecycle state

```text
enabled
disabled
```

### Reader-access state

```text
public
password
```

The states are not conflated.

| Content | Lifecycle | Access | Reader result |
|---|---|---|---|
| Empty | Enabled | Public | 404 |
| Empty | Enabled | Password | 404 |
| Empty | Disabled | Public or password | 404 |
| Published | Enabled | Public | Site content |
| Published | Enabled | Password | Password flow or site content under a valid session |
| Published | Disabled | Public or password | 404 |

There is no pending, approval, draft, archived, or soft-deleted site state.

## Journey 1: Deploy an Instance

### Goal

Create an operational nrdocs instance without creating a deployment repository or retaining generated infrastructure files.

### Command

```bash
nrdocs deploy
```

### Preconditions

- The CLI can resolve valid Cloudflare authentication.
- The authenticated identity has the permissions required to provision the nrdocs resources.

### Interaction

The CLI asks only for deployment-level choices, including the instance name and optional custom hostname.

Example:

```text
Instance name: company-docs
Custom domain? No

Creating Cloudflare resources...
```

### Required outcome

The command:

1. Provisions the fixed nrdocs Cloudflare resources.
2. Applies the current 2.0 schema.
3. Stores the human-readable instance display name in D1 instance metadata and the opaque local instance descriptor.
4. Selects the new instance as the active administrative instance.
5. Prints the display name, canonical public origin, and instance ID.
6. Creates no required file in the current directory.

### Success output

```text
nrdocs deployed.

Name:      company-docs
URL:       https://company-docs.example.workers.dev
Instance:  inst_01K4A7Q2M9
Status:    active administrative instance

Next:
  nrdocs site create <slug>
```

## Journey 2: Select an Administrative Instance

### Goal

Make subsequent administrative commands target a specific locally registered instance.

### Commands

```bash
nrdocs instance list
nrdocs instance use inst_01K4A7Q2M9
nrdocs instance show
```

### Required behavior

- Instance selection is explicit and persistent.
- Administrative commands use the selected instance unless `--instance` supplies a one-command override.
- `instance list` and `instance show` display both the human-readable name and opaque instance ID.
- Selection and overrides accept only the opaque instance ID; a display name is never a targeting key.
- Mutating commands display the targeted instance before confirmation.
- The current directory and publisher credential store never influence administrative instance selection.

## Journey 3: Create a Public Site

### Goal

Create a site that becomes publicly readable after its first successful publication.

### Command

```bash
nrdocs site create product-handbook
```

### Interaction

```text
Instance: https://docs.example.com
Slug:     product-handbook

Reader access:
  Password protected
> Public

Initial publishing token name [initial]: handbook-publisher
```

### Required outcome

The command atomically creates:

- an enabled site;
- an immutable opaque site ID;
- the slug `product-handbook`;
- public reader access; and
- one active site-scoped publishing token.

Before content exists, the site URL returns 404.

The plaintext token is displayed once.

### Success output

```text
Site created.

URL:      https://docs.example.com/product-handbook/
Site ID:  site_01K3X9M7Q2F8
Access:   public

Publishing token: nrd_pub_...

This token will not be displayed again.
```

## Journey 4: Create a Password-Protected Site

### Goal

Create a site that requires a shared reader password after publication.

### Command

```bash
nrdocs site create investigation
```

### Interaction

```text
Reader access:
> Password protected
  Public

Reader password:         ********
Confirm reader password: ********
Initial publishing token name [initial]: investigation-publisher
```

### Required outcome

Site creation must be atomic. Password-mode site state must not exist without a valid password hash.

The reader password and publishing token are distinct credentials with unrelated authority.

## Journey 5: Connect a Publication Directory

### Goal

Bind one directory to the site authorized by a publishing token.

### Command

```bash
nrdocs connect ./docs
nrdocs connect ./docs --title "Product Handbook"
```

### Interactive mode

```text
Server:           https://docs.example.com
Publishing token: ********
Site title:       Product Handbook
```

The title prompt is shown only when `nrdocs.yml` does not already contain a title and `--title` was not supplied.

### Environment-backed mode

```bash
NRDOCS_URL=https://docs.example.com \
NRDOCS_TOKEN="$PUBLISH_TOKEN" \
nrdocs connect ./docs --title "Product Handbook"
```

Both environment variables must be present. This mode performs no prompt and never stores the URL or token. `--title` is required only when the existing configuration lacks a title.

### Required behavior

In both modes, the CLI:

1. Resolves the supplied directory exactly and does not search parent directories.
2. Resolves exactly one complete credential source without fallback.
3. Validates the token with the server.
4. Receives the immutable site ID and current slug.
5. Creates or minimally updates `<directory>/nrdocs.yml` only after successful validation.
6. Stores only the opaque site ID as `publish.credential`.
7. Preserves existing title, navigation, and unrelated configuration.
8. Adds `navigation: auto` when creating a configuration or when navigation is absent.
9. Displays the resolved site identity and next command.

Interactive mode additionally stores the server and token in `~/.nrdocs/sites/<site-id>.json`. Environment-backed mode does not create, modify, or delete a local credential file.

### Success output

```text
Connected directory.

Directory:  /work/product/docs
Site:       Product Handbook
Site ID:    site_01K3X9M7Q2F8
Server:     https://docs.example.com

Credential stored:
  ~/.nrdocs/sites/site_01K3X9M7Q2F8.json

Next:
  nrdocs preview ./docs
  nrdocs publish ./docs
```

Environment-backed success instead states:

```text
Connected directory.

Directory:  /work/product/docs
Site:       Product Handbook
Site ID:    site_01K3X9M7Q2F8
Server:     https://docs.example.com

Credential was supplied by the environment and was not stored.

Next:
  nrdocs preview ./docs
  NRDOCS_URL=... NRDOCS_TOKEN=... nrdocs publish ./docs
```

### Destination mismatch

If `nrdocs.yml` already points to a different site ID, `connect` must not silently replace it. Interactive mode reports both IDs and requires explicit confirmation. Environment-backed mode fails without writing and provides no replacement flag.

## Journey 6: Prepare Navigation Without a Site

### Goal

Create editable content configuration before receiving a publishing token.

### Command

```bash
nrdocs generate nav ./docs
```

### Required behavior

If `nrdocs.yml` does not exist, the command prompts for the required title and creates the file without a publishing credential:

```yaml
title: Product Handbook
navigation:
  - title: Home
    file: index.md
  - title: Introduction
    file: 01-introduction.md
```

The directory may be previewed, but it cannot be published through stored credentials until `connect` adds `publish.credential`.

If `navigation` is already an explicit list, the command refuses to overwrite it unless `--force` is supplied.

## Journey 7: Preview Locally

### Goal

Inspect the exact rendering and validation result without changing the live site.

### Command

```bash
nrdocs preview ./docs
```

### Preconditions

- `nrdocs.yml` exists.
- `title` exists.
- Navigation and content validate.

A publishing credential is not required.

### Required behavior

The command:

- binds only to IPv4 loopback `127.0.0.1`;
- tries port 4173, then the first free port through 4273, and fails clearly if
  none is available;
- prints the selected `http://127.0.0.1:<port>/` URL;
- never binds to a LAN, wildcard, or public interface;

1. Uses the same validation and renderer as `publish`.
2. Builds an ephemeral in-memory or temporary artifact.
3. Starts a local HTTP server.
4. Prints the local URL and publication manifest summary.
5. Uploads nothing.
6. Creates no persistent build output.
7. Does not watch files, reload automatically, or open a browser in the initial 2.0 scope.

### Success output

```text
Preview ready.

Pages:       12
Images:       8
Attachments:  2

URL: http://127.0.0.1:4173/
```

## Journey 8: First Publish

### Goal

Publish validated content to an enabled empty site.

### Command

```bash
nrdocs publish ./docs
```

### Required behavior

The CLI:

1. Reads `nrdocs.yml` directly from the supplied directory.
2. Resolves the exact credential reference.
3. Loads that credential file or uses complete environment credentials.
4. Validates that the token authorizes the site ID in `nrdocs.yml`.
5. Validates navigation, Markdown, links, routes, and referenced assets.
6. Renders the complete static artifact locally.
7. Displays a concise manifest.
8. Uploads the artifact.
9. Causes the server to promote it atomically.

The site becomes live immediately under the access mode selected during site creation. No administrator approval or enablement action follows publication.

### Success output

```text
Published successfully.

Pages:       12
Images:       8
Attachments:  2

URL: https://docs.example.com/product-handbook/
```

## Journey 9: Replace Current Content

### Goal

Publish updated content to a site that already has content.

### Command

```bash
nrdocs publish ./docs
```

### Required behavior

- The existing site remains readable while validation, rendering, and upload occur.
- The new artifact becomes current only after the complete upload and server validation succeed.
- A successful promotion replaces the previous content as one atomic operation.
- nrdocs does not retain or expose the previous publication as a version.

## Journey 10: Failed Publish

### Goal

Preserve the current site when a replacement cannot be completed.

### Failure categories

- invalid or missing configuration;
- missing local credential;
- expired or revoked token;
- token/site mismatch;
- invalid navigation;
- route collision;
- raw HTML or unsupported Markdown feature;
- broken local link;
- unsupported referenced asset;
- rendering failure;
- upload interruption; or
- server rejection.

### Required outcome

The current publication remains unchanged and readable.

The CLI reports that nothing was promoted:

```text
Publish failed during validation.

02-analysis.md:42 references unsupported asset:
  ./attachments/tool.exe

The currently published site was not changed.
```

## Journey 11: Publish from CI

### Goal

Publish through any CI system without provider-specific nrdocs integration.

### Environment

```text
NRDOCS_URL
NRDOCS_TOKEN
```

### Command

```bash
nrdocs publish ./docs
```

### Required behavior

- Both environment values are required together.
- Environment credentials are not written to disk.
- The token-derived site ID must match `publish.credential` in `nrdocs.yml`.
- Git repository, branch, commit, provider, and workflow metadata are ignored.
- Local and CI publication use the same validation, artifact, and server endpoint.

## Journey 12: Read a Public Site

### Goal

Read an enabled site without authentication.

### Request

```text
GET /product-handbook/
```

### Required behavior

- If `index.md` exists, serve it as the site root.
- Otherwise, redirect to the first navigable page.
- Serve only pages and assets included in the current publication.
- Do not expose original Markdown or a site archive.

## Journey 13: Read a Password-Protected Site

### Goal

Enter the site password once and navigate normally under a site-scoped session.

### Required behavior

An unauthenticated request to any protected page receives the fixed password interaction and retains the intended return location.

After successful password submission:

1. The server creates a signed site-scoped reader session.
2. The reader returns to the originally requested page.
3. Navigation within that site requires no further password entry.
4. The session does not authorize another site, even if it uses the same password.
5. The fixed reader interface provides a logout action.

The exact session lifetime and cookie protections are defined by the security specification. The duration is fixed platform behavior and is not configured per site.

## Journey 14: Change Reader Access

### Public to password

```bash
nrdocs site access product-handbook password
```

The CLI prompts for and confirms a new password. The server atomically stores its hash, changes access mode, and invalidates reader sessions.

### Password to public

```bash
nrdocs site access product-handbook public
```

The CLI explicitly warns that the site will become public and the stored password hash will be permanently removed. The transition requires confirmation.

If the administrator wants to remove the password without immediate public availability, the administrator first disables the site.

## Journey 15: Change the Reader Password

### Command

```bash
nrdocs site password change product-handbook
```

### Required behavior

- The command is valid only for a password-protected site.
- The administrator enters and confirms the new password through masked prompts.
- The previous password is not required.
- The previous hash is replaced atomically.
- All existing reader sessions are invalidated.
- The plaintext password is never stored or displayed.

## Journey 16: Issue and Revoke Publishing Tokens

### Issue

```bash
nrdocs token issue product-handbook --name github-actions
nrdocs token issue product-handbook \
  --name contractor \
  --ttl 7d
```

Tokens do not expire unless a TTL is explicitly selected. The TTL is calculated from authoritative D1 time and the resulting absolute expiration is stored as canonical UTC RFC 3339. The plaintext token is displayed only once.

### List

```bash
nrdocs token list product-handbook
```

The command displays token name, creation time, optional expiration, last-use time, and status. It never displays token values or hashes.

### Revoke

```bash
nrdocs token revoke product-handbook github-actions
```

Revocation immediately prevents future publication with that token. It does not alter current content or other tokens.

### Replace a local credential

After receiving a replacement token, the publisher runs `connect` again. The CLI validates that it resolves to the site ID already referenced by `nrdocs.yml` and replaces the local credential file contents without changing the pointer.

## Journey 17: Enable and Disable a Site

### Disable

```bash
nrdocs site disable product-handbook
```

The site immediately returns 404. Content, access mode, password hash, and publishing tokens are preserved. Publishers may continue to publish replacement content while the site is disabled.

### Enable

```bash
nrdocs site enable product-handbook
```

If content exists, the current publication becomes readable under the preserved access mode. If no content exists, the URL continues to return 404.

## Journey 18: Rename a Site

### Command

```bash
nrdocs site rename product-handbook engineering-handbook
```

### Required behavior

- The CLI displays the old and new URL.
- The CLI warns that the old URL will stop working.
- The operation requires confirmation.
- The immutable site ID, current content, publishing tokens, password, and local credential references remain unchanged.
- The old slug immediately returns 404.
- No redirect or alias is retained.

## Journey 19: Delete a Site

### Command

```bash
nrdocs site delete product-handbook
```

### Required behavior

The CLI lists the destructive effects and requires the exact slug to be typed.

Deletion permanently removes:

- the site record;
- the current artifact;
- the password hash;
- all publishing-token records; and
- associated site metadata.

After deletion:

- the site URL returns 404;
- all tokens fail immediately;
- the slug may be reused for a new site;
- the recreated site receives a new site ID; and
- old `nrdocs.yml` pointers never bind to the recreated site.

The server cannot remove publisher-side `nrdocs.yml` files or local credential files. Their next use produces a precise deleted-site error and cleanup instruction.

## Journey 20: Manage Local Publisher Credentials

### List

```bash
nrdocs credentials list
```

The command lists opaque site IDs and connection status. It may resolve display names by querying the associated servers, but site names and server names are not used as local filenames.

### Remove

```bash
nrdocs credentials remove site_01K3X9M7Q2F8
```

This removes only the local credential file. It does not revoke the server-side token and does not edit a publication directory.

If a directory still references the removed credential, `publish` instructs the user to run `connect`.

## Journey 21: Visit the Instance Root

### Request

```text
GET /
```

### Required behavior

The root displays a fixed generic nrdocs message. It does not list public, protected, disabled, empty, or recently published sites and does not expose administrative links.

## Global Journey Invariants

Every user journey must preserve the following rules:

1. A publisher token grants authority to one immutable site ID.
2. A publication directory points to one immutable site ID.
3. The CLI never guesses a publishing destination.
4. A publisher cannot alter site administration or reader access.
5. A successful publish replaces content atomically.
6. A failed publish does not alter current content.
7. nrdocs exposes no publication history or rollback.
8. Public means anonymously accessible, not publicly listed.
9. Disabled, deleted, empty, and unknown sites return 404.
10. Local credential removal and server token revocation are distinct operations.
11. Site rename changes routing, not identity.
12. Site deletion is permanent and creates no recoverable state.
