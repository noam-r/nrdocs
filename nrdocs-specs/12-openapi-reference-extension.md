# nrdocs OpenAPI Reference Extension

## Status

Normative for the additive OpenAPI reference capability. It extends, but does
not replace, documents 00–09. Publications without an `api` block retain the
existing 2.0 contracts without alteration.

This document closes the product and engineering contracts required before
implementation. Application code must not begin until
[`13-openapi-extension-readiness.md`](./13-openapi-extension-readiness.md)
records a go judgment and a security/compatibility review of artifact schema
v3 has passed.

## 1. Product definition

nrdocs publishes a validated Markdown directory as a minisite. When the
publication configuration identifies one OpenAPI description, nrdocs also
generates and publishes a static API Reference within that minisite.

OpenAPI is authoritative for the API reference. Markdown remains authoritative
for publisher-authored explanatory content.

An OpenAPI-enabled publication is not a separate site type. It uses the
existing site, publication, navigation, access, preview, atomic promotion, and
fixed-reader contracts.

The publication consists of:

1. the ordinary navigation-selected Markdown pages and referenced attachments
   (zero or more);
2. one configured OpenAPI entry document and its allowed local dependencies;
3. one generated API Reference landing page;
4. generated operation pages and, when applicable, named schema pages;
5. generated machine representations for those pages; and
6. one self-contained downloadable OpenAPI artifact.

The absence of an `api` block means that none of items 2–6 are generated.

### User outcomes

Publishers can combine guides with an authoritative API reference, preview with
the production renderer, publish atomically, and declare optional operation
costs and curated language examples in OpenAPI.

Readers can navigate from Markdown into the API Reference, open stable pages
for the overview, each operation, and each rendered named schema, inspect
requests, responses, authentication, examples, and cost, use Share with LLM,
and download the bundled OpenAPI document under the site's ordinary reader
access.

### Non-goals

nrdocs does not host, proxy, invoke, test, monitor, or meter the documented
API; collect API keys or OAuth credentials; calculate invoices or live prices;
generate servers or SDKs; edit or become the source of truth for OpenAPI;
resolve remote OpenAPI dependencies; manage API version policy; provide search,
analytics, a request playground, or an API console; or require multiple reader
credentials for API documentation.

Generated pages and the OpenAPI download inherit the site's public or
shared-password access. This extension introduces no reader identities.

### Platform ownership

The renderer owns all generated markup and behavior. Publishers cannot supply
HTML, JavaScript, CSS, templates, or components. OpenAPI rich-text fields use
the supported safe Markdown subset. API pages use the existing fixed reader
shell plus a platform-owned API article layout. There is no second theme.

## 2. Configuration

The optional top-level `api` block enables API reference generation:

```yaml
api:
  specification: openapi.yaml
```

Rules:

- `specification` is required when `api` exists. It is a publication-root-
  relative path to a regular UTF-8 YAML or JSON file.
- Absolute paths, URLs, backslashes, dot segments, empty segments, and paths
  escaping the publication root are rejected.
- Unknown fields in `api` are rejected.
- No `type: api` field exists.
- The block is versioned through the publication and artifact schemas, not a
  publisher-selected renderer version.

`nrdocs generate nav` preserves `api` along with `publish`, `title`,
`language`, and `direction`. It never emits API navigation entries into
`nrdocs.yml`.

### API-only publications

When `api` is configured:

- authored Markdown pages may be zero;
- if there is at least one navigable authored Markdown page, site root behavior
  follows the existing Markdown contract;
- if there are zero authored Markdown pages, the manifest root is a redirect to
  `/api-reference/` and the generated landing page is the first navigable page.

A publication with neither Markdown pages nor `api` remains invalid.

## 3. Supported OpenAPI versions and subset

### Versions

The extension accepts OpenAPI **3.0.x** and **3.1.x** only. Patch versions
within a supported minor line share one feature set.

OpenAPI 2.0, 3.2.x, malformed versions, and omitted `openapi` declarations fail
with an explicit unsupported or invalid-version diagnostic. The renderer must
not attempt best-effort conversion.

The renderer normalizes supported descriptions into a version-independent
internal model. That model is not a stored or public contract and must not
expose parser-library objects.

### Supported construct subset

The initial release **supports and renders** the following when valid:

| Area                                                                                     | Support                                                          |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `info` title, description, version, contact, license, termsOfService                     | Landing page                                                     |
| `info.externalDocs`                                                                      | Landing page as external HTTPS link when valid                   |
| Root and operation `servers`                                                             | Landing + operation pages; examples use the first applicable URL |
| Root and operation `security` + `components.securitySchemes`                             | Overview and operation auth sections                             |
| Path items and operations (`get`/`put`/`post`/`delete`/`options`/`head`/`patch`/`trace`) | Operation pages                                                  |
| `operationId`, `summary`, `description`, `deprecated`, `tags`, `externalDocs`            | Operation pages                                                  |
| Parameters (path/query/header/cookie) with `schema`                                      | Rendered                                                         |
| Request body and responses by status and media type                                      | Rendered                                                         |
| `components.schemas` named schemas referenced by supported operations                    | Canonical schema pages + inline contextual views                 |
| Composition `allOf` / `oneOf` / `anyOf`, `$ref` to local named schemas                   | Finite bounded rendering                                         |
| 3.0 `nullable`; 3.1 type unions / null                                                   | Dialect-correct rendering                                        |
| Enums, formats, defaults, examples, readOnly, writeOnly, required                        | Rendered                                                         |
| Supported extensions `x-codeSamples`, `x-nrdocs-cost`, `x-nrdocs-costs`                  | Per §§7–8                                                        |

The initial release **rejects the publication** (with location diagnostics) when
any of the following appear in the resolved description in a way that would
affect request or response interpretation:

- `callbacks`
- `webhooks` (OpenAPI 3.1)
- parameter or media-type `content` maps that replace a simple `schema` in a
  way the renderer does not cover (parameter `content` is rejected)
- `encoding` objects on request/response media types
- XML object modeling (`xml` keywords that change payload shape)
- remote `$ref` (any non-local reference)
- boolean JSON Schema schemas used as the sole schema of a parameter, body, or
  response (named boolean schemas in unused components are ignored only when
  unreferenced; referenced boolean schemas fail)
- `unevaluatedProperties`, `unevaluatedItems`, and other JSON Schema 2020-12
  keywords outside the explicit support matrix below
- OpenAPI constructs not listed as supported and not listed as ignored

**Ignored without failing** (documented no-op for v1): unused `components`
entries that are never referenced by a rendered operation or schema page;
vendor extensions other than the three named above (stripped from the public
bundled download as well as HTML, except that unknown fields inside a supported
extension object still fail that extension).

### Schema dialect matrix (normative minimum)

For each of 3.0 and 3.1, the renderer must document and test:

- type, format, enum, const (3.1), default, example/examples;
- properties, required, additionalProperties (boolean or schema);
- items, min/max, length, pattern;
- allOf, oneOf, anyOf, not (render `not` as a constraint note, not expansion);
- discriminator (propertyName required; mapping rendered when present);
- recursive `$ref` via bounded link, never unbounded expansion;
- 3.0 nullable vs 3.1 null-in-type.

Unsupported schema keywords on a schema that is rendered cause publication
failure. They must not be silently dropped.

## 4. References and source boundary

The entry document may `$ref` regular YAML or JSON files under the publication
root. Resolution is local-only.

Rejected: HTTP/HTTPS/protocol-relative/data/other remote refs; escaping paths;
symbolic links anywhere in the dependency graph; missing, unreadable,
non-regular, invalid UTF-8, or unsupported files; unsafe cycles; duplicate or
ambiguous resolution; graphs exceeding §14 limits.

All references resolve during preview and publication. The Worker never
resolves OpenAPI dependencies at request time.

Referenced OpenAPI source files are publication inputs. They are not ordinary
attachments and are never individually served because they were resolved.

A Markdown or attachment link whose target path equals `api.specification` or
any resolved OpenAPI dependency path is a validation error. Publishers must
link to the generated download route or to generated reference pages instead.

## 5. Identifiers and routes

### Operation identity

Every rendered operation must declare a non-empty, unique `operationId`.
Uniqueness is case-sensitive across the complete resolved description after
decode.

Absent, invalid, or duplicate `operationId` fails preview and publication.
nrdocs does not synthesize identifiers from methods, paths, summaries, or tags.

Grammar (exact):

```text
^[A-Za-z][A-Za-z0-9._-]{0,127}$
```

Length is 1–128 ASCII characters. No percent-encoding of arbitrary Unicode.
Changing `operationId` changes the route; nrdocs creates no redirects or
aliases. Diagnostics must include source location, method, and path, and use a
stable machine code (see §15).

### Schema identity

Named component schema keys used for canonical pages must match:

```text
^[A-Za-z][A-Za-z0-9._-]{0,127}$
```

Invalid names on schemas that require a page fail publication.

### Routes

Generated routes are site-relative and slug-neutral:

```text
/api-reference/
/api-reference/operations/<operation-id>/
/api-reference/schemas/<schema-id>/
/api-reference/openapi.json
```

When `api` is configured, the `api-reference` top-level route namespace is
reserved. Any authored Markdown route or attachment that collides with a
generated or reserved API route fails validation.

Adding `api` to a previously valid publication can newly fail if authored
routes already use `/api-reference/…`. That is intentional.

Internal links use the existing route-relative, slug-neutral algorithm.
Publishers link to generated routes with ordinary Markdown relative links; the
renderer validates them like other internal page targets once the generated
route set is known.

## 6. Navigation, landing page, and pagination

### Navigation integration

The renderer appends one generated **API Reference** section after the ordinary
publisher-authored Markdown navigation. Authored navigation is not restructured.

Published page allowlist =

```text
authored Markdown pages selected by navigation
∪ generated API Reference pages
```

Explicit navigation remains the complete allowlist for Markdown files only.
Generated API pages are never listed in `nrdocs.yml` and are always appended
after authored entries when `api` is present.

The generated section contains:

1. one navigable landing item titled with the fixed chrome string for the
   overview (see §9), targeting `/api-reference/`;
2. operation groups derived from tags (group labels are non-clickable headings,
   like directory sections without `index.md`);
3. one canonical navigation item per operation; and
4. a final **Schemas** group when at least one canonical schema page exists.

Placement, rename, and interleaving of the generated section are not supported
in this extension.

### Tags

- Top-level `tags` order is authoritative.
- Tags used by operations but absent from the top-level list follow in first
  resolved appearance order.
- An operation with multiple tags appears in the first applicable group only.
- Untagged operations appear under the fixed chrome group **Other**.
- Empty groups are omitted.
- Publisher tags whose display labels collide with fixed chrome labels
  (`Other`, `Schemas`, or the section title) keep the publisher label; fixed
  chrome strings are not renamed. Disambiguation is by route, not label.

### Landing page

`/api-reference/` renders:

- `info` title, description (safe Markdown), version;
- contact, license, termsOfService when present and valid;
- `externalDocs` when present and a valid `http`/`https` URL;
- root servers;
- root security requirements and referenced security schemes;
- the **Download OpenAPI** control linking to `/api-reference/openapi.json`;
- a short index of operation groups (links only).

### Schema pages

Each **named component schema that is referenced** (directly or through a
finite chain of local `$ref` / composition) by at least one rendered
operation's parameters, request body, or responses receives one canonical
schema page. Unreferenced component schemas do not produce pages.

Operation pages show contextual inline views and link named types to canonical
pages. Recursive schemas use bounded references, never unbounded expansion.

### Prev/next linear order

Pagination walks:

1. authored navigable Markdown pages in navigation order;
2. the API landing page;
3. operations in navigation order (tag groups, then Other);
4. schema pages in lexicographic order of schema id.

Non-clickable tag headings are not pagination endpoints.

## 7. Code samples and example policy

### Generated baselines

For each operation nrdocs deterministically generates the **same request** in
three language tabs:

1. cURL;
2. JavaScript (`fetch`); and
3. raw HTTP.

Tabs are languages only. Scenario labels, filters, and alternate payloads are
not separate request tabs. Publisher `x-codeSamples` may replace a generated
baseline for the same language or add another language tab; they must not
introduce non-language tabs.

**Server URL selection:** use the first URL from the operation's `servers` if
non-empty; else the path item's `servers` if non-empty; else the root
`servers` if non-empty; else the literal placeholder `https://api.example.com`.
Multiple servers are listed on the page; only the first applicable URL is used
in generated samples. There is no interactive server picker.

**Secret and placeholder policy (normative):**

1. **Synthesized** values (when the renderer invents a value because no example
   was declared) must be visibly illustrative placeholders and must never look
   like live credentials. Prefer values such as `<api-key>`, `Bearer <token>`,
   and schema-driven samples like `"string"` / `0` / `true`.
2. **Declared** OpenAPI `example` / `examples` values used inside generated
   samples are copied **verbatim**. nrdocs does not sanitize, redact, or
   claim they are non-secret.
3. If a valid request cannot be represented without inventing material
   semantics, emit a safe partial example and mark required placeholders.

The sentence “must never contain real credentials” applies only to synthesized
placeholders (rule 1), not to declared examples (rule 2).

### Publisher `x-codeSamples`

Accepted shape on an Operation Object:

```yaml
x-codeSamples:
  - lang: python
    label: Async client
    source: |
      # example
```

| Field          | Rule                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lang`         | Required. ASCII identifier `^[a-z][a-z0-9+-]{0,31}$`. Mapped through the existing highlight.js alias table when possible; unknown langs render as plaintext. |
| `label`        | Optional documentation hint (1–80 Unicode scalar values after trim/NFC; no `Cc`). **Not** used as a request-example tab title.                               |
| `source`       | Required. UTF-8 text, 1–16,384 UTF-8 bytes.                                                                                                                  |
| Item count     | At most 8 samples per operation.                                                                                                                             |
| Unknown fields | Rejected.                                                                                                                                                    |

Language aliases for tab identity: `js` → JavaScript; `shell` / `sh` / `bash`
→ cURL when replacing the cURL baseline; `http` → HTTP.

When `lang` matches a generated baseline language, that sample **replaces** the
generated tab for the operation. When `lang` is a new language, nrdocs adds one
tab titled from the language id (not from `label`). Multiple samples for the
same language keep the first; later duplicates are ignored for the request
panel.

Compatibility note: Redoc/Scalar `language` is **not** accepted. Publishers
must use `lang`. Executable or markup-bearing presentation fields are rejected.

nrdocs syntax-highlights supplied samples as inert text. It never executes,
rewrites, validates against a language runtime, or claims correctness. It does
**not** scan `x-codeSamples` for secrets; publishers are responsible for sample
contents.

## 8. Operation cost extension

An operation may declare:

```yaml
x-nrdocs-cost:
  type: fixed
  amount: 5
  unit: credits
```

Supported forms:

```yaml
x-nrdocs-cost:
  type: fixed
  amount: 0.02
  unit: USD

x-nrdocs-cost:
  type: free

x-nrdocs-cost:
  type: variable
  description: Depends on the number of records returned.
  pricingUrl: https://api.example.com/pricing#search
```

API-level defaults at the OpenAPI root:

```yaml
x-nrdocs-costs:
  unit: credits
  pricingUrl: https://api.example.com/pricing
```

### Rules

- Cost metadata is optional per operation. Absence means **Not specified**; it
  never means free or zero.
- `fixed` requires one finite non-negative `amount` and an effective bounded
  unit from the operation or root default. `amount: 0` with `type: fixed` is
  allowed and is distinct from `type: free`.
- `free` forbids `amount` and `unit`.
- `variable` requires a bounded plain-text `description` (1–500 Unicode scalar
  values after trim/NFC, no `Cc`) and may provide an absolute `https` URL in
  `pricingUrl` (max 2,048 UTF-8 bytes; no credentials in userinfo).
- Operation values override corresponding root defaults. Root `pricingUrl`
  applies to `variable` operations that omit their own URL. Root `unit`
  supplies `fixed` when the operation omits `unit`.
- Unknown types and unknown fields are rejected.
- Units are display identifiers: `^[A-Za-z][A-Za-z0-9._-]{0,31}$` after NFC.
- nrdocs does not evaluate formulas, tiers, plans, currency conversion, or live
  prices.

### Numeric precision and serialization

- `amount` must be a JSON number that is finite and ≥ 0.
- Decimal values are accepted with at most **6** digits after the decimal
  point in the source document.
- Canonical serialization for HTML, agent Markdown, and the bundled OpenAPI
  download uses the shortest decimal representation that preserves the exact
  decimal value with at most 6 fractional digits, without scientific notation,
  and without a trailing decimal point. Integers serialize without a fractional
  part (e.g. `5`, `0.02`, `0.000001`).
- Binary floating-point drift is avoided by parsing amounts as decimals in the
  renderer; values that cannot be represented exactly under the 6-fractional-
  digit rule fail validation.

### Cost display

Every operation page shows a cost field near method and path:

- `fixed` → `<amount> <unit> per request`
- `free` → `Free`
- `variable` → `Variable cost` plus explanation and optional pricing link
- absent → `Not specified`

Accessible naming must not rely on color alone. No cost summary page,
calculator, or cheat sheet exists in this extension.

## 9. Reader chrome and i18n

`language` and `direction` from `nrdocs.yml` still apply to every generated
page (`html lang` / `dir`) and to RTL layout.

**Fixed API chrome strings are English** regardless of `language`:

- section title `API Reference`
- group `Schemas`
- group `Other`
- cost labels `Free`, `Not specified`, `Variable cost`, and the
  `per request` suffix
- landing and section labels such as `Servers`, `Authentication`, `Request`,
  `Response`, `Parameters`, `Download OpenAPI`

Publisher content (summaries, descriptions, tag names, units, code samples)
remains in the publisher's language. A later release may add a platform string
table; this extension does not.

## 10. Operation and schema page content

### Operation pages

Each operation produces one complete page covering applicable path- and
operation-level declarations: summary, description, tags, deprecation, method,
path, servers, authentication, parameters, request bodies, generated and
supplied examples, responses, headers, schema views/links, and cost.

Unsupported constructs follow §3 (reject or ignore). The renderer must not
silently discard a **supported** construct.

### Layout

On wide viewports, a two-column API article places prose/definitions in the
primary column and examples in the secondary column. On narrow viewports,
print, without JavaScript, and for linear AT, the same content appears in one
logical order with examples adjacent to their material.

JavaScript may improve tab selection or sticky behavior but must not create,
fetch, or hide the only copy of content. Prefer **all tab panels present and
visible in the DOM** with CSS progressive enhancement so no-JS needs no
`hidden` attribute.

Clipboard controls copy only visible validated text and fail safely. The reader
does not execute copied requests. Download is an ordinary link; no HTML
`download` attribute is used.

### Rich text and links

OpenAPI description fields use the safe Markdown subset and existing URL
policy. Relative links resolve from the **logical base** `/api-reference/`
(not the OpenAPI source file path) and must target a published Markdown page,
generated reference page, or referenced attachment. Images in OpenAPI rich text
must reference validated publication assets; otherwise they fail validation.

## 11. Artifacts, download, and serving

### Atomic publication

OpenAPI inputs, Markdown, generated pages, agent content, attachments, and the
downloadable OpenAPI artifact form one publication. Promotion is atomic.
Failure in OpenAPI parsing, resolution, rendering, validation, upload, or
manifest verification leaves the current publication unchanged.

### Manifest

Artifact **schema version 3** is required for any publication that includes
`api`. Schema v1 and v2 artifacts continue to serve unchanged. New Markdown-
only publications may continue to use schema v2 until the release that makes
v3 universal; OpenAPI-enabled publications must advertise and emit schema 3.

The manifest identifies every generated operation page, schema page, landing
page, agent representation, and the OpenAPI download by logical route, object
checksum, byte size, media type, and page-schema version where applicable.

Generated output is independent of site slug, hostname, and absolute source
paths. Source locations used for diagnostics must not appear in served
artifacts.

Manifest class for the download (not `attachments[]`):

```json
"openapi_download": {
  "route": "/api-reference/openapi.json",
  "object": "openapi/openapi.json",
  "media_type": "application/vnd.nrdocs.openapi+json",
  "filename": "openapi.json",
  "size": 12345,
  "sha256": "..."
}
```

Archive layout adds:

```text
openapi/openapi.json
```

when `api` is present. Agent tree includes landing, operation, and schema
Markdown derived from the same normalized model.

### Bundling algorithm (normative requirements)

The downloadable document is deterministic UTF-8 JSON that is self-contained
with respect to all accepted local dependencies. The algorithm must:

1. preserve the supported OpenAPI version string and supported semantics;
2. rewrite local file `$ref` values into in-document JSON Pointer refs under
   `#/components/...` or equivalent valid internal refs;
3. preserve operation IDs, supported extensions, examples, security schemes,
   and cost metadata;
4. handle repeated and recursive references deterministically (same target →
   same component key);
5. omit no supported declaration silently;
6. use stable key ordering and the cost numeric serialization in §8;
7. strip unsupported vendor extensions per §3;
8. pass the same semantic validation as the generated reference.

It is a processed publication representation, not a byte archive of sources.

### Serving

Generated HTML, agent content, and the OpenAPI download use the same
enabled-site and reader-session checks as ordinary content.

The OpenAPI download response:

- media type `application/vnd.nrdocs.openapi+json`;
- `Content-Disposition: attachment` with sanitized `filename="openapi.json"`
  (Worker header rules match existing attachments);
- `Cache-Control: private, no-store`, `nosniff`;
- no Range or 304;
- never placed in the Cloudflare Cache API.

HTML links to the download with an ordinary `href`; the stored-page allowlist
does not gain a `download` attribute.

### Agent representation

Landing, operation, and schema pages receive normalized agent Markdown from
the same model as HTML, preserving method, path, authentication, parameters,
bodies, responses, examples, schema constraints, deprecation, and cost.
Share with LLM includes these documents. No operation-scoped grants or
per-operation Copy for AI control in this extension.

### Preview parity

Local preview uses the production parser, resolver, normalizer, renderer,
stored-page validator, assets, route table, and access-independent artifact
logic. Preview must not use the network to resolve references or execute
requests.

## 12. Page schema v3 and platform assets

API markup requires artifact schema **v3** and matching immutable platform
assets under `/_nrdocs/v3/`:

```text
/_nrdocs/v3/reader.css
/_nrdocs/v3/reader.js
/_nrdocs/v3/mermaid.js
/_nrdocs/v3/logo.svg
```

One artifact may mix ordinary Markdown pages and API pages; both use the v3
shell and assets when `schema_version` is 3. Schema v1/v2 artifacts keep their
original bytes and assets. Deployment must not reinterpret an old generic page
as an API page.

### Allowlist additions (v3 only)

In addition to the v1/v2 stored-document allowlist, schema v3 may use:

| Construct                                                | Rule                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `div` / `section` with renderer-owned `nr-api-*` classes | Two-column layout regions, cost badge, method/path chrome                                               |
| `button.nr-copy`                                         | Inert copy control; type=`button`; optional `aria-label` with fixed English chrome text                 |
| Tab structure                                            | Class-based `nr-tabs`, `nr-tab`, `nr-tab-panel` without relying on `hidden`; all panels present in HTML |
| `span` / `code` method badges                            | Renderer-owned classes only                                                                             |

Still rejected: `download` attribute, `style`, event handlers, arbitrary
`data-*` (except existing Mermaid `data-nr-mermaid` on Markdown pages),
`role`/`aria-*` beyond the fixed copy-button `aria-label` and existing shell
patterns unless added by a future normative revision of document 09.

CSP for v3 content pages matches schema v1 (`connect-src 'none'`) unless the
page also needs Share with LLM, in which case the Share control continues to
use the existing agent-share path and `connect-src 'self'` as in schema v2.
Clipboard and tabs need no network.

Exact DOM fixtures live in document 09 amendments and package fixtures.

## 13. Compatibility and acceptance

### Backward compatibility

A publication without `api` must:

- accept the same source model as before;
- not parse unrelated YAML/JSON as OpenAPI;
- generate no API routes, pages, navigation, artifacts, or controls;
- not require operation IDs or cost metadata;
- retain existing reader layout for its schema;
- pass existing tests without concealing behavior changes.

Live publications continue under stored schema and assets without
republication.

### Required automated proof (summary)

Configuration, reference generation, cost, artifact/serving, and reader
acceptance criteria from the extension design remain binding. In particular:
Markdown-only unchanged; 3.0/3.1 enable; 2.0/3.2 fail; local refs resolve;
remote/symlink/cycle/limit failures; operationId rules; nav ordering; route
stability; coverage matrix; deterministic examples; cost states; atomic
promotion; access parity for the download; LTR/RTL; no-JS complete content.

## 14. Resource limits

CLI prechecks and Worker enforcement apply. Crossing a limit fails before
upload or promotion; content is never silently omitted.

### Design target

The initial release is designed for OpenAPI descriptions with at most
**200 operations** and at most **200** canonical schema pages (referenced
schemas only). Larger descriptions must fail with a clear limit diagnostic
rather than producing a partial site.

### OpenAPI-specific limits

| Resource                                                | Maximum |
| ------------------------------------------------------- | ------: |
| OpenAPI entry file bytes                                |   2 MiB |
| Total OpenAPI source bytes (entry + local deps)         |   8 MiB |
| OpenAPI dependency files                                |      64 |
| `$ref` resolution depth                                 |      32 |
| Parsed nodes (objects/arrays/scalars) after resolve     | 500,000 |
| Operations (rendered)                                   |     200 |
| Tags                                                    |     100 |
| Canonical schema pages                                  |     200 |
| Parameters per operation                                |     100 |
| Response status entries per operation                   |      50 |
| Media types per request or response                     |       8 |
| Examples per operation (declared + generated baselines) |      32 |
| `x-codeSamples` per operation                           |       8 |
| `x-codeSamples` source bytes each                       |  16,384 |
| Bundled `openapi.json`                                  |   5 MiB |

### Shared artifact limits (amended when `api` present)

When `api` is present, the shared publication limits in document 07 are raised
as follows for that publication only:

| Resource                               | Maximum with `api` |
| -------------------------------------- | -----------------: |
| Published pages (Markdown + generated) |                800 |
| Files declared by the manifest         |              1,600 |
| Combined agent `all.md`                |              8 MiB |

Publications without `api` keep the document 07 defaults (500 pages, 1,000
files, 5 MiB `all.md`).

HTML still ≤ 2 MiB per page; agent page Markdown ≤ 1 MiB. Publishers should
expect DOM validation cost to grow with page count; the 200-operation design
target keeps Worker publish duration within the existing lock/deadline
envelope for typical specs.

## 15. Diagnostics

Preview and publish share one validation pipeline. Failures identify the entry
document, dependency when applicable, JSON Pointer or equivalent location, and
a **stable machine code** without exposing secrets or file bodies.

Minimum machine codes:

| Code                            | Meaning                                           |
| ------------------------------- | ------------------------------------------------- |
| `openapi_unsupported_version`   | Not 3.0.x/3.1.x                                   |
| `openapi_invalid_document`      | Malformed YAML/JSON or OpenAPI structure          |
| `openapi_remote_ref`            | Non-local `$ref`                                  |
| `openapi_ref_resolution`        | Missing, cycle, escape, symlink, ambiguous        |
| `openapi_unsupported_construct` | Rejected construct per §3                         |
| `openapi_operation_id`          | Missing, invalid, or duplicate operationId        |
| `openapi_schema_id`             | Invalid schema name requiring a page              |
| `openapi_route_collision`       | Collision with authored or reserved routes        |
| `openapi_limit_exceeded`        | Any §14 limit                                     |
| `openapi_extension_invalid`     | Invalid x-codeSamples or cost extension           |
| `openapi_link_invalid`          | Rich-text or Markdown link to OpenAPI source path |

CLI exit taxonomy remains as in document 02; these codes appear in structured
diagnostics for CI.

## 16. Relationship to other normative documents

| Topic                                                        | Authority          |
| ------------------------------------------------------------ | ------------------ |
| Product brief amendments (download exception, content scope) | 00 + this document |
| Publisher journeys                                           | 01 + this document |
| `nrdocs.yml` `api` field and nav allowlist                   | 02 + this document |
| Artifact schema v3, manifest, routes                         | 05 + this document |
| Numeric limits                                               | 07 + §14 here      |
| Reader allowlist and assets                                  | 09 + §12 here      |

Where this document amends a prior rule for OpenAPI-enabled publications, the
amendment is explicit. Markdown-only behavior is unchanged.
