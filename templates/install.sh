#!/bin/sh
# Rendered by rust-binary-publish at release time. Placeholders (__REPO__ etc.)
# are substituted with the consuming project's values before upload.
set -eu

REPO="__REPO__"
INSTALL_DIR="${__ENV_PREFIX___INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${1:-latest}"

case "$(uname -s)" in
  Linux*)  os="unknown-linux-musl" ;;
  Darwin*) os="apple-darwin" ;;
  *) echo "__NAME__: unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64)  arch="x86_64" ;;
  aarch64|arm64) arch="aarch64" ;;
  *) echo "__NAME__: unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

target="${arch}-${os}"
archive="__PREFIX__-${target}.tar.xz"

if [ "$VERSION" = "latest" ]; then
  url="https://github.com/${REPO}/releases/latest/download/${archive}"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/${archive}"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading $archive..."
curl -fsSL "$url" -o "$tmp/$archive"
tar -xJf "$tmp/$archive" -C "$tmp"

mkdir -p "$INSTALL_DIR"
mv "$tmp/__PREFIX__-${target}/__BIN__" "$INSTALL_DIR/__BIN__"
chmod +x "$INSTALL_DIR/__BIN__"

echo "Installed __BIN__ to $INSTALL_DIR/__BIN__"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo
    echo "Add $INSTALL_DIR to your PATH:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac
