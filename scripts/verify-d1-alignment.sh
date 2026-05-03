#!/usr/bin/env bash
# Read-only: compare delivery vs control-plane D1 database_id in wrangler.toml,
# optionally query remote D1 for one repo (password hash length only — no secrets).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

red()    { printf '\033[0;31m%s\033[0m\n' "$1"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$1"; }
blue()   { printf '\033[0;34m%s\033[0m\n' "$1"; }

# Hint when wrangler d1 list / d1 execute returns Cloudflare API error 10000 (common with OAuth + D1).
print_d1_auth_hint() {
  yellow "Cloudflare API \"Authentication error [code: 10000]\" for /d1/database often means this CLI call is not authorized for D1,"
  yellow "even when \"wrangler whoami\" shows an OAuth login (known Workers SDK / token-scope friction)."
  echo ""
  echo "Try, in order:"
  echo "  1) Confirm wrangler.toml account_id matches the Cloudflare account that owns this D1 database."
  echo "  2) Re-login:  wrangler logout && wrangler login"
  echo "  3) Use an API token (frequently fixes D1 when OAuth fails):"
  echo "       https://dash.cloudflare.com/profile/api-tokens → Create Token"
  echo "     Template: include Account → D1 → Edit and Account → Account Settings → Read."
  echo "     export CLOUDFLARE_API_TOKEN=\"<token>\""
  echo "     export CLOUDFLARE_ACCOUNT_ID=\"<same as wrangler.toml account_id>\""
  echo "     Unset CLOUDFLARE_API_TOKEN to use OAuth again."
  echo "  4) Inspect data in the dashboard: Workers & D1 → D1 → select database → Console / Data."
  echo ""
}

if [ ! -f wrangler.toml ]; then
  red "wrangler.toml not found in ${ROOT}"
  exit 1
fi

blue "=== D1 database_id values in wrangler.toml ==="
DB_ID_LINES=$(grep -E '^\s*database_id\s*=' wrangler.toml 2>/dev/null || true)
if [ -z "$DB_ID_LINES" ]; then
  red "No database_id lines found in wrangler.toml"
  exit 1
fi
echo "$DB_ID_LINES"

UNIQUE_IDS=$(echo "$DB_ID_LINES" | sed 's/.*=\s*"\([^"]*\)".*/\1/' | sort -u)
N=$(echo "$UNIQUE_IDS" | grep -c . || true)

echo ""
if [ "${N:-0}" -gt 1 ]; then
  red "RESULT: MISMATCH — more than one distinct database_id in wrangler.toml."
  red "  The control plane and delivery worker must use the SAME D1 database_id."
  red "  Otherwise set-password updates one DB while readers read another."
  exit 1
fi

if echo "$UNIQUE_IDS" | grep -q 'REPLACE_WITH_D1_DATABASE_ID'; then
  red "RESULT: INCOMPLETE — database_id is still a placeholder."
  exit 1
fi

green "RESULT: OK — single database_id in this wrangler.toml (delivery + control-plane should share this D1 when deployed from this file)."
echo "  id: $(echo "$UNIQUE_IDS" | head -1)"

D1_NAME=$(grep -E '^\s*database_name\s*=' wrangler.toml | head -1 | sed 's/.*=\s*"\([^"]*\)".*/\1/')
if [ -z "$D1_NAME" ]; then
  red "Could not parse database_name from wrangler.toml"
  exit 1
fi

REPO_ID="${REPO_ID:-}"
if [ -n "$REPO_ID" ]; then
  if ! echo "$REPO_ID" | grep -qE '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'; then
    red "REPO_ID must be a UUID (36 chars with hyphens)."
    exit 1
  fi
  if ! command -v wrangler >/dev/null 2>&1; then
    red "wrangler not in PATH — skip remote query (install Wrangler or use npx wrangler)."
    exit 0
  fi

  ACCOUNT_LINE=$(grep -E '^account_id\s*=' wrangler.toml 2>/dev/null | head -1 || true)
  D1_DB_ID=$(echo "$UNIQUE_IDS" | head -1)

  echo ""
  blue "=== Remote D1 API (read-only) ==="
  echo "  wrangler.toml: ${ACCOUNT_LINE:-account_id not found at column 0}"
  echo "  D1 database_id: ${D1_DB_ID}"
  echo "  D1 database_name (for wrangler): ${D1_NAME}"

  if ! wrangler d1 list >/tmp/nrdocs-d1-list.txt 2>&1; then
    red "wrangler d1 list failed — cannot reach D1 API from this machine."
    cat /tmp/nrdocs-d1-list.txt >&2 || true
    rm -f /tmp/nrdocs-d1-list.txt
    print_d1_auth_hint
    exit 2
  fi
  green "wrangler d1 list: OK"
  if grep -qF "$D1_DB_ID" /tmp/nrdocs-d1-list.txt 2>/dev/null; then
    green "  Output includes database_id ${D1_DB_ID}"
  else
    yellow "  Warning: d1 list output did not contain ${D1_DB_ID} — wrong Cloudflare account or database deleted?"
  fi
  rm -f /tmp/nrdocs-d1-list.txt

  echo ""
  blue "=== Remote row for REPO_ID (password_hash_len = byte length, not the hash) ==="
  SQL="SELECT id, slug, access_mode, CASE WHEN password_hash IS NULL THEN 0 ELSE length(password_hash) END AS password_hash_len, password_version FROM repos WHERE id = '${REPO_ID}';"

  run_d1_execute() {
    local target="$1"
    wrangler d1 execute "$target" --remote --command="$SQL" 2>&1
  }

  if run_d1_execute "$D1_NAME"; then
    :
  elif run_d1_execute "$D1_DB_ID"; then
    green "(Used database_id as wrangler target; name '${D1_NAME}' was rejected.)"
  else
    red "wrangler d1 execute failed for both database name '${D1_NAME}' and id '${D1_DB_ID}'."
    echo ""
    print_d1_auth_hint
    exit 2
  fi

  echo ""
  green "Interpretation:"
  green "  • password_hash_len > 0 → a password hash exists in THIS remote D1 for this repo id."
  green "  • Same database_id for both Workers in wrangler.toml + this query → split-D1 is ruled out for this checkout."
  yellow "If login still fails, check elsewhere: reader URL uses the slug column above; delivery has HMAC_SIGNING_KEY (wrangler secret list --env delivery); deploy latest delivery worker."
  echo ""
  yellow "If password_hash_len is 0 → wrong repo id, or admin API pointed at a different Cloudflare account than this D1."
else
  echo ""
  blue "Optional remote check (no writes): set REPO_ID to your repo UUID to print slug, access_mode, and password_hash length:"
  echo "  REPO_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx $0"
fi

exit 0
