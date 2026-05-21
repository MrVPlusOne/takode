#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <tool> [args...]" >&2
  exit 1
fi

TOOL="$1"
shift
ARGS_DISPLAY="${*:+ $*}"

BUN_BIN="${npm_execpath:-${HOME}/.bun/bin/bun}"
if [ ! -x "$BUN_BIN" ]; then
  echo "bun executable not found (npm_execpath and \$HOME/.bun/bin/bun unavailable)" >&2
  exit 1
fi

TOOL_PATH="./node_modules/.bin/${TOOL}"
if [ ! -x "$TOOL_PATH" ]; then
  if [ "${TAKODE_AUTO_INSTALL:-}" != "1" ]; then
    cat >&2 <<EOF
Required local tool is missing: $TOOL_PATH

Run from web/ first:
  bun install --frozen-lockfile

Or rerun with explicit frozen auto-install:
  TAKODE_AUTO_INSTALL=1 $0 $TOOL$ARGS_DISPLAY
EOF
    exit 1
  fi
  "$BUN_BIN" install --frozen-lockfile
fi

exec "$BUN_BIN" --no-install --bun "$TOOL_PATH" "$@"
