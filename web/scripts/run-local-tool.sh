#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <tool> [args...]" >&2
  exit 1
fi

TOOL="$1"
shift

BUN_BIN="${npm_execpath:-${HOME}/.bun/bin/bun}"
if [ ! -x "$BUN_BIN" ]; then
  echo "bun executable not found (npm_execpath and \$HOME/.bun/bin/bun unavailable)" >&2
  exit 1
fi

TOOL_PATH="./node_modules/.bin/${TOOL}"
if [ ! -x "$TOOL_PATH" ]; then
  "$BUN_BIN" install
fi

exec "$BUN_BIN" --bun "$TOOL_PATH" "$@"
