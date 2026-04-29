#!/bin/sh
# NRDocs CLI installer script
# Downloads and installs the nrdocs CLI binary from GitHub Releases.
# Usage: sh install.sh [--install-dir <path>] [--system] [--version <tag>] [--repo owner/name]

set -e

BINARY_NAME="nrdocs"
# GitHub "owner/name" for releases (override with --repo or env NRDOCS_RELEASES_REPO)
REPO_SLUG=""

# --- Helpers ---

err() {
  echo "Error: $1" >&2
  exit 1
}

# --- OS detection ---

OS="$(uname -s)"
case "$OS" in
  Linux)   OS_TAG="linux" ;;
  Darwin)  OS_TAG="darwin" ;;
  *)       err "nrdocs only supports Linux and macOS. Detected: $OS" ;;
esac

# --- Architecture detection ---

RAW_ARCH="$(uname -m)"
case "$RAW_ARCH" in
  x86_64)  ARCH="x64" ;;
  aarch64) ARCH="arm64" ;;
  arm64)   ARCH="arm64" ;;
  *)       err "Unsupported architecture: $RAW_ARCH. Supported: x86_64 (x64), aarch64/arm64 (arm64). Download manually: $REPO_URL" ;;
esac

# --- Parse flags ---

INSTALL_DIR=""
SYSTEM_FLAG=0
VERSION="latest"

while [ $# -gt 0 ]; do
  case "$1" in
    --install-dir)
      if [ -z "${2:-}" ]; then
        err "--install-dir requires a path argument"
      fi
      INSTALL_DIR="$2"
      shift 2
      ;;
    --system)
      SYSTEM_FLAG=1
      shift
      ;;
    --version)
      if [ -z "${2:-}" ]; then
        err "--version requires a version argument"
      fi
      VERSION="$2"
      shift 2
      ;;
    --repo)
      if [ -z "${2:-}" ]; then
        err "--repo requires owner/name (example: myorg/nrdocs)"
      fi
      REPO_SLUG="$2"
      shift 2
      ;;
    *)
      err "Unknown flag: $1"
      ;;
  esac
done

# --- GitHub releases base URL ---

REPO_SLUG="${REPO_SLUG:-${NRDOCS_RELEASES_REPO:-nrdocs/nrdocs}}"
REPO_URL="https://github.com/${REPO_SLUG}/releases"

# --- Conflict check ---

if [ -n "$INSTALL_DIR" ] && [ "$SYSTEM_FLAG" -eq 1 ]; then
  err "Cannot use both --install-dir and --system"
fi

# --- Resolve install directory ---

if [ -n "$INSTALL_DIR" ]; then
  TARGET_DIR="$INSTALL_DIR"
elif [ "$SYSTEM_FLAG" -eq 1 ]; then
  TARGET_DIR="/usr/local/bin"
else
  TARGET_DIR="$HOME/.local/bin"
fi

# --- Resolve download URL ---

ARTIFACT="nrdocs-${OS_TAG}-${ARCH}"

if [ "$VERSION" = "latest" ]; then
  BASE_URL="${REPO_URL}/latest/download"
else
  BASE_URL="${REPO_URL}/download/${VERSION}"
fi

BINARY_URL="${BASE_URL}/${ARTIFACT}"
CHECKSUM_URL="${BASE_URL}/${ARTIFACT}.sha256"

# --- Detect download tool ---

DOWNLOAD_CMD=""
if command -v curl >/dev/null 2>&1; then
  DOWNLOAD_CMD="curl"
elif command -v wget >/dev/null 2>&1; then
  DOWNLOAD_CMD="wget"
else
  err "curl or wget is required but neither was found."
fi

download() {
  # $1 = URL, $2 = output file
  if [ "$DOWNLOAD_CMD" = "curl" ]; then
    curl -fsSL -o "$2" "$1"
  else
    wget -q -O "$2" "$1"
  fi
}

# --- Create temp directory ---

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# --- Download binary ---

echo "Downloading nrdocs ${VERSION} for ${OS_TAG}-${ARCH} from ${REPO_SLUG}..."

if ! download "$BINARY_URL" "${TMP_DIR}/${ARTIFACT}"; then
  echo "" >&2
  echo "Download failed (often HTTP 404): there is no usable file at:" >&2
  echo "  ${BINARY_URL}" >&2
  echo "" >&2
  echo "That means GitHub has no published Release for ${REPO_SLUG} with an asset" >&2
  echo "named exactly: ${ARTIFACT} (and usually ${ARTIFACT}.sha256)." >&2
  echo "" >&2
  echo "What you can do:" >&2
  echo "  1) Build the CLI from this repository (needs Node.js 20+):" >&2
  echo "       npm install && npm run build:cli" >&2
  echo "     Then install the script (pick one destination):" >&2
  echo "       sudo cp dist-cli/nrdocs.cjs /usr/local/bin/nrdocs" >&2
  echo "       cp dist-cli/nrdocs.cjs \"\$HOME/.local/bin/nrdocs\" && chmod +x \"\$HOME/.local/bin/nrdocs\"" >&2
  echo "  2) If your org publishes binaries under another fork, set:" >&2
  echo "       NRDOCS_RELEASES_REPO=owner/repo sh install.sh" >&2
  echo "     or:  sh install.sh --repo owner/repo ..." >&2
  echo "" >&2
  err "Release download failed."
fi

# --- Download and verify checksum ---

if ! download "$CHECKSUM_URL" "${TMP_DIR}/${ARTIFACT}.sha256"; then
  echo "" >&2
  echo "Warning: no checksum file at ${CHECKSUM_URL} — skipping sha256 verification." >&2
  SKIP_CHECKSUM=1
else
  SKIP_CHECKSUM=0
fi

if [ "${SKIP_CHECKSUM:-0}" -eq 0 ]; then
  cd "$TMP_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    if ! sha256sum --check "${ARTIFACT}.sha256" >/dev/null 2>&1; then
      err "Checksum verification failed. The downloaded binary may be corrupted."
    fi
  elif command -v shasum >/dev/null 2>&1; then
    if ! shasum -a 256 -c "${ARTIFACT}.sha256" >/dev/null 2>&1; then
      err "Checksum verification failed. The downloaded binary may be corrupted."
    fi
  else
    err "Neither sha256sum nor shasum was found; cannot verify the download."
  fi
  cd - >/dev/null
fi

# --- Install binary ---

mkdir -p "$TARGET_DIR" || err "Cannot write to ${TARGET_DIR}. Check permissions or use --install-dir."

if ! cp "${TMP_DIR}/${ARTIFACT}" "${TARGET_DIR}/${BINARY_NAME}"; then
  err "Cannot write to ${TARGET_DIR}. Check permissions or use --install-dir."
fi

chmod +x "${TARGET_DIR}/${BINARY_NAME}"

# Resolved path for PATH hints (no guessing which directory to add)
TARGET_ABS="$TARGET_DIR"
if cd "$TARGET_DIR" 2>/dev/null; then
  TARGET_ABS="$(pwd -P)"
  cd - >/dev/null
fi

echo "nrdocs installed to ${TARGET_ABS}/${BINARY_NAME}"

# --- PATH advisory ---

case ":${PATH}:" in
  *":${TARGET_DIR}:"*|*":${TARGET_ABS}:"*) ;;
  *)
    echo ""
    echo "NOTE: your terminal does not look in this folder yet:"
    echo "  ${TARGET_ABS}"
    echo ""
    echo "Easiest fix (one password prompt): run again with --system (installs into /usr/local/bin,"
    echo "  which most terminals already search):"
    echo "  sudo sh install.sh --system"
    echo ""
    echo "Or, for this terminal window only, paste and press Enter:"
    echo "  export PATH=\"${TARGET_ABS}:\$PATH\""
    echo ""
    echo "To fix it permanently without sudo, paste ONE line (pick macOS or Linux), Enter, then quit Terminal fully and reopen:"
    echo ""
    echo "  macOS Terminal (default):"
    echo "  echo 'export PATH=\"${TARGET_ABS}:\$PATH\"' >> \"\$HOME/.zshrc\" && . \"\$HOME/.zshrc\""
    echo ""
    echo "  Linux / WSL / Git Bash:"
    echo "  echo 'export PATH=\"${TARGET_ABS}:\$PATH\"' >> \"\$HOME/.bashrc\" && . \"\$HOME/.bashrc\""
    echo ""
    echo "Or run nrdocs by full path (no setup):"
    echo "  \"${TARGET_ABS}/nrdocs\" --help"
    echo ""
    echo "Full guide: docs/content/guides/onboarding-bootstrap.md (section Install the CLI)"
    ;;
esac
