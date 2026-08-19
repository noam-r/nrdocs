# nrdocs 2.0 Cloudflare Deployment and Operations

## Status

Normative and locked for nrdocs 2.0.

This document defines how the administrator CLI provisions, discovers,
reconciles, and upgrades one nrdocs instance. It introduces no hosted control
plane and no deployment repository.

## Operating Model

`nrdocs deploy` is a self-contained CLI operation that may run from any
directory. It provisions one Worker, one private R2 bucket, one D1 database,
fixed Worker static assets, rate-limit bindings, and one canonical origin. The
local instance descriptor stores identifiers and status, never Cloudflare or
nrdocs secrets.

The packaged nrdocs version is one release unit: CLI, Worker, migrations,
renderer, schemas, and fixed reader assets come from the same package. Runtime
components are never downloaded independently.

## Cloudflare Authentication

The administrator CLI resolves authority in this order:

1. If non-empty `CLOUDFLARE_API_TOKEN` exists in the process environment, use it
   and do not fall back.
2. Otherwise, if `~/.nrdocs/cloudflare.env` exists as a regular file with mode
   `0600` and contains a non-empty `CLOUDFLARE_API_TOKEN=` line, use that token.
   The operator creates and maintains this file; nrdocs never writes Cloudflare
   secrets into it or into instance descriptors.
3. Otherwise, ask the bundled Wrangler installation for the current OAuth token
   using `wrangler auth token --json` from a neutral temporary directory.
4. If none succeeds, stop with instructions to create `~/.nrdocs/cloudflare.env`,
   set an API token in the environment, or run `wrangler login`.

Legacy global API key and email authentication are rejected. The CLI never
prints, copies to arguments, stores, or forwards the resolved credential except
to Cloudflare APIs.

`CLOUDFLARE_ACCOUNT_ID` is taken from the process environment, or else from the
same `cloudflare.env` file. If set, it must be accessible to the credential. If
it is absent, the CLI lists accessible accounts and selects automatically only
when exactly one exists; multiple accounts require an interactive choice. The
chosen account ID is pinned in the instance descriptor. Deploy never silently
changes accounts.

## Required Cloudflare Authority

The preflight verifies the exact capabilities before mutation. Cloudflare API
token permissions are configured in the dashboard as **Account** / **Zone** /
**User** rows with access **Read** or **Edit** (Edit is full CRUDL for that
permission). Create a custom token with these exact rows:

| Type    | Permission         | Access | Required for                                                       |
| ------- | ------------------ | ------ | ------------------------------------------------------------------ |
| Account | Account Settings   | Read   | Account discovery and identity verification                        |
| Account | Workers Scripts    | Edit   | Worker versions, bindings, static assets, and secrets              |
| Account | D1                 | Edit   | Database discovery, migrations, administration, and metadata       |
| Account | Workers R2 Storage | Edit   | Bucket creation, marker verification, object listing, and deletion |
| Zone    | Zone               | Read   | A requested custom domain only                                     |
| Zone    | Workers Routes     | Edit   | A requested custom domain only                                     |

Omit the two Zone rows when no custom domain is requested. For account-level
products (Workers, D1, R2), scope the token to the **entire account**. Domain
pickers (**All domains** / **Specific domains**) apply only when Zone
permissions are granted for `--domain`. `CLOUDFLARE_ACCOUNT_ID` is that
account’s Account ID, not a domain. Do not grant Account Settings Edit, DNS
Edit, Billing, or User API Tokens permissions for ordinary deploy.

An API token may be narrower than the table when an operation demonstrably does
not need a capability, but preflight must prove every capability required for
the requested command. A missing capability fails before the first mutation.

R2 administration uses Cloudflare's R2 REST object and bucket APIs with the
same resolved Cloudflare bearer token. nrdocs does not create S3 access keys,
temporary R2 credentials, or additional long-lived secrets.

## Resource Identity

The first deployment generates an opaque instance ID and a 20-character
lowercase base32 resource suffix derived from independent random bytes. Names
are deterministic from that suffix:

| Resource    | Name                                      |
| ----------- | ----------------------------------------- |
| Worker      | `nrdocs-<suffix>`                         |
| D1 database | `nrdocs-<suffix>-d1`                      |
| R2 bucket   | `nrdocs-<first-8-account-id>-<suffix>-r2` |

The instance display name is metadata and never changes a resource name or
identifier.

Fixed Worker bindings are:

- `DB` for D1;
- `ARTIFACTS` for R2;
- `NRDOCS_SESSION_KEY` for the Worker secret;
- `NRDOCS_INSTANCE_ID` and `NRDOCS_PACKAGE_VERSION` as non-secret text
  bindings;
- `PASSWORD_IP_LIMIT`, `PASSWORD_SITE_LIMIT`, `INVALID_TOKEN_LIMIT`,
  `TOKEN_RESOLVE_LIMIT`, `TOKEN_PUBLISH_LIMIT`, `INSTANCE_API_LIMIT`,
  `AGENT_SHARE_IP_LIMIT`, and `AGENT_SHARE_INSTANCE_LIMIT` for rate limiting;
- `NRDOCS_CANONICAL_ORIGIN` as the HTTPS origin used for grant URLs and
  agent-share Origin checks; and
- `PLATFORM_ASSETS` for versioned Worker static assets.

## Ownership Markers

Every controlled resource carries the same opaque instance ID:

- the D1 `instance_metadata` singleton;
- the exact `NRDOCS_INSTANCE_ID` Worker binding; and
- private R2 object `_nrdocs/instance.json`.

The R2 marker contains only schema version, instance ID, account ID, resource
suffix, and creating nrdocs package version. A matching name without matching
ownership markers is a collision. Deploy must stop and never adopt, overwrite,
or delete it.

## Command Semantics

```text
nrdocs deploy [--new] [--domain <hostname>] [--instance <instance-id>]
```

`--new` provisions a new local instance identity and begins a first
deployment. Without `--new`, deploy upgrades the selected instance: the
`--instance` value when given, otherwise the active administrative instance.
If neither is selected, deploy refuses rather than creating Cloudflare
resources. `--instance` must resolve through the local descriptor store;
arbitrary remote resource names are not accepted. `--domain` is valid only
with `--new`.

Before the first Cloudflare mutation, deploy atomically writes a descriptor with
status `provisioning`. On interruption or failure it records completed safe
steps and prints the exact resume command. `nrdocs instance list` exposes the
status. A successful smoke test changes it to `active`.

## First Deployment Order

Deploy performs these steps in order and makes each step idempotent:

1. resolve authentication, account, package version, and local identity;
2. preflight required capabilities, plan limits, names, and domain eligibility;
3. resolve or create D1 and verify ownership;
4. resolve or create a private R2 bucket, write or verify its marker, and ensure
   `r2.dev`, public custom domains, and public CORS exposure are disabled;
5. apply forward-only D1 migrations and write instance metadata;
6. upload one complete Worker version with strict bindings and fixed static
   assets; create `NRDOCS_SESSION_KEY` only if it does not already exist;
7. activate either `workers.dev` or the requested custom domain;
8. verify the version endpoint and instance-root response through the canonical
   origin; and
9. atomically mark the descriptor `active` with resource IDs, origin, and
   deployed package version.

The Worker and its fixed assets are one atomic deployment version. Fixed reader
assets are not published to R2, so a page can never reference a separately
upgraded platform bundle.

## Reconciliation and Upgrade

`nrdocs deploy --instance <id>` reads the descriptor, verifies all ownership
markers, compares desired and actual state, and applies only the missing or
outdated controlled state. If everything matches, it reports `unchanged`.

Upgrades are in-place and forward-only within the 2.x compatibility contract.
They apply packaged migrations, upload a complete Worker/static-asset version,
preserve the session key and canonical domain, run smoke tests, and then update
`deployed_version`. A clean 2.0 implementation rejects nrdocs 1.x state rather
than migrating it.

Binding inheritance is allowlist-based. Deployment fails if a required binding
would be lost or if an unknown secret/binding would be silently copied.

On a failed first deployment, the descriptor remains `provisioning`. On a
failed upgrade of an instance that had been active, it becomes `degraded` with
the last known-good version and safe completed-step metadata. Re-running the
printed command reconciles the same identity.

All 2.x migrations applied before a Worker switch must remain compatible with
the immediately previous Worker. If post-switch smoke testing fails, deploy
automatically restores that previous Worker version, preserves the migrated
D1/R2 state, records `degraded`, and exits unsuccessfully. A first deployment
has no version to restore and remains `provisioning`. nrdocs never rolls D1 back
automatically and never deletes pre-existing or unrelated resources as cleanup.

## Custom Domain

`--domain` accepts one lowercase canonical hostname with no scheme, port, path,
query, fragment, or wildcard. The zone must be active, belong to the selected
account, and contain no conflicting CNAME or Worker custom-domain assignment.

nrdocs attaches the Worker as a Cloudflare Worker Custom Domain and waits for
DNS and TLS activation before smoke testing. When a custom domain is active,
`workers.dev` is disabled so the instance has one canonical origin. Without a
custom domain, `workers.dev` is enabled and is canonical. There are no aliases,
per-site domains, or implicit redirects between origins.

An existing custom domain persists during upgrade. Changing an instance's
canonical domain is outside the 2.0 command surface.

## Administration and Site Deletion

Administrative commands resolve the selected descriptor, authenticate to
Cloudflare, verify its ownership markers, and operate directly on D1 or R2.
They never call a hidden Worker administrator endpoint.

Site deletion atomically disables the site and revokes its tokens, waits out the
now-unrenewable lock, lists every object under its opaque site prefix through
the paginated R2 REST object API, deletes batches until a fresh listing is
empty, and then deletes D1 metadata. It is resumable and never uses a public
bucket URL or S3 credential.

## Instance Deletion

```text
nrdocs instance delete <instance-id>
```

Instance deletion permanently removes the Cloudflare resources owned by one
local instance descriptor, then deletes that descriptor. It requires an
interactive terminal and confirmation by typing the exact opaque instance ID.

Before mutation, delete verifies ownership:

- the R2 marker `_nrdocs/instance.json` matches the descriptor when the bucket
  exists; and
- D1 `instance_metadata` matches the descriptor when the database exists.

Ownership failure refuses the command with no Cloudflare mutations.

Cleanup order for owned resources only:

1. delete the Worker script (also removes workers.dev / custom-domain attachment);
2. empty and delete the R2 bucket;
3. delete the D1 database;
4. remove the local descriptor and clear `active-instance` when it pointed at
   this ID.

Missing resources from an interrupted deploy are skipped. Delete never adopts
or removes unrelated account resources and never auto-selects another active
instance.

## Local Descriptor Requirements

The descriptor schema in `02-cli-configuration-and-credentials.md` includes:

- instance ID and display name;
- account ID and random resource suffix;
- Worker, D1, and R2 resource identifiers;
- canonical origin and optional custom hostname;
- status: `provisioning`, `active`, or `degraded`;
- deployed nrdocs package version; and
- non-secret reconciliation progress.

Permissions are owner-only. No field contains a Cloudflare token, OAuth token,
R2 credential, session key, publishing token, or reader-password verifier.

## Feasibility Gate

Phase 0A of the implementation plan must validate the currently documented
Cloudflare APIs in a disposable account before the repository transition. It
must prove OAuth/API-token acquisition, exact permission preflight, D1 and R2
control-plane operations, Worker deployment with bindings and static assets,
custom-domain behavior when available, and full cleanup of only spike-created
resources.

This is an external-platform verification gate, not an unresolved product
decision. If current Cloudflare behavior contradicts this contract, stop and
revise this document before implementing a workaround.

## Operational Acceptance Criteria

1. First deploy, interrupted deploy, resume, no-op reconcile, and compatible
   upgrade are tested against disposable resources.
2. Multi-account selection never guesses and the descriptor pins the choice.
3. Missing permissions fail before mutation with the exact missing capability.
4. Name collisions without matching ownership markers are never adopted.
5. R2 remains private and no S3-style credential is created or persisted.
6. A Worker and its platform assets become visible as one version.
7. Custom-domain and workers.dev modes each expose exactly one canonical origin.
8. Secret rotation does not occur during ordinary deploy or upgrade.
9. Logs and errors satisfy the redaction contract in the security specification.

## Primary Platform References

The feasibility gate should verify behavior against Cloudflare's current
official documentation for [Wrangler authentication](https://developers.cloudflare.com/workers/wrangler/commands/general/),
[Wrangler profiles](https://developers.cloudflare.com/workers/wrangler/profiles/),
[D1 APIs](https://developers.cloudflare.com/api/resources/d1/),
[R2 object APIs](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/),
[Worker script deployment](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/),
[custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/),
and [rate-limit bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
