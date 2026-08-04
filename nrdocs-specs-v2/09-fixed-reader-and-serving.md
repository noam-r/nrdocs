# nrdocs 2.0 Fixed Reader and Serving Contract

## Status

Normative and locked for nrdocs 2.0.

This document defines the complete native reader interface, stored-page
validation, browser behavior, routes, response headers, and failure pages.

## UI Foundation

The reader is a native static interface built from semantic HTML, one fixed CSS
file, and minimal framework-free JavaScript. nrdocs does not adopt shadcn/ui,
React, Tailwind CSS, or any component-library or UI-framework dependency in the
reader or renderer. External design systems may inspire evaluation, but are not
dependencies, sources of normative behavior, or copy-and-paste component code.

There is one platform-owned page shell. Publishers control Markdown-derived
article content and navigation labels only; they cannot supply templates,
themes, CSS, JavaScript, HTML, SVG, headers, or layout components.

## Versioned Platform Assets

Page schema version 1 uses exactly:

```text
/_nrdocs/v1/reader.css
/_nrdocs/v1/reader.js
/_nrdocs/v1/mermaid.js
```

The first two appear on every content page. `reader.js` imports `mermaid.js`
only when a Mermaid block exists. Assets are packaged and deployed atomically
with the Worker. Package-manifest hashes are checked during build and deploy;
same-origin subresource integrity attributes are not required.

## Complete Page Skeleton

Every stored page is a complete UTF-8 HTML5 document with this platform-owned
shape; values shown as placeholders are escaped validated data:

```html
<!doctype html>
<html lang="<language>" dir="<direction>">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title><page-title> · <site-name></title>
  <link rel="stylesheet" href="/_nrdocs/v1/reader.css">
  <script type="module" src="/_nrdocs/v1/reader.js"></script>
</head>
<body>
  <a class="nr-skip" href="#nr-content">Skip to content</a>
  <header class="nr-header">
    <button class="nr-nav-toggle" type="button" aria-controls="nr-nav" aria-expanded="false">Menu</button>
    <a class="nr-site-title" href="<site-root-relative-href>"><site-name></a>
    <button class="nr-theme-toggle" type="button" aria-label="Change color theme">Theme</button>
  </header>
  <div class="nr-layout">
    <aside class="nr-sidebar" id="nr-nav">
      <nav class="nr-nav" aria-label="Documentation"><navigation></nav>
    </aside>
    <main class="nr-main" id="nr-content" tabindex="-1">
      <article class="nr-article">
        <rendered-content>
        <nav class="nr-pagination" aria-label="Page navigation"><previous-and-next-links></nav>
      </article>
    </main>
  </div>
  <footer class="nr-footer">Published with nrdocs</footer>
</body>
</html>
```

The validator requires the doctype, element order, single occurrences, exact
fixed text, asset URLs, and shell attributes. It rejects additional head or
shell nodes. The renderer produces stable two-space indentation and LF endings.

The documentation nav contains one `ul.nr-nav-list`; nested sections use nested
`ul.nr-nav-list` elements up to the configured navigation-depth limit. Each page
is one `li.nr-nav-item` containing one canonical route-relative link; only the
current link has `aria-current="page"`. Pagination contains an optional
`a.nr-prev` followed by an optional `a.nr-next`, omitting the element at the
respective boundary. Their text is the adjacent page title and their `href`
values use the same route-relative algorithm. An empty pagination element is
omitted.

## Stored-Document Allowlist

The Worker parses each page as HTML and validates the DOM; regex validation is
insufficient. Documents may contain only:

`html`, `head`, `meta`, `title`, `link`, `script`, `body`, `a`, `div`, `header`,
`button`, `aside`, `nav`, `ul`, `ol`, `li`, `main`, `article`, `section`,
`footer`, `h1` through `h6`, `p`, `blockquote`, `pre`, `code`, `strong`, `em`,
`del`, `hr`, `br`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `img`, `input`,
and `span`.

HTML comments, processing instructions, foreign namespaces, `template`,
`style`, `form`, `iframe`, `object`, `embed`, `audio`, `video`, `canvas`, and
`svg` are rejected.

Shell elements accept only the attributes shown in the skeleton and the exact
`nr-*` classes required by the renderer. Content accepts only:

| Element | Allowed attributes |
| --- | --- |
| Heading | `id="nr-h-<16 lowercase hex>"` |
| `a` | validated `href`; optional escaped `title` |
| `img` | validated `src`, required `alt`, optional `title`, exact `loading="lazy"`, `decoding="async"` |
| `ol` | optional integer `start` from -100000 through 100000 |
| `th`, `td` | optional class `nr-align-left`, `nr-align-center`, or `nr-align-right` |
| Task `input` | exact `type="checkbox"`, `disabled`, optional `checked` |
| `pre`, `code`, `span` | renderer-owned language, highlighting, or Mermaid classes defined below |

All other attributes are rejected, including `style`, event handlers, `target`,
`download`, arbitrary `id`, and arbitrary `data-*`. Text is valid UTF-8 and
contains no NUL. Attribute order is canonical in renderer output.

## URL Rules

Internal links—including the site-title, navigation, previous/next, article,
image, and attachment links—are computed from site-relative public routes. They
never contain the site slug, hostname, or origin.

For a current page route and target public path, remove their longest common
directory prefix, emit one `../` for every remaining directory segment in the
current page route, then emit the remaining target segments. Page targets end
with `/`; file targets retain their filename. A target at the same directory is
`./`; a fragment may follow the computed reference. For example:

| Current page | Target | Stored `href` |
| --- | --- | --- |
| `/` | `/` | `./` |
| `/` | `/overview/` | `overview/` |
| `/guides/install/` | `/` | `../../` |
| `/guides/install/` | `/guides/configuration/` | `../configuration/` |

Here the routes are site-relative and deliberately omit `/<slug>`. The same
artifact therefore remains valid after a site rename without Worker rewriting.

The stored-document validator accepts `./` and leading `../` segments only when
they are the unique result of this algorithm for a manifest-declared target and
do not traverse above the site root. The site root is always a valid internal
target, including when it redirects to the manifest's first navigable page. The
validator rejects redundant or embedded dot segments, protocol-relative URLs,
userinfo, backslashes, controls, malformed percent encoding, and unresolved
internal targets.

Article links may alternatively be a fragment or an absolute `http`, `https`,
or `mailto` URL. Every other scheme is rejected.

Images must be declared local raster assets and use artifact-relative URLs.
External, `data:`, blob, and SVG images are rejected. The only root-relative
resource URLs in stored pages are the exact platform assets in this document.

## Syntax Highlighting

nrdocs pins highlight.js 11.11.1 and never uses language auto-detection. The
bundled grammars are:

`plaintext`, `bash`, `javascript`, `typescript`, `json`, `yaml`, `markdown`,
`xml`, `css`, `sql`, `python`, `java`, `c`, `cpp`, `csharp`, `go`, `rust`,
`ruby`, `php`, `kotlin`, `swift`, `dockerfile`, `ini`, `toml`, `http`, and
`diff`.

Aliases map `shell` and `sh` to `bash`; `js` to `javascript`; `ts` to
`typescript`; `yml` to `yaml`; `md` to `markdown`; `html` to `xml`; and `py` to
`python`. Unknown or absent languages render escaped plaintext with
`language-plaintext`. Highlighted spans use only the pinned highlighter's
enumerated `hljs-*` classes captured in the page-schema fixture.

## Mermaid

nrdocs pins Mermaid 11.16.0. The renderer stores escaped source inertly as:

```html
<pre class="nr-mermaid" data-nr-mermaid><code>...</code></pre>
```

`data-nr-mermaid` is the only content data attribute. The Worker enforces the
block limits in the security specification. After DOM readiness, `reader.js`
lazy-imports the same-origin bundle and initializes Mermaid with
`securityLevel: "strict"`, `htmlLabels: false`, deterministic IDs, and no
callbacks or external-link behavior. It rerenders when the effective theme
changes.

If a diagram fails, the source remains visible and the fixed message `Diagram
could not be rendered.` is added. Parser details are not shown or logged with
publisher source.

## Theme Behavior

The initial theme is `system`. The theme button cycles `system`, `light`, then
`dark`. The only persisted browser value is local-storage key `nrdocs-theme`
with one of those three strings. An invalid value is removed.

`reader.js` sets `data-nr-theme` on the document element. System mode follows
`prefers-color-scheme` changes. Theme state is not a cookie, server setting,
publisher option, or site configuration field.

## Responsive Navigation

On desktop, the sidebar is visible. On narrow screens, the same navigation DOM
is an off-canvas panel. The menu button updates `aria-expanded`, moves focus to
the first navigation item when opened, closes on Escape or navigation, returns
focus to the button, and prevents background scrolling while open. All content,
navigation, theme, and access actions are keyboard-operable with visible focus.

The document `dir` is `ltr`, `rtl`, or `auto` from the locked site tuple. Layout
uses logical CSS properties and is tested in both LTR and RTL.

## Reader Routes and Canonicalization

The route contract in the publication specification applies. GET and HEAD
canonicalization redirects use 308. A valid password POST redirects with 303.
Site rename creates no redirect from the old slug.

HEAD returns the corresponding GET status and headers with no body. Range
requests are ignored and return the complete 200 representation; nrdocs does not
emit `Accept-Ranges`.

### Safe return path

A password form return value is accepted only when it:

- is at most 2,048 UTF-8 bytes after exactly one percent-decoding pass;
- begins exactly `/<current-slug>/`;
- contains no scheme, authority, `//`, backslash, query, fragment, control,
  malformed encoding, empty segment, or dot segment, including encoded forms;
- equals its canonical route form; and
- is bound into the signed CSRF value.

Invalid input falls back to `/<current-slug>/`; it is never reflected in an
error. Logout returns to that same site root.

## Fixed Platform Pages

Platform pages use the current site's language and direction where known, or
`lang="und" dir="auto"` otherwise. Copy is exact:

| Page | Heading | Body/action |
| --- | --- | --- |
| Instance root | `nrdocs` | `This nrdocs instance serves sites at their direct URLs.` |
| Password form | `Password required` | `Enter the password to continue.`; label `Password`; button `Continue` |
| Wrong password | `Password required` | `The password is incorrect. Try again.` |
| Logout | `You have been signed out.` | Link `Return to site.` |
| 404 | `Not found` | `The requested page is unavailable.` |
| 500/503 | `Site temporarily unavailable` | `Try again later.` and a safe request ID |

Access pages contain the signed hidden CSRF and safe-return fields described in
the security specification. No platform error discloses whether an unknown
slug, disabled site, missing artifact, or storage inconsistency exists beyond
the documented status/error contract.

## MIME and Attachment Rules

| Extension | Content-Type |
| --- | --- |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.webp` | `image/webp` |
| `.avif` | `image/avif` |
| `.ico` | `image/vnd.microsoft.icon` |
| `.pdf` | `application/pdf` |
| `.txt` | `text/plain; charset=utf-8` |
| `.csv` | `text/csv; charset=utf-8` |
| `.json` | `application/json` |
| `.yaml`, `.yml` | `application/yaml` |
| `.toml` | `application/toml` |
| `.xml` | `application/xml` |
| `.ndjson` | `application/x-ndjson` |
| `.zip` | `application/zip` |

HTML is `text/html; charset=utf-8`; platform CSS and JavaScript use their
standard UTF-8 MIME types. Unknown extensions are not publishable.

Attachments use `Content-Disposition: attachment; filename="download"` plus a
UTF-8 `filename*` generated from the declared basename. CR, LF, controls,
quotes, slash, backslash, bidi controls, and path syntax are removed; an empty
result becomes `download`. Inline display is limited to validated raster images
and site HTML.

## Cache Behavior

All site HTML, images, and attachments use `Cache-Control: private, no-store`.
Password, logout, API, and error responses also use `no-store`. nrdocs 2.0 does
not place site content in the Cloudflare Cache API, ensuring policy and access
changes are immediate.

Versioned platform assets use `Cache-Control: public, max-age=300,
must-revalidate` and a strong content-hash ETag. They support `If-None-Match`
and 304. Site content does not return 304.

## Security Headers

Reader HTML uses:

```text
Content-Security-Policy: default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; manifest-src 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
X-Frame-Options: DENY
```

`'unsafe-inline'` is limited to styles because the trusted Mermaid runtime may
generate SVG style attributes; the stored-document validator still prohibits
publisher style elements and attributes. Inline scripts are never allowed.

Custom-domain responses also use `Strict-Transport-Security: max-age=31536000`;
`includeSubDomains` and `preload` are deliberately absent. API responses use
`default-src 'none'`, `nosniff`, and `no-store`. Attachments add a restrictive
`Content-Security-Policy: sandbox; default-src 'none'` and their attachment
disposition.

## Storage Inconsistency

If D1 points to a missing or invalid R2 object, the Worker returns controlled
503 code `site_storage_inconsistent` with the fixed unavailable page and a safe
request ID. It does not serve an older artifact, expose an object key, or attempt
repair in the reader path. Logs include only safe opaque site/artifact IDs and
the request ID.

## Reader Acceptance Criteria

1. Stored-document fixtures prove exact shell output and reject every forbidden
   element, attribute, URL, namespace, and structural variation.
2. Snapshot and browser tests cover LTR, RTL, narrow and wide viewports, keyboard
   navigation, focus restoration, reduced motion, system/light/dark themes, and
   JavaScript-disabled readable content.
3. Syntax fixtures prove pinned languages, aliases, no auto-detection, and safe
   plaintext fallback.
4. Mermaid fixtures prove lazy loading, strict configuration, theme rerendering,
   deterministic output, and safe failure text.
5. Route tests cover GET, HEAD, canonical 308, password 303, unsafe returns,
   range handling, MIME types, and attachment filenames.
6. Header tests cover every page class, platform asset caching, no-store site
   content, and custom-domain HSTS.
7. A D1/R2 mismatch returns controlled 503 and never stale content.
