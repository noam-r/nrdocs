# D1 migrations

Schema file: **`0001_single_tenant_repos.sql`** (idempotent `CREATE IF NOT EXISTS`).

## Clean slate (recommended): drop + create + migrate + deploy

From the repo root, logged in with Wrangler (`wrangler login`):

```bash
npm run d1:recreate
```

Or:

```bash
./scripts/d1-recreate.sh
```

Non-interactive (must pass confirmation explicitly):

```bash
./scripts/d1-recreate.sh --yes
```

This script:

1. Reads **`database_name`** from **`wrangler.toml`** (delivery and control-plane must match).
2. **`wrangler d1 delete <name>`** on the remote database (all data is destroyed).
3. **`wrangler d1 create <name>`** (same name, new empty database).
4. Writes the new **`database_id`** into **both** D1 blocks in **`wrangler.toml`**.
5. Applies **`migrations/0001_single_tenant_repos.sql`** remotely.
6. **`wrangler deploy --env delivery`** and **`wrangler deploy --env control-plane`**.

Then verify (D1 binding + optional remote row check):

```bash
./scripts/verify-d1-alignment.sh
```

**Secrets** on the Workers are unchanged; only D1 is replaced.

If **`d1 delete`** fails (database “in use”), unbind or switch bindings in the dashboard, or open a support ticket—Cloudflare sometimes blocks delete while a binding still references the old UUID.

---

## Schema refresh only (same D1 UUID, no delete)

```bash
npm run apply-d1-remote
```

This only runs the migration SQL and deploys Workers; it does **not** remove legacy tables from an old schema.
