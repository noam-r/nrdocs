#!/usr/bin/env bash
# Native binaries via Bun (optional). For a Node-only bundle from the repo, use: npm run build:cli
set -euo pipefail

VERSION="${1:?Usage: build.sh <version>}"

bun build cli/src/main.ts \
  --compile \
  --target=bun-linux-x64 \
  --define "CLI_VERSION='${VERSION}'" \
  --outfile nrdocs-linux-x64

bun build cli/src/main.ts \
  --compile \
  --target=bun-linux-arm64 \
  --define "CLI_VERSION='${VERSION}'" \
  --outfile nrdocs-linux-arm64

sha256sum nrdocs-linux-x64 > nrdocs-linux-x64.sha256
sha256sum nrdocs-linux-arm64 > nrdocs-linux-arm64.sha256
