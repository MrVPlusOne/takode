#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_JSON="$ROOT_DIR/package.json"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to read extension metadata" >&2
  exit 1
fi

NAME="$(node -p "require(process.argv[1]).name" "$PACKAGE_JSON")"
PUBLISHER="$(node -p "require(process.argv[1]).publisher" "$PACKAGE_JSON")"
VERSION="$(node -p "require(process.argv[1]).version" "$PACKAGE_JSON")"
EXTENSION_ID="${PUBLISHER}.${NAME}-${VERSION}"

TARGET_KIND="${1:-auto}"
case "$TARGET_KIND" in
  auto)
    for dir in "$HOME/.vscode/extensions" "$HOME/.cursor/extensions" "$HOME/.vscode-oss/extensions" "$HOME/.windsurf/extensions"; do
      if [[ -d "$dir" ]]; then
        TARGET_DIR="$dir"
        break
      fi
    done
    TARGET_DIR="${TARGET_DIR:-$HOME/.vscode/extensions}"
    ;;
  vscode)
    TARGET_DIR="$HOME/.vscode/extensions"
    ;;
  cursor)
    TARGET_DIR="$HOME/.cursor/extensions"
    ;;
  vscodium|code-oss)
    TARGET_DIR="$HOME/.vscode-oss/extensions"
    ;;
  windsurf)
    TARGET_DIR="$HOME/.windsurf/extensions"
    ;;
  *)
    echo "usage: $0 [auto|vscode|cursor|vscodium|code-oss|windsurf]" >&2
    exit 1
    ;;
esac

mkdir -p "$TARGET_DIR"
LINK_PATH="$TARGET_DIR/$EXTENSION_ID"
rm -rf "$LINK_PATH"
ln -s "$ROOT_DIR" "$LINK_PATH"

cat <<EOF
Installed Takode prototype as:
  $LINK_PATH

Next:
  1. Restart or reload your editor window
  2. Run "Takode: Open Panel" from the command palette

If you want a different editor family:
  $0 vscode
  $0 cursor
  $0 vscodium
  $0 windsurf
EOF
