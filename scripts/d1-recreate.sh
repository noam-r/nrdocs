#!/usr/bin/env bash
# Destroy the remote D1 database named in wrangler.toml and create an empty one with the same name,
# then apply migrations/0001_single_tenant_repos.sql and redeploy delivery + control-plane.
#
# Usage:
#   ./scripts/d1-recreate.sh           # prompts for confirmation
#   ./scripts/d1-recreate.sh --yes     # non-interactive (CI / you know the risk)
#
# Prerequisites: wrangler login, repository root, network.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

YES=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
  esac
done

red() { printf '\033[0;31m%s\033[0m\n' "$1"; }
green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$1"; }

if ! command -v wrangler >/dev/null 2>&1; then
  red "wrangler not found. Install Wrangler (e.g. npm install -g wrangler)."
  exit 1
fi

if ! wrangler whoami >/dev/null 2>&1; then
  red "Not logged in. Run: wrangler login"
  exit 1
fi

# database_name: both Worker envs must use the same D1 name.
NAMES=$(grep -E '^database_name\s*=' wrangler.toml | sed -e 's/^database_name\s*=\s*"\([^"]*\)".*/\1/' | sort -u)
if [ -z "$NAMES" ]; then
  red "Could not parse database_name from wrangler.toml"
  exit 1
fi
LINE_COUNT=$(echo "$NAMES" | wc -l)
if [ "$LINE_COUNT" -ne 1 ]; then
  red "delivery and control-plane must use the same database_name in wrangler.toml. Found:"
  echo "$NAMES"
  exit 1
fi
D1_NAME=$(echo "$NAMES" | head -1)

IDS=$(grep -E '^database_id\s*=' wrangler.toml | sed -e 's/^database_id\s*=\s*"\([^"]*\)".*/\1/' | sort -u)
OLD_ID=$(echo "$IDS" | head -1)
if [ -z "$OLD_ID" ]; then
  red "Could not parse database_id from wrangler.toml"
  exit 1
fi

if [ "$(echo "$IDS" | wc -l)" -ne 1 ]; then
  yellow "Warning: multiple database_id values in wrangler.toml; using first for replacement: ${OLD_ID:0:8}…"
fi

if [ ! -f migrations/0001_single_tenant_repos.sql ]; then
  red "migrations/0001_single_tenant_repos.sql not found"
  exit 1
fi

echo ""
echo "D1 database name:  $D1_NAME"
echo "Current database_id: $OLD_ID"
echo ""
if [ "$YES" -eq 0 ]; then
  printf '%s ' "This deletes the REMOTE D1 database and all its data, then creates a new empty one. Type YES to continue:"
  read -r CONFIRM
  if [ "$CONFIRM" != "YES" ]; then
    yellow "Aborted."
    exit 1
  fi
fi

echo ""
echo "Deleting remote D1 database '${D1_NAME}'..."
if ! wrangler d1 delete "${D1_NAME}" --skip-confirmation; then
  red "Delete failed. If Cloudflare says the database is in use, deploy Workers to another DB first, or remove the binding in the dashboard."
  exit 1
fi
green "Deleted."

echo ""
echo "Creating empty D1 database '${D1_NAME}'..."
D1_OUTPUT=$(wrangler d1 create "${D1_NAME}" 2>&1) || {
  red "Create failed:"
  echo "$D1_OUTPUT"
  exit 1
}

NEW_ID=$(echo "$D1_OUTPUT" | sed -n 's/.*database_id = "\([^"]*\)".*/\1/p' | head -1)
if [ -z "$NEW_ID" ]; then
  NEW_ID=$(echo "$D1_OUTPUT" | grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' | head -1 || true)
fi
if [ -z "$NEW_ID" ]; then
  red "Could not parse new database_id. Wrangler output:"
  echo "$D1_OUTPUT"
  exit 1
fi
green "Created database_id: $NEW_ID"

echo ""
echo "Updating wrangler.toml (both D1 bindings)..."
# Replace every database_id line with the new UUID (delivery + control-plane).
sed -i "s/^database_id = \".*\"/database_id = \"${NEW_ID}\"/" wrangler.toml
green "wrangler.toml updated."

echo ""
echo "Applying schema (0001_single_tenant_repos.sql)..."
wrangler d1 execute "${D1_NAME}" --remote --file=migrations/0001_single_tenant_repos.sql

echo ""
echo "Deploying Workers..."
wrangler deploy --env delivery
wrangler deploy --env control-plane

echo ""
green "Done. Remote D1 '${D1_NAME}' is clean and Workers point at it."
echo "Verify: ./scripts/verify-d1-alignment.sh"
