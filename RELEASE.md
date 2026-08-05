# Release process (nrdocs 2.0)

Requires **Node.js ≥ 24** (this repo sets `engines.node`). With nvm:

```bash
nvm install 24   # once
nvm use 24
node -v          # expect v24.x
```

If a shell still has Node 20 on `PATH` (common when nvm default is 20), `pnpm`
will refuse to run until you `nvm use 24` in that shell.

Two gates stand between a green tree and tag `v2.0.0`:

1. **Local** — `pnpm verify` (no Cloudflare credentials)
2. **Cloudflare** — `pnpm test:e2e:cloudflare` with credentials from
   `~/.nrdocs/cloudflare.env` (see below)

If credentials are missing or invalid, the Cloudflare suite skips; a skip does
**not** count for tagging.

---

## 1. Local release candidate

```bash
pnpm verify
```

Runs format, lint, build, typecheck, unit/integration tests, local e2e smoke,
and `pack:check`.

---

## 2. Store the Cloudflare API token

nrdocs does **not** write Cloudflare secrets into instance descriptors. You
create one protected file; the CLI and the tagging suite **read** it.

| Item        | Value                                                       |
| ----------- | ----------------------------------------------------------- |
| Path        | `~/.nrdocs/cloudflare.env`                                  |
| Permissions | directory `~/.nrdocs` → `0700`; file → `0600`               |
| Written by  | you (operator); never by `nrdocs deploy`                    |
| Used by     | `nrdocs deploy`, admin commands, `pnpm test:e2e:cloudflare` |

Resolution order for the API token:

1. Process environment `CLOUDFLARE_API_TOKEN` (CI / one-off override)
2. `~/.nrdocs/cloudflare.env`
3. Wrangler OAuth (`wrangler login`) — interactive fallback only

A stale or invalid `CLOUDFLARE_API_TOKEN` in the shell overrides the file. Unset
it when you intend to use `cloudflare.env`:

```bash
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
```

### 2.1 Create the Cloudflare token

1. [Cloudflare dashboard](https://dash.cloudflare.com/) → **Manage Account** →
   **API Tokens** (account-owned token; preferred) — or **My Profile** →
   **API Tokens** (user token).
2. **Create Token** → **Create Custom Token**.
3. Name it, e.g. `nrdocs`.
4. Add **only** these permission rows (type / permission / access):

| Type    | Permission         | Access |
| ------- | ------------------ | ------ |
| Account | Account Settings   | Read   |
| Account | Workers Scripts    | Edit   |
| Account | D1                 | Edit   |
| Account | Workers R2 Storage | Edit   |

5. **Account Resources** → **Entire account**.
6. Do not add Zone / domain permissions (not needed for tagging or workers.dev
   deploy).
7. **Continue to summary** → **Create Token** → copy the secret once.

Normative detail:
[`nrdocs-specs/08-cloudflare-deployment-and-operations.md`](./nrdocs-specs/08-cloudflare-deployment-and-operations.md).

### 2.2 Write `~/.nrdocs/cloudflare.env`

Copy your **Account ID** from the Cloudflare account overview sidebar
(32-character hex). It identifies the account, not a domain.

```bash
mkdir -p ~/.nrdocs
chmod 700 ~/.nrdocs
umask 077
cat > ~/.nrdocs/cloudflare.env <<'EOF'
CLOUDFLARE_API_TOKEN=paste_the_token_secret_here
CLOUDFLARE_ACCOUNT_ID=paste_the_account_id_here
EOF
chmod 600 ~/.nrdocs/cloudflare.env
```

Verify the file mode is exactly `600` (`ls -l ~/.nrdocs/cloudflare.env`). nrdocs
refuses a world-readable file.

Verify the token (account-owned tokens — including secrets that start with
`cfat_` — must use the **account** verify URL; `/user/tokens/verify` returns
“Invalid API Token” for them):

```bash
set -a && source ~/.nrdocs/cloudflare.env && set +a
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/tokens/verify"
```

Expect `"success": true` and `"status":"active"`. After that, leave the values in
the file only — no lasting shell `export` is required for `nrdocs deploy` or the
tagging suite.

Keep this file out of git and backups you do not consider secret storage. Roll
or delete the Cloudflare token when it is no longer needed.

---

## 3. Disposable Cloudflare suite

Requires a packed Worker (`pnpm --filter nrdocs run bundle:release` if
`packages/cli/packaged/` is missing).

```bash
pnpm test:e2e:cloudflare
```

Credentials are loaded from the environment or `~/.nrdocs/cloudflare.env`. The
suite creates uniquely named Worker / D1 / R2 resources, migrates, deploys,
smokes the origin (`https://<worker>.<account-subdomain>.workers.dev`) when
reachable, then deletes only those resources.

---

## 4. Tag `v2.0.0`

1. `pnpm verify` green (Linux and macOS CI as applicable)
2. `pnpm test:e2e:cloudflare` green and **not** skipped
3. No open blockers in `docs/security-review.md` /
   `docs/dependency-and-bundle-review.md`
4. Annotate tag `v2.0.0` and publish the `nrdocs` package from the release unit
5. Roll or delete the API token if it was created only for tagging

---

## Appendix: custom domain (`nrdocs deploy --domain`)

Same file and account permissions as §2, plus two Zone rows on the Cloudflare
token:

| Type | Permission     | Access |
| ---- | -------------- | ------ |
| Zone | Zone           | Read   |
| Zone | Workers Routes | Edit   |

Under domain resources, choose **Specific domains** for that hostname’s zone.
Keep Account Resources as **Entire account**.
