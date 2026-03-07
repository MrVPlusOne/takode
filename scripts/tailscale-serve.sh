#!/usr/bin/env bash
# tailscale-serve.sh — Expose Companion (Takode) over Tailscale HTTPS.
#
# Usage:
#   ./scripts/tailscale-serve.sh prod             # HTTPS :443  -> localhost:3456
#   ./scripts/tailscale-serve.sh dev              # HTTPS :443  -> localhost:5174
#   ./scripts/tailscale-serve.sh both             # HTTPS :443  -> prod, :8443 -> dev
#   ./scripts/tailscale-serve.sh status           # Show current tailscale serve config
#   ./scripts/tailscale-serve.sh stop             # Remove all tailscale serve rules
#   ./scripts/tailscale-serve.sh --dry-run both   # Print commands without changing serve config
#
# Why "both" uses a second HTTPS port instead of /dev:
#   The current app is not path-prefix safe. It assumes root-relative asset,
#   API, and WebSocket paths:
#   - web/index.html loads /src/main.tsx in dev and /assets/... in prod
#   - web/src/api.ts uses /api
#   - web/src/ws-transport.ts and web/src/terminal-ws.ts use /ws/...
#   - web/vite.config.ts proxies /api and /ws at the root
#   Serving dev at https://<host>/dev would therefore leak requests back to
#   https://<host>/api and https://<host>/ws instead of /dev/api and /dev/ws,
#   and Vite asset/HMR URLs would also stay rooted at /.
#
# Prerequisites:
#   - Tailscale installed and logged in (`tailscale status`)
#   - Serve enabled for this node
#   - jq installed (used to print the full *.ts.net hostname)
#   - The relevant local servers already running
#
# Notes:
#   - Both URLs stay on the same trusted *.ts.net hostname.
#   - Browsers include the port in location.host, so the frontend keeps using
#     the correct /api and /ws origin on both prod and dev.
#   - Tailscale's current docs recommend proxying to explicit
#     http://127.0.0.1:<port> targets rather than localhost aliases.

set -euo pipefail

PROD_PORT="${COMPANION_PORT:-3456}"
DEV_PORT="${COMPANION_DEV_PORT:-5174}"
PROD_HTTPS_PORT="${COMPANION_TAILSCALE_PROD_HTTPS_PORT:-443}"
DEV_HTTPS_PORT="${COMPANION_TAILSCALE_DEV_HTTPS_PORT:-8443}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    *)
      break
      ;;
  esac
done

COMMAND="${1:-help}"

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[dry-run]'
    for arg in "$@"; do
      printf ' %q' "$arg"
    done
    printf '\n'
    return 0
  fi
  "$@"
}

fqdn() {
  tailscale status --json 2>/dev/null | jq -r '.Self.DNSName' | sed 's/\.$//'
}

is_port_listening() {
  local port="$1"
  if command -v lsof &>/dev/null; then
    lsof -iTCP:"${port}" -sTCP:LISTEN -t &>/dev/null
    return
  fi
  if command -v ss &>/dev/null; then
    ss -ltn "( sport = :${port} )" | tail -n +2 | grep -q .
    return
  fi
  return 2
}

warn_if_port_missing() {
  local port="$1"
  local label="$2"
  if ! is_port_listening "$port"; then
    if [[ $? -eq 2 ]]; then
      echo "Warning: skipping local port probe for $label (neither lsof nor ss is installed)." >&2
      return
    fi
    echo "Warning: $label target is not listening on localhost:$port yet." >&2
  fi
}

serve_reset() {
  run sudo tailscale serve reset
}

preflight() {
  if ! command -v tailscale &>/dev/null; then
    echo "Error: tailscale not found on PATH" >&2
    exit 1
  fi
  if ! tailscale status &>/dev/null; then
    echo "Error: tailscale is not connected. Run: sudo tailscale up" >&2
    exit 1
  fi
  if ! command -v jq &>/dev/null; then
    echo "Error: jq not found (needed for FQDN lookup)" >&2
    exit 1
  fi
}

serve_proxy() {
  local https_port="$1"
  local target_port="$2"
  run sudo tailscale serve --bg --https="${https_port}" "http://127.0.0.1:${target_port}"
}

print_single_summary() {
  local host="$1"
  local mode="$2"
  local https_port="$3"
  local target_port="$4"
  local url
  if [[ "$https_port" == "443" ]]; then
    url="https://${host}"
  else
    url="https://${host}:${https_port}"
  fi

  echo ""
  echo "Tailscale HTTPS (${mode}) is live:"
  echo "  ${url}"
  echo ""
  echo "Proxying HTTPS :${https_port} -> http://127.0.0.1:${target_port}"
}

print_both_summary() {
  local host="$1"
  echo ""
  echo "Tailscale HTTPS (prod + dev) is live on the same hostname:"
  echo "  Prod: https://${host}"
  echo "  Dev:  https://${host}:${DEV_HTTPS_PORT}"
  echo ""
  echo "Proxying:"
  echo "  HTTPS :${PROD_HTTPS_PORT} -> http://127.0.0.1:${PROD_PORT}"
  echo "  HTTPS :${DEV_HTTPS_PORT} -> http://127.0.0.1:${DEV_PORT}"
}

serve_start_single() {
  local target_port="$1"
  local mode="$2"
  local https_port="$3"

  preflight
  local host
  host=$(fqdn)

  warn_if_port_missing "$target_port" "$mode"
  serve_reset
  serve_proxy "$https_port" "$target_port"
  print_single_summary "$host" "$mode" "$https_port" "$target_port"

  echo ""
  if [[ "$mode" == "dev" ]]; then
    echo "Make sure the dev server is running:"
    echo "  cd ~/companion && ./scripts/dev-start.sh"
  else
    echo "Make sure the production server is running:"
    echo "  cd ~/companion/web && bun run serve"
  fi
}

serve_start_both() {
  preflight
  local host
  host=$(fqdn)

  warn_if_port_missing "$PROD_PORT" "prod"
  warn_if_port_missing "$DEV_PORT" "dev"
  serve_reset
  serve_proxy "$PROD_HTTPS_PORT" "$PROD_PORT"
  serve_proxy "$DEV_HTTPS_PORT" "$DEV_PORT"
  print_both_summary "$host"

  echo ""
  echo "Make sure both local servers are running:"
  echo "  Prod: cd ~/companion/web && bun run serve"
  echo "  Dev:  cd ~/companion && ./scripts/dev-start.sh"
}

case "$COMMAND" in
  prod)
    serve_start_single "$PROD_PORT" "prod" "$PROD_HTTPS_PORT"
    ;;
  dev)
    serve_start_single "$DEV_PORT" "dev" "$PROD_HTTPS_PORT"
    ;;
  both)
    serve_start_both
    ;;
  status)
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "[dry-run] tailscale serve status"
    else
      tailscale serve status
    fi
    ;;
  stop)
    preflight
    serve_reset
    echo "Tailscale serve stopped."
    ;;
  *)
    echo "Usage: $0 [--dry-run] {prod|dev|both|status|stop}"
    echo ""
    echo "  prod    Proxy HTTPS :${PROD_HTTPS_PORT} -> localhost:${PROD_PORT} (production server)"
    echo "  dev     Proxy HTTPS :${PROD_HTTPS_PORT} -> localhost:${DEV_PORT} (dev server only)"
    echo "  both    Proxy prod on :${PROD_HTTPS_PORT} and dev on :${DEV_HTTPS_PORT} using the same ts.net hostname"
    echo "  status  Show current serve configuration"
    echo "  stop    Remove all serve rules"
    echo ""
    echo "Environment overrides:"
    echo "  COMPANION_PORT=${PROD_PORT}"
    echo "  COMPANION_DEV_PORT=${DEV_PORT}"
    echo "  COMPANION_TAILSCALE_PROD_HTTPS_PORT=${PROD_HTTPS_PORT}"
    echo "  COMPANION_TAILSCALE_DEV_HTTPS_PORT=${DEV_HTTPS_PORT}"
    exit 1
    ;;
esac
