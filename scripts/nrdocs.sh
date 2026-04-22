#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────
# nrdocs CLI — local management tool for the nrdocs platform.
#
# Usage:
#   ./scripts/nrdocs.sh <command> [options]
#
# Commands:
#   init                Register a new project and approve it
#   register            Register a new project (awaiting_approval)
#   approve             Approve a registered project
#   publish             Build and publish docs to the Control Plane
#   disable             Disable a project (returns 404, preserves data)
#   delete              Delete a project and all its data
#   status              Show project details
#   help                Show this help message
#
# Configuration:
#   Reads from .env in the project root. Copy .env.example to .env
#   and fill in your values.
# ──────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Load .env (command-line env vars take precedence) ─────────────────

# Save any values set on the command line before sourcing .env
_CLI_DOCS_DIR="${NRDOCS_DOCS_DIR:-}"
_CLI_API_URL="${NRDOCS_API_URL:-}"
_CLI_API_KEY="${NRDOCS_API_KEY:-}"
_CLI_PROJECT_ID="${NRDOCS_PROJECT_ID:-}"
_CLI_SITE_URL="${NRDOCS_SITE_URL:-}"

ENV_FILE="$ROOT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

# Command-line values override .env values
DOCS_DIR="${_CLI_DOCS_DIR:-${NRDOCS_DOCS_DIR:-docs}}"
API_URL="${_CLI_API_URL:-${NRDOCS_API_URL:-}}"
API_KEY="${_CLI_API_KEY:-${NRDOCS_API_KEY:-}}"
PROJECT_ID="${_CLI_PROJECT_ID:-${NRDOCS_PROJECT_ID:-}}"
SITE_URL="${_CLI_SITE_URL:-${NRDOCS_SITE_URL:-}}"

# ── Helpers ───────────────────────────────────────────────────────────

red()    { printf '\033[0;31m%s\033[0m\n' "$1"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$1"; }

die() { red "Error: $1" >&2; exit 1; }

require_env() {
  [ -n "$API_URL" ]    || die "NRDOCS_API_URL is not set. Configure it in .env"
  [ -n "$API_KEY" ]    || die "NRDOCS_API_KEY is not set. Configure it in .env"
}

require_project_id() {
  [ -n "$PROJECT_ID" ] || die "NRDOCS_PROJECT_ID is not set. Run 'nrdocs.sh register' first, then add the ID to .env"
}

require_jq() {
  command -v jq >/dev/null 2>&1 || die "jq is required but not installed. Install it: https://jqlang.github.io/jq/download/"
}

api() {
  local method="$1"
  local path="$2"
  shift 2
  curl -s -w '\n%{http_code}' \
    -X "$method" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    "$@" \
    "${API_URL}${path}"
}

parse_response() {
  local response="$1"
  local body http_code
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
    green "Success ($http_code)"
    echo "$body" | jq . 2>/dev/null || echo "$body"
    return 0
  else
    red "Failed ($http_code)"
    echo "$body" | jq . 2>/dev/null || echo "$body"
    return 1
  fi
}

# ── Commands ──────────────────────────────────────────────────────────

cmd_register() {
  require_env
  require_jq

  local project_yml="$ROOT_DIR/$DOCS_DIR/project.yml"
  [ -f "$project_yml" ] || die "project.yml not found at $project_yml"

  # Parse fields from project.yml
  local slug title description access_mode
  slug=$(grep '^slug:' "$project_yml" | head -1 | sed 's/^slug:[[:space:]]*//' | tr -d '"')
  title=$(grep '^title:' "$project_yml" | head -1 | sed 's/^title:[[:space:]]*//' | tr -d '"')
  description=$(grep '^description:' "$project_yml" | head -1 | sed 's/^description:[[:space:]]*//' | tr -d '"')
  access_mode=$(grep '^access_mode:' "$project_yml" | head -1 | sed 's/^access_mode:[[:space:]]*//' | tr -d '"')

  [ -n "$slug" ]        || die "slug not found in project.yml"
  [ -n "$title" ]       || die "title not found in project.yml"
  [ -n "$access_mode" ] || die "access_mode not found in project.yml"

  echo "Registering project: $slug"

  local response
  response=$(api POST /projects -d "$(jq -n \
    --arg slug "$slug" \
    --arg repo_url "https://github.com/local/$slug" \
    --arg title "$title" \
    --arg description "${description:-}" \
    --arg access_mode "$access_mode" \
    '{slug: $slug, repo_url: $repo_url, title: $title, description: $description, access_mode: $access_mode}'
  )")

  if parse_response "$response"; then
    local new_id
    new_id=$(echo "$response" | sed '$d' | jq -r '.id // empty')
    if [ -n "$new_id" ]; then
      echo ""
      yellow "Project ID: $new_id"
      yellow "Add this to your .env file:"
      echo "  NRDOCS_PROJECT_ID=$new_id"
    fi
  fi
}

cmd_approve() {
  require_env
  require_project_id

  echo "Approving project: $PROJECT_ID"
  local response
  response=$(api POST "/projects/$PROJECT_ID/approve")
  parse_response "$response"
}

cmd_init() {
  require_env
  require_jq

  echo "=== Registering project ==="
  cmd_register

  if [ -z "$PROJECT_ID" ]; then
    echo ""
    yellow "Set NRDOCS_PROJECT_ID in .env with the ID above, then run:"
    echo "  ./scripts/nrdocs.sh approve"
    return
  fi

  echo ""
  echo "=== Approving project ==="
  cmd_approve
}

cmd_publish() {
  require_env
  require_project_id
  require_jq

  local docs_path="$ROOT_DIR/$DOCS_DIR"
  [ -d "$docs_path" ] || die "Docs directory not found: $docs_path"
  [ -f "$docs_path/project.yml" ] || die "project.yml not found in $docs_path"
  [ -f "$docs_path/nav.yml" ]     || die "nav.yml not found in $docs_path"
  [ -d "$docs_path/content" ]     || die "content/ directory not found in $docs_path"

  echo "Building payload from $docs_path ..."

  local project_yml nav_yml allowed_list_yml pages_json slug

  slug=$(grep '^slug:' "$docs_path/project.yml" | head -1 | sed 's/^slug:[[:space:]]*//' | tr -d '"')
  project_yml=$(jq -Rs '.' < "$docs_path/project.yml")
  nav_yml=$(jq -Rs '.' < "$docs_path/nav.yml")

  if [ -f "$docs_path/allowed-list.yml" ]; then
    allowed_list_yml=$(jq -Rs '.' < "$docs_path/allowed-list.yml")
  else
    allowed_list_yml="null"
  fi

  pages_json=$(jq -n '{}')
  local count=0
  while IFS= read -r -d '' file; do
    local relative key page_content
    relative="${file#"$docs_path/content/"}"
    key="${relative%.md}"
    page_content=$(jq -Rs '.' < "$file")
    pages_json=$(echo "$pages_json" | jq --arg k "$key" --argjson v "$page_content" '. + {($k): $v}')
    count=$((count + 1))
  done < <(find "$docs_path/content" -name '*.md' -type f -print0 | sort -z)

  echo "Found $count page(s)"

  local payload
  payload=$(jq -n \
    --argjson project_yml "$project_yml" \
    --argjson nav_yml "$nav_yml" \
    --argjson allowed_list_yml "$allowed_list_yml" \
    --argjson pages "$pages_json" \
    '{repo_content: {project_yml: $project_yml, nav_yml: $nav_yml, allowed_list_yml: $allowed_list_yml, pages: $pages}}')

  echo "Publishing to $API_URL/projects/$PROJECT_ID/publish ..."

  local response
  response=$(api POST "/projects/$PROJECT_ID/publish" -d "$payload")
  if parse_response "$response"; then
    # Print the live URL if NRDOCS_SITE_URL is configured
    if [ -n "$SITE_URL" ]; then
      echo ""
      green "Published to: ${SITE_URL}/${slug}/"
    fi
  fi
}

cmd_disable() {
  require_env
  require_project_id

  echo "Disabling project: $PROJECT_ID"
  local response
  response=$(api POST "/projects/$PROJECT_ID/disable")
  parse_response "$response"
}

cmd_delete() {
  require_env
  require_project_id

  read -rp "Are you sure you want to delete project $PROJECT_ID? This removes all data. [y/N] " confirm
  if [[ "$confirm" != [yY] ]]; then
    echo "Cancelled."
    return
  fi

  echo "Deleting project: $PROJECT_ID"
  local response
  response=$(api DELETE "/projects/$PROJECT_ID")
  parse_response "$response"
}

cmd_status() {
  require_env
  require_project_id

  echo "Fetching project: $PROJECT_ID"
  local response
  response=$(api GET "/projects/$PROJECT_ID")
  parse_response "$response"
}

cmd_set_password() {
  require_env
  require_project_id

  read -rsp "Enter password for project $PROJECT_ID: " password
  echo ""

  if [ -z "$password" ]; then
    die "Password cannot be empty"
  fi

  echo "Setting password..."
  local response
  response=$(api POST "/projects/$PROJECT_ID/password" -d "$(jq -n --arg pw "$password" '{password: $pw}')")
  parse_response "$response"
}

cmd_help() {
  cat <<'EOF'
nrdocs CLI — local management tool

Usage:
  ./scripts/nrdocs.sh <command>

Commands:
  init          Register a new project and approve it (two-step shortcut)
  register      Register a new project (starts in awaiting_approval)
  approve       Approve a registered project for publishing
  publish       Build docs from local directory and publish to Control Plane
  set-password  Set or update the password for a password-protected project
  disable       Disable a project (returns 404, preserves data)
  delete        Delete a project and all associated data
  status        Show project details from the Control Plane
  help          Show this help message

Configuration:
  Copy .env.example to .env and fill in:
    NRDOCS_API_URL       Control Plane Worker URL
    NRDOCS_API_KEY       Your admin API key
    NRDOCS_PROJECT_ID    Project UUID (set after register)
    NRDOCS_DOCS_DIR      Docs directory (default: docs)

Examples:
  # First time setup
  cp .env.example .env
  # Edit .env with your API_URL and API_KEY
  ./scripts/nrdocs.sh register
  # Copy the project ID into .env
  ./scripts/nrdocs.sh approve
  ./scripts/nrdocs.sh publish

  # Or do register + approve in one step
  ./scripts/nrdocs.sh init
EOF
}

# ── Main ──────────────────────────────────────────────────────────────

COMMAND="${1:-help}"

case "$COMMAND" in
  init)         cmd_init ;;
  register)     cmd_register ;;
  approve)      cmd_approve ;;
  publish)      cmd_publish ;;
  set-password) cmd_set_password ;;
  disable)      cmd_disable ;;
  delete)       cmd_delete ;;
  status)       cmd_status ;;
  help)         cmd_help ;;
  *)            die "Unknown command: $COMMAND. Run './scripts/nrdocs.sh help' for usage." ;;
esac
