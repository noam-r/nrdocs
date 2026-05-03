#!/usr/bin/env bash
# Apply single-tenant D1 migration to the REMOTE database named in wrangler.toml
# (`database_name` under d1_databases), then redeploy both Workers.
#
# Prerequisites: wrangler login, run from repository root.
#
# Usage:
#   ./scripts/apply-d1-remote.sh
#
# Migration SQL is idempotent (CREATE IF NOT EXISTS). Re-run this whole script after a pull.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v wrangler >/dev/null 2>&1; then
  echo "wrangler not found. Install Wrangler or run: npm install -g wrangler"
  exit 1
fi

if [ ! -f migrations/0001_single_tenant_repos.sql ]; then
  echo "migrations/0001_single_tenant_repos.sql not found (wrong directory?)"
  exit 1
fi

# First database_name in wrangler.toml (delivery and control-plane must match).
D1_NAME=$(grep -E '^database_name\s*=' wrangler.toml | head -1 | sed -e 's/^database_name\s*=\s*"\([^"]*\)".*/\1/')
if [ -z "$D1_NAME" ]; then
  echo "Could not parse database_name from wrangler.toml"
  exit 1
fi

echo "Applying migrations/0001_single_tenant_repos.sql to REMOTE D1 database '${D1_NAME}'..."
wrangler d1 execute "${D1_NAME}" --remote --file=migrations/0001_single_tenant_repos.sql

echo "Deploying Workers (delivery + control-plane)..."
wrangler deploy --env delivery
wrangler deploy --env control-plane

echo ""
echo "Done. Verify:"
echo "  ./scripts/verify-d1-alignment.sh"
echo "  nrdocs admin list --all"
