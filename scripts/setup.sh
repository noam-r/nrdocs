#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────
# nrdocs setup — checks and installs all required dependencies.
#
# Usage:
#   ./scripts/setup.sh
#
# What it checks:
#   - Node.js (>= 18)
#   - npm
#   - jq
#   - wrangler (installs globally via npm if missing)
#   - npm dependencies (runs npm install if node_modules is missing)
# ──────────────────────────────────────────────────────────────────────

red()    { printf '\033[0;31m%s\033[0m\n' "$1"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$1"; }

ERRORS=0

check() {
  local name="$1"
  local cmd="$2"
  local install_hint="$3"

  if command -v "$cmd" >/dev/null 2>&1; then
    local version
    version=$("$cmd" --version 2>/dev/null | head -1)
    green "✓ $name ($version)"
  else
    red "✗ $name — not found"
    echo "  Install: $install_hint"
    ERRORS=$((ERRORS + 1))
  fi
}

echo "Checking dependencies..."
echo ""

# ── Node.js ───────────────────────────────────────────────────────────

if command -v node >/dev/null 2>&1; then
  NODE_VERSION=$(node -v | sed 's/^v//')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 18 ]; then
    green "✓ Node.js (v$NODE_VERSION)"
  else
    red "✗ Node.js v$NODE_VERSION — need v18 or later"
    echo "  Install: https://nodejs.org/"
    ERRORS=$((ERRORS + 1))
  fi
else
  red "✗ Node.js — not found"
  echo "  Install: https://nodejs.org/"
  ERRORS=$((ERRORS + 1))
fi

# ── npm ───────────────────────────────────────────────────────────────

check "npm" "npm" "comes with Node.js — reinstall Node from https://nodejs.org/"

# ── jq ────────────────────────────────────────────────────────────────

if command -v jq >/dev/null 2>&1; then
  JQ_VERSION=$(jq --version 2>/dev/null)
  green "✓ jq ($JQ_VERSION)"
else
  yellow "⚠ jq — not found (required for the nrdocs CLI)"
  echo "  Attempting to install..."

  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -qq && sudo apt-get install -y -qq jq && green "  ✓ jq installed" || { red "  ✗ Failed to install jq"; ERRORS=$((ERRORS + 1)); }
  elif command -v brew >/dev/null 2>&1; then
    brew install jq && green "  ✓ jq installed" || { red "  ✗ Failed to install jq"; ERRORS=$((ERRORS + 1)); }
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y jq && green "  ✓ jq installed" || { red "  ✗ Failed to install jq"; ERRORS=$((ERRORS + 1)); }
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --noconfirm jq && green "  ✓ jq installed" || { red "  ✗ Failed to install jq"; ERRORS=$((ERRORS + 1)); }
  else
    red "  ✗ Could not auto-install jq. Install manually: https://jqlang.github.io/jq/download/"
    ERRORS=$((ERRORS + 1))
  fi
fi

# ── Wrangler ──────────────────────────────────────────────────────────

if command -v wrangler >/dev/null 2>&1; then
  WRANGLER_VERSION=$(wrangler --version 2>/dev/null | head -1)
  green "✓ Wrangler ($WRANGLER_VERSION)"
else
  yellow "⚠ Wrangler — not found"
  echo "  Installing via npm..."
  npm install -g wrangler && green "  ✓ Wrangler installed ($(wrangler --version 2>/dev/null | head -1))" || { red "  ✗ Failed to install Wrangler"; ERRORS=$((ERRORS + 1)); }
fi

# ── GitHub CLI (for repo-owner onboarding automation) ────────────────

if command -v gh >/dev/null 2>&1; then
  GH_VERSION=$(gh --version 2>/dev/null | head -1)
  green "✓ GitHub CLI ($GH_VERSION)"
  if gh auth status >/dev/null 2>&1; then
    green "✓ gh authentication detected"
  else
    yellow "⚠ gh is installed but not authenticated"
    echo "  Run: gh auth login"
    echo "  Note: nrdocs init needs a token that can manage Actions secrets/variables for the target repo."
  fi
else
  yellow "⚠ GitHub CLI (gh) — not found"
  echo "  Install: https://cli.github.com/"
  echo "  Note: nrdocs init can still run, but you'll configure GitHub Actions secrets/variables manually."
fi

# ── npm dependencies ──────────────────────────────────────────────────

echo ""
if [ -d "node_modules" ]; then
  green "✓ npm dependencies (node_modules exists)"
else
  yellow "⚠ node_modules not found — running npm install..."
  npm install && green "  ✓ npm install complete" || { red "  ✗ npm install failed"; ERRORS=$((ERRORS + 1)); }
fi

# ── .env file ─────────────────────────────────────────────────────────

echo ""
if [ -f ".env" ]; then
  green "✓ .env file exists"
else
  yellow "⚠ .env file not found — creating from .env.example"
  if [ -f ".env.example" ]; then
    cp .env.example .env
    green "  ✓ Created .env from .env.example"
    yellow "  → Edit .env and fill in your values before deploying"
  else
    red "  ✗ .env.example not found either"
    ERRORS=$((ERRORS + 1))
  fi
fi

# ── Wrangler config files ─────────────────────────────────────────────

for cfg in wrangler.toml; do
  if [ -f "$cfg" ]; then
    green "✓ $cfg exists"
  elif [ -f "$cfg.example" ]; then
    cp "$cfg.example" "$cfg"
    green "✓ Created $cfg from $cfg.example"
    yellow "  → Edit $cfg and fill in your account_id and database_id"
  else
    red "✗ $cfg.example not found"
    ERRORS=$((ERRORS + 1))
  fi
done

# ── Summary ───────────────────────────────────────────────────────────

echo ""
if [ "$ERRORS" -eq 0 ]; then
  green "All dependencies are installed."
  echo ""
  echo "Next steps:"
  echo "  1. Run 'wrangler login' to authenticate with Cloudflare"
  echo "  2. Follow the installation guide: docs/content/guides/installation.md"
  echo "  3. Or preview locally: npm run preview"
else
  red "$ERRORS issue(s) found. Fix them and run this script again."
  exit 1
fi
