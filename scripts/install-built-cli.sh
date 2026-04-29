#!/usr/bin/env bash
# Install the locally built CLI to the same path that `nrdocs` resolves to,
# or to ~/.local/bin/nrdocs if it is not installed yet.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT/dist-cli/nrdocs.cjs"

if [ ! -f "$BIN" ]; then
  echo "Built CLI not found: $BIN" >&2
  echo "Run: npm run build:cli" >&2
  exit 1
fi

TARGET="$(command -v nrdocs || true)"
if [ -z "$TARGET" ]; then
  TARGET="$HOME/.local/bin/nrdocs"
fi

mkdir -p "$(dirname "$TARGET")"
cp "$BIN" "$TARGET"
chmod +x "$TARGET"

echo "Installed nrdocs to: $TARGET"
echo "Verify:"
echo "  hash -r  # bash only; harmless if not needed"
echo "  command -v nrdocs"
echo "  nrdocs admin quick-guide"
