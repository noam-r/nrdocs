#!/usr/bin/env bash
# Thin launcher: same entrypoint as the installed `nrdocs` binary (unified CLI).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN="$ROOT_DIR/dist-cli/nrdocs.cjs"
TSX="$ROOT_DIR/node_modules/.bin/tsx"

if [[ -f "$BIN" ]]; then
  exec node "$BIN" "$@"
fi
if [[ -x "$TSX" ]]; then
  exec "$TSX" "$ROOT_DIR/cli/src/main.ts" "$@"
fi

echo "nrdocs: install dependencies (npm install) or build the CLI (npm run build:cli)." >&2
exit 1
