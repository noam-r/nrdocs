# nrdocs 2.0 Phase 0A Feasibility Report (sanitized)

## Verdict

**PASS**

Disposable Cloudflare probes completed with no architectural blocker for the
no-administrator-API model. Phase 0 repository replacement may be authorized
separately.

## Scope and method

- Ran only from `/tmp` disposable directories; the active `nrdocs` tree was not
  modified for spike code.
- Resource prefix: `nrdocs-0a-<random>` (Worker, D1, R2).
- All spike resources were deleted and verified absent at the end.
- This report omits account IDs, resource UUIDs, hostnames, tokens, and signed
  URLs.

## Credential flow

| Item                                                     | Result                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| Preferred `CLOUDFLARE_API_TOKEN`                         | Not usable as a non-empty API token in this environment            |
| Fallback                                                 | `wrangler auth token --json` (OAuth) from a neutral temp directory |
| Matches document 08 order                                | Yes (API token first, then Wrangler OAuth)                         |
| Persisted by nrdocs / spike into product state           | No                                                                 |
| S3 / R2 access keys created                              | No                                                                 |
| Same bearer for Worker deploy, D1 control plane, R2 REST | Yes                                                                |

OAuth token permissions observed via `wrangler whoami` included Workers write,
D1 write, account/user read, and zone read. R2 REST object operations succeeded
with that same OAuth bearer even though R2 was not listed as a distinct
whoami scope line—treat production preflight as capability probes, not whoami
text alone.

## Exit-gate results

| Gate                                                                   | Result | Evidence                                                                                                                                                |
| ---------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy Worker + D1 + private R2 + bindings from an arbitrary directory | Pass   | `wrangler deploy` from `/tmp/.../worker` with D1 and R2 bindings                                                                                        |
| Shared atomic D1 via control-plane API                                 | Pass   | `POST /accounts/{id}/d1/database/{db}/query` with body `{ "batch": [ {sql, params}, ... ] }`; failing later statement rolled back (row count unchanged) |
| Shared atomic D1 via Worker binding                                    | Pass   | `env.DB.batch([...])` through `wrangler dev --remote` on loopback; success batch inserted; failing batch rolled back                                    |
| R2 prefix list / interrupted delete / resume empty with bearer only    | Pass   | R2 REST `GET/PUT/DELETE .../r2/buckets/{bucket}/objects`; interrupted single-object delete then full prefix purge → 0 remaining                         |
| Streaming `.tar.gz` ingest into private R2                             | Pass   | Worker `DecompressionStream("gzip")` + incremental ustar parse + `env.ARTIFACTS.put`; 3 files written                                                   |
| Cleanup + interrupted cleanup retry                                    | Pass   | Delete Worker first (interrupt), then empty/delete R2 and D1; verification found no remaining `nrdocs-0a-*` resources                                   |

## APIs and entry points exercised

| Operation                          | Entry point                                          |
| ---------------------------------- | ---------------------------------------------------- |
| Auth discovery                     | `wrangler whoami`, `wrangler auth token --json`      |
| D1 create / delete / query / batch | Cloudflare D1 HTTP API                               |
| R2 bucket create / delete          | Cloudflare R2 bucket HTTP API                        |
| R2 object list / put / delete      | Cloudflare R2 object HTTP API (bearer, not S3)       |
| Worker upload + bindings           | `wrangler deploy` (modules Worker, D1 + R2 bindings) |
| Worker binding execution           | `wrangler dev --remote` → `http://127.0.0.1:8787`    |
| Streaming ingest                   | Worker route `POST /ingest`                          |

### Control-plane D1 batch shape (locked by measurement)

Use:

```json
{
  "batch": [
    { "sql": "INSERT ... VALUES (?);", "params": ["a"] },
    { "sql": "INSERT ... VALUES (?);", "params": ["b"] }
  ]
}
```

Do **not** send multiple statements in one `sql` string together with a shared
`params` array. That form returns HTTP 400:
`params with multiple statements is not supported`.

The Worker adapter uses `env.DB.batch([statement, ...])`. Persistence operations
must compile to both shapes without diverging SQL semantics.

## Streaming / limit observations

Representative probe artifact (not a production load test):

| Metric                   |                            Value |
| ------------------------ | -------------------------------: |
| Files                    |                                3 |
| Uncompressed tar         |                       4096 bytes |
| Compressed gzip          |                        226 bytes |
| Ingest wall time         | ~1.5–1.7 s (remote preview path) |
| Worker-reported duration |                          1528 ms |
| Objects written          |                                3 |

Public `*.workers.dev` HTTPS from this development host timed out (TCP to
Cloudflare edge unreachable). That is an environment networking constraint, not
a Cloudflare deploy failure. Binding behavior was validated through Wrangler
remote preview on loopback against the same remote D1/R2 resources. Production
Phase 9 must still load-test document 07 limits from a network path that can
reach the deployed Worker origin.

## Architectural implications

1. The no-administrator-API model remains viable: D1 and R2 administration work
   with an externally resolved Cloudflare bearer and without nrdocs-held R2
   secrets.
2. Shared persistence is implementable: one operation model can target Worker
   `DB.batch` and control-plane `{ batch: [...] }` with identical SQL.
3. Private R2 prefix deletion for site delete / artifact cleanup is supportable
   via paginated REST list + delete and is safely resumable after interruption.
4. Streaming gzip+tar extraction into R2 inside a Worker is feasible for the
   probed sizes; enforce and re-measure document 07 numeric limits in Phase 9.
5. Production deploy preflight should probe R2 object capabilities explicitly;
   do not rely only on Wrangler whoami scope labels.

## Blockers

None remaining for Phase 0A.

## Follow-ups (non-blocking)

- Prefer a real `CLOUDFLARE_API_TOKEN` with the least-privilege matrix from
  document 08 for production admin CI; OAuth remains a valid interactive
  fallback.
- Ensure developer/CI networks that run Worker HTTP smoke tests can reach the
  instance origin (or continue using Wrangler remote preview for binding checks).
- Add `429 rate_limited` to the publisher error table in document 05 when
  convenient (already normative in document 07).

## Next authorized action

Phase 0 (legacy tag + clean 2.0 workspace bootstrap) requires a **separate**
explicit authorization. Do not begin Phase 0 from this report alone.
