#!/usr/bin/env bash
# Bundle the standalone nrdocs CLI into a single executable Node script (no GitHub Release required).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
mkdir -p dist-cli

# Embed version at bundle start so `nrdocs` shows it even when not run from the git repo.
npx esbuild cli/src/main.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=cjs \
  --outfile=dist-cli/nrdocs.cjs \
  --banner:js="#!/usr/bin/env node
globalThis.__NRDOCS_CLI_VERSION__ = \"${VERSION}\";"

chmod +x dist-cli/nrdocs.cjs
echo "Built dist-cli/nrdocs.cjs (version ${VERSION})"
echo "Try: ./dist-cli/nrdocs.cjs --help"
echo ""
echo "Install into your user bin (example):"
echo "  mkdir -p \"\$HOME/.local/bin\""
echo "  cp dist-cli/nrdocs.cjs \"\$HOME/.local/bin/nrdocs\" && chmod +x \"\$HOME/.local/bin/nrdocs\""
echo "  command -v nrdocs    # must print .../.local/bin/nrdocs"
echo ""
echo "Or build and install to the current nrdocs path in one step:"
echo "  npm run install:cli:local"
echo ""
echo "If 'nrdocs' fails with a path under /usr/local/bin (No such file or directory):"
echo "  Bash remembers the old location — run:  hash -r"
echo "  zsh:  rehash"
echo "  Or remove a stale binary:  sudo rm -f /usr/local/bin/nrdocs"
echo "  Then:  command -v nrdocs && nrdocs"
