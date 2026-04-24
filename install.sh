#!/bin/sh
# NRDocs CLI installer script
# Downloads and installs the nrdocs CLI binary from GitHub Releases.
# Usage: sh install.sh [--install-dir <path>] [--system] [--version <version>]

set -e

REPO_URL="https://github.com/nrdocs/nrdocs/releases"
BINARY_NAME="nrdocs"

# --- Helpers ---

err() {
  echo "Error: $1" >&2
  exit 1
}

# --- OS detection ---

OS="$(uname -s)"
if [ "$OS" != "Linux" ]; then
  err "nrdocs only supports Linux. Detected: $OS"
fi

# --- Architecture detection ---

RAW_ARCH="$(uname -m)"
case "$RAW_ARCH" in
  x86_64)  ARCH="x64" ;;
  aarch64) ARCH="arm64" ;;
  *)       err "Unsupported architecture: $RAW_ARCH. Supported: x86_64 (x64), aarch64 (arm64). Download manually: $REPO_URL" ;;
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
    *)
      err "Unknown flag: $1"
      ;;
  esac
done

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

ARTIFACT="nrdocs-linux-${ARCH}"

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

echo "Downloading nrdocs ${VERSION} for linux-${ARCH}..."

if ! download "$BINARY_URL" "${TMP_DIR}/${ARTIFACT}"; then
  err "Failed to download nrdocs binary from ${BINARY_URL}"
fi

# --- Download and verify checksum ---

if ! download "$CHECKSUM_URL" "${TMP_DIR}/${ARTIFACT}.sha256"; then
  err "Failed to download checksum file from ${CHECKSUM_URL}"
fi

cd "$TMP_DIR"
if ! sha256sum --check "${ARTIFACT}.sha256" >/dev/null 2>&1; then
  err "Checksum verification failed. The downloaded binary may be corrupted."
fi
cd - >/dev/null

# --- Install binary ---

mkdir -p "$TARGET_DIR" || err "Cannot write to ${TARGET_DIR}. Check permissions or use --install-dir."

if ! cp "${TMP_DIR}/${ARTIFACT}" "${TARGET_DIR}/${BINARY_NAME}"; then
  err "Cannot write to ${TARGET_DIR}. Check permissions or use --install-dir."
fi

chmod +x "${TARGET_DIR}/${BINARY_NAME}"

echo "nrdocs installed to ${TARGET_DIR}/${BINARY_NAME}"

# --- PATH advisory ---

case ":${PATH}:" in
  *":${TARGET_DIR}:"*) ;;
  *)
    echo ""
    echo "NOTE: ${TARGET_DIR} is not in your PATH."
    echo "Add it by running:"
    echo ""
    echo "  export PATH=\"${TARGET_DIR}:\$PATH\""
    echo ""
    echo "To make this permanent, add the line above to your shell profile."
    ;;
esac
