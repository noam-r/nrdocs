# OpenAPI Reference Extension Readiness Assessment

## Verdict

**Product readiness: ready.**

The additive `api` block model, authority split (OpenAPI for reference,
Markdown for guides), safety boundaries, and user outcomes are coherent and
aligned with nrdocs 2.0.

**Implementation readiness: ready for specification security review, not yet
for application code.**

Document [`12-openapi-reference-extension.md`](./12-openapi-reference-extension.md)
integrates the former extension bundle and closes the product and engineering
contracts that blocked coding:

1. exact `api` configuration schema;
2. operation and schema identifier grammar (strict portable, fail-closed);
3. OpenAPI 3.0/3.1 supported subset and reject matrix;
4. rich-text link base (`/api-reference/`) and OpenAPI-source link ban;
5. exact `x-codeSamples`, `x-nrdocs-costs`, and `x-nrdocs-cost` schemas;
6. cost numeric precision and serialization;
7. bundling requirements, route, filename, and media type;
8. OpenAPI-specific and amended shared resource limits;
9. artifact schema v3 and page-schema allowlist direction;
10. agent inclusion of landing, operation, and schema pages;
11. English API chrome vs `language`/`direction`;
12. landing page and prev/next order;
13. explicit-nav allowlist amendment;
14. example/secret policy (synthesized vs declared vs `x-codeSamples`);
15. API-only publications;
16. stable diagnostic machine codes.

## Product decisions locked (formerly open)

| Decision        | Lock                                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Activation      | Optional `api.specification` only; no site type                                                                                              |
| Landing         | `/api-reference/` with info, servers, auth, download                                                                                         |
| Chrome language | Fixed English strings; `lang`/`dir` still apply                                                                                              |
| Nav allowlist   | Authored Markdown ∪ generated API pages                                                                                                      |
| `generate nav`  | Never emits API entries; preserves `api`                                                                                                     |
| API-only        | Allowed; root redirects to `/api-reference/`                                                                                                 |
| Download        | One generated bundled JSON; amends non-goal 18                                                                                               |
| OpenAPI subset  | Explicit support/reject/ignore; no silent discard of supported constructs; callbacks/webhooks rejected                                       |
| Examples        | Same request in cURL / JavaScript / HTTP tabs; labels not tabs; synthesized placeholders safe; declared examples verbatim; samples unscanned |
| Schema pages    | Only schemas referenced by rendered operations                                                                                               |
| Design target   | ≤ 200 operations, ≤ 200 schema pages                                                                                                         |
| Costs           | Included in v1 with closed numeric rules                                                                                                     |
| `x-codeSamples` | `lang` only (not `language`); unknown fields fail                                                                                            |
| Artifact        | Schema v3 for OpenAPI-enabled publications                                                                                                   |

## Remaining gates before coding

~~1. Security and compatibility review of artifact schema v3~~ — authorized to
proceed on branch `feature/openapi-reference-v1`; review continues on the PR.
~~2. Amendments landed~~ — complete in documents 00–09, 12, 13.
~~3. Implementation plan phase~~ — implementation underway on
`feature/openapi-reference-v1` (Full v1 scope).

Application code for this extension lives on `feature/openapi-reference-v1`.

## Implementation status

Implemented on `feature/openapi-reference-v1`:

- optional `api.specification` configuration;
- OpenAPI 3.0/3.1 load, local `$ref`, validate, normalize;
- landing, operation, and schema pages + agent Markdown;
- costs and `x-codeSamples`;
- bundled `openapi/openapi.json` download;
- artifact schema v3 and reader `/_nrdocs/v3/` assets;
- Worker validation and OpenAPI download serving;
- local preview serving the same packaged `/_nrdocs/v{1,2,3}/` reader assets as deploy.

## Recommended next action

1. ~~Complete the normative amendments~~ done.
2. Security/compatibility review on the PR (schema v3 allowlist + download).
3. ~~Author an implementation-plan phase; then code~~ coding in progress on the
   feature branch; merge after review and CI green.
