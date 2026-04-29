#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────
# nrdocs deploy — automates the full Cloudflare deployment.
#
# Handles: wrangler login check, D1 creation, R2 creation,
# wrangler.toml patching, migrations, secret generation,
# Worker deployment, and .env configuration.
#
# Usage:
#   ./scripts/deploy.sh              # interactive full deploy
#   ./scripts/deploy.sh --skip-login # skip wrangler login check
#
# Prerequisites:
#   - Run ./scripts/setup.sh first
#   - wrangler.toml must exist (created by setup.sh)
# ──────────────────────────────────────────────────────────────────────

red()    { printf '\033[0;31m%s\033[0m\n' "$1"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$1"; }
blue()   { printf '\033[0;34m%s\033[0m\n' "$1"; }

confirm() {
  local msg="$1"
  local default="${2:-y}"
  local hint="[Y/n]"
  [ "$default" = "n" ] && hint="[y/N]"
  printf '%s %s ' "$msg" "$hint"
  read -r answer
  answer="${answer:-$default}"
  case "$answer" in
    [Yy]*) return 0 ;;
    *) return 1 ;;
  esac
}

SKIP_LOGIN=0
for arg in "$@"; do
  case "$arg" in
    --skip-login) SKIP_LOGIN=1 ;;
  esac
done

# ── Preflight checks ─────────────────────────────────────────────────

if [ ! -f "wrangler.toml" ]; then
  red "wrangler.toml not found. Run ./scripts/setup.sh first."
  exit 1
fi

if ! command -v wrangler >/dev/null 2>&1; then
  red "wrangler not found. Run ./scripts/setup.sh first."
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  red "openssl not found. It's needed to generate secrets."
  exit 1
fi

echo ""
blue "═══════════════════════════════════════════════════"
blue "  nrdocs deploy"
blue "═══════════════════════════════════════════════════"
echo ""


# ── Step 1: Wrangler login ────────────────────────────────────────────

blue "Step 1/7: Checking Cloudflare authentication..."

if [ "$SKIP_LOGIN" -eq 0 ]; then
  if wrangler whoami >/dev/null 2>&1; then
    green "✓ Already logged in to Cloudflare"
  else
    yellow "Not logged in. Opening browser for authentication..."
    wrangler login
    if ! wrangler whoami >/dev/null 2>&1; then
      red "Login failed. Run 'wrangler login' manually and try again."
      exit 1
    fi
    green "✓ Logged in to Cloudflare"
  fi
else
  green "✓ Skipping login check (--skip-login)"
fi

# ── Step 2: Get account ID and patch wrangler.toml ────────────────────

echo ""
blue "Step 2/7: Configuring account ID..."

CURRENT_ACCOUNT_ID=$(grep '^account_id' wrangler.toml | head -1 | sed 's/.*= *"\(.*\)"/\1/')

if [ "$CURRENT_ACCOUNT_ID" = "REPLACE_WITH_ACCOUNT_ID" ] || [ -z "$CURRENT_ACCOUNT_ID" ]; then
  # Try to extract from wrangler whoami
  ACCOUNT_INFO=$(wrangler whoami 2>&1 || true)
  DETECTED_ID=$(echo "$ACCOUNT_INFO" | grep -oE '[a-f0-9]{32}' | head -1 || true)

  if [ -n "$DETECTED_ID" ]; then
    echo "Detected account ID: $DETECTED_ID"
    if confirm "Use this account ID?"; then
      sed -i "s/account_id = \"REPLACE_WITH_ACCOUNT_ID\"/account_id = \"$DETECTED_ID\"/" wrangler.toml
      green "✓ Updated wrangler.toml with account ID"
    else
      printf "Enter your Cloudflare account ID: "
      read -r MANUAL_ID
      sed -i "s/account_id = \"REPLACE_WITH_ACCOUNT_ID\"/account_id = \"$MANUAL_ID\"/" wrangler.toml
      green "✓ Updated wrangler.toml with account ID"
    fi
  else
    printf "Enter your Cloudflare account ID (from dashboard.cloudflare.com): "
    read -r MANUAL_ID
    sed -i "s/account_id = \"REPLACE_WITH_ACCOUNT_ID\"/account_id = \"$MANUAL_ID\"/" wrangler.toml
    green "✓ Updated wrangler.toml with account ID"
  fi
else
  green "✓ Account ID already configured: ${CURRENT_ACCOUNT_ID:0:8}..."
fi


# ── Step 3: Create D1 database ────────────────────────────────────────

echo ""
blue "Step 3/7: Setting up D1 database..."

CURRENT_DB_ID=$(grep 'database_id' wrangler.toml | head -1 | sed 's/.*= *"\(.*\)"/\1/')

if [ "$CURRENT_DB_ID" = "REPLACE_WITH_D1_DATABASE_ID" ] || [ -z "$CURRENT_DB_ID" ]; then
  echo "Creating D1 database 'nrdocs'..."
  D1_OUTPUT=$(wrangler d1 create nrdocs 2>&1) || {
    # Database might already exist
    if echo "$D1_OUTPUT" | grep -qi "already exists"; then
      yellow "Database 'nrdocs' already exists. Listing databases..."
      D1_LIST=$(wrangler d1 list 2>&1)
      DB_ID=$(echo "$D1_LIST" | grep -oE '[a-f0-9-]{36}' | head -1 || true)
      if [ -n "$DB_ID" ]; then
        echo "Found database ID: $DB_ID"
      else
        printf "Enter your D1 database ID manually: "
        read -r DB_ID
      fi
    else
      red "Failed to create D1 database:"
      echo "$D1_OUTPUT"
      exit 1
    fi
  }

  if [ -z "${DB_ID:-}" ]; then
    DB_ID=$(echo "$D1_OUTPUT" | sed -n 's/.*database_id = "\([^"]*\)".*/\1/p' | head -1)
    [ -z "${DB_ID:-}" ] && DB_ID=$(echo "$D1_OUTPUT" | grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' | head -1 || true)
  fi

  if [ -z "${DB_ID:-}" ]; then
    echo "Could not parse database ID from output:"
    echo "$D1_OUTPUT"
    printf "Enter the database ID: "
    read -r DB_ID
  fi

  # Patch both occurrences in wrangler.toml
  sed -i "s/REPLACE_WITH_D1_DATABASE_ID/$DB_ID/g" wrangler.toml
  green "✓ D1 database created and wrangler.toml updated (ID: ${DB_ID:0:8}...)"
else
  green "✓ D1 database already configured: ${CURRENT_DB_ID:0:8}..."
fi

# ── Step 4: Create R2 bucket ─────────────────────────────────────────

echo ""
blue "Step 4/7: Setting up R2 bucket..."

R2_OUTPUT=$(wrangler r2 bucket create nrdocs-content 2>&1) || {
  if echo "$R2_OUTPUT" | grep -qi "already exists"; then
    green "✓ R2 bucket 'nrdocs-content' already exists"
  else
    red "Failed to create R2 bucket. You may need to enable R2 in the Cloudflare dashboard first."
    echo "$R2_OUTPUT"
    echo ""
    yellow "Enable R2 at: https://dash.cloudflare.com → R2 Object Storage"
    if confirm "Continue anyway (bucket may already exist)?"; then
      yellow "Continuing..."
    else
      exit 1
    fi
  fi
}

if echo "$R2_OUTPUT" | grep -qi "created"; then
  green "✓ R2 bucket 'nrdocs-content' created"
fi


# ── Step 5: Run database migrations ──────────────────────────────────
#
# Wrangler prints "✘ [ERROR]" for any non-success SQL batch, including benign
# cases like "table X already exists" when re-running deploy against an
# already-initialized D1. That is a SQLite constraint message, not a broken
# deploy — we detect those patterns and report success without surfacing noise.
# Any other failure is treated as real and aborts the script.

echo ""
blue "Step 5/7: Running database migrations..."

migration_already_applied() {
  # Args: path to wrangler log file. Returns 0 if SQLite rejected DDL as already present.
  grep -qiE 'already exists|duplicate column name' "$1"
}

for migration in migrations/*.sql; do
  MIGRATION_NAME=$(basename "$migration")
  echo "  Applying $MIGRATION_NAME..."
  MIG_LOG=$(mktemp)
  if wrangler d1 execute nrdocs --remote --file="$migration" >"$MIG_LOG" 2>&1; then
    green "  ✓ $MIGRATION_NAME applied"
  elif migration_already_applied "$MIG_LOG"; then
    green "  ✓ $MIGRATION_NAME skipped (schema already matches; not an error)"
  else
    red "  ✗ $MIGRATION_NAME failed:"
    cat "$MIG_LOG"
    rm -f "$MIG_LOG"
    exit 1
  fi
  rm -f "$MIG_LOG"
done

# ── Step 6: Generate and set secrets ─────────────────────────────────

echo ""
blue "Step 6/7: Configuring secrets..."

generate_secret() {
  openssl rand -hex 32
}

# Check if secrets are already set by attempting a deploy dry-run
# We'll generate and set them — wrangler secret put is idempotent-ish
# (it overwrites, but that's fine for first deploy)

SECRETS_FILE=$(mktemp)
trap 'rm -f "$SECRETS_FILE"' EXIT

API_KEY=""
HMAC_KEY=""
TOKEN_KEY=""

if [ -f ".env" ] && grep -q "^NRDOCS_API_KEY=" .env; then
  EXISTING_KEY=$(grep "^NRDOCS_API_KEY=" .env | cut -d= -f2-)
  if [ "$EXISTING_KEY" != "your-api-key-here" ] && [ -n "$EXISTING_KEY" ]; then
    echo "Found existing API key in .env"
    if confirm "Re-use existing API key from .env?"; then
      API_KEY="$EXISTING_KEY"
    fi
  fi
fi

if [ -z "$API_KEY" ]; then
  API_KEY=$(generate_secret)
  echo "Generated new API key"
fi

HMAC_KEY=$(generate_secret)
TOKEN_KEY=$(generate_secret)

echo "Setting secrets on Workers (this may take a moment)..."

# Delivery Worker — HMAC only
echo "$HMAC_KEY" | wrangler secret put HMAC_SIGNING_KEY --env delivery 2>&1 | tail -1
green "  ✓ HMAC_SIGNING_KEY set on delivery worker"

# Control Plane Worker — all three
echo "$API_KEY" | wrangler secret put API_KEY --env control-plane 2>&1 | tail -1
green "  ✓ API_KEY set on control-plane worker"

echo "$HMAC_KEY" | wrangler secret put HMAC_SIGNING_KEY --env control-plane 2>&1 | tail -1
green "  ✓ HMAC_SIGNING_KEY set on control-plane worker"

echo "$TOKEN_KEY" | wrangler secret put TOKEN_SIGNING_KEY --env control-plane 2>&1 | tail -1
green "  ✓ TOKEN_SIGNING_KEY set on control-plane worker"

rm -f "$SECRETS_FILE"


# ── Step 7: Deploy Workers ───────────────────────────────────────────

echo ""
blue "Step 7/7: Deploying Workers..."

echo "  Deploying Delivery Worker..."
DELIVERY_OUTPUT=$(wrangler deploy --env delivery 2>&1) || {
  red "Failed to deploy Delivery Worker:"
  echo "$DELIVERY_OUTPUT"
  exit 1
}
green "  ✓ Delivery Worker deployed"

echo "  Deploying Control Plane Worker..."
CP_OUTPUT=$(wrangler deploy --env control-plane 2>&1) || {
  red "Failed to deploy Control Plane Worker:"
  echo "$CP_OUTPUT"
  exit 1
}
green "  ✓ Control Plane Worker deployed"

# Extract control plane URL from deploy output
CP_URL=$(echo "$CP_OUTPUT" | grep -oE 'https://[^ ]+workers\.dev' | head -1 || true)
if [ -z "$CP_URL" ]; then
  CP_URL=$(echo "$CP_OUTPUT" | grep -oE 'https://[^ ]+' | head -1 || true)
fi

# ── Update .env ──────────────────────────────────────────────────────

echo ""
blue "Updating .env..."

if [ ! -f ".env" ]; then
  cp .env.example .env 2>/dev/null || true
fi

if [ -f ".env" ]; then
  # Update API URL
  if [ -n "$CP_URL" ]; then
    sed -i "s|^NRDOCS_API_URL=.*|NRDOCS_API_URL=$CP_URL|" .env
    green "✓ Set NRDOCS_API_URL=$CP_URL"
  fi

  # Update API key
  sed -i "s|^NRDOCS_API_KEY=.*|NRDOCS_API_KEY=$API_KEY|" .env
  green "✓ Set NRDOCS_API_KEY in .env"
fi

# ── Summary ──────────────────────────────────────────────────────────

echo ""
blue "═══════════════════════════════════════════════════"
green "  Deployment complete!"
blue "═══════════════════════════════════════════════════"
echo ""
echo "  Control Plane: ${CP_URL:-<check wrangler output>}"
echo "  API Key:       ${API_KEY:0:8}... (saved in .env)"
echo ""
echo "  Your .env is configured. Next steps:"
echo ""
echo "  Option A — Bootstrap onboarding (for developers):"
echo "    Issue a bootstrap token, then run:"
echo "    nrdocs init --token <bootstrap-token>"
echo ""
echo "  Option B — Admin CLI (for platform operators):"
echo "    nrdocs admin register"
echo "    nrdocs admin approve"
echo "    nrdocs admin publish"
echo ""
echo "  To verify the deployment:"
echo "    curl -s -o /dev/null -w '%{http_code}' ${CP_URL:-\$NRDOCS_API_URL}/projects"
echo "    (expect 401 — that means auth is working)"
echo ""
