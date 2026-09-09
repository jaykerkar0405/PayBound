#!/usr/bin/env bash
# packages/ledger-signer/speculos/start.sh
#
# Starts the Speculos Ledger emulator via Docker.
#
# Usage:
#   ./start.sh            # interactive (foreground, Ctrl-C to stop)
#   ./start.sh --detach   # detached background container (run stop.sh to stop)
#
# The original invocation used `docker run -it`, which fails in non-interactive
# contexts ("cannot attach stdin to a TTY-enabled container because stdin is
# not a terminal"). This script selects the right flags based on the --detach
# argument so it works both for human-attended and scripted/demo runs.
#
# Environment variables (all optional, with defaults):
#   SPECULOS_APDU_PORT   — port for APDU transport  (default: 9999)
#   SPECULOS_HTTP_PORT   — port for HTTP button API  (default: 5000)
#   SPECULOS_APP_PATH    — path to the compiled .elf app to load
#                          (default: ./app/app.elf relative to this script)
#   SPECULOS_SEED        — BIP-39 mnemonic for the emulated device
#                          (default: test only mnemonic — do NOT use in production)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APDU_PORT="${SPECULOS_APDU_PORT:-9999}"
HTTP_PORT="${SPECULOS_HTTP_PORT:-5000}"
APP_PATH="${SPECULOS_APP_PATH:-$SCRIPT_DIR/app/app.elf}"
SEED="${SPECULOS_SEED:-test test test test test test test test test test test junk}"
CONTAINER_NAME="paybound-speculos"
IMAGE="ghcr.io/ledgerhq/speculos:latest"

DETACH=false
if [[ "${1:-}" == "--detach" ]]; then
  DETACH=true
fi

if [[ ! -f "$APP_PATH" ]]; then
  echo "ERROR: Speculos app binary not found at: $APP_PATH"
  echo "Build the Ledger app first, or set SPECULOS_APP_PATH to its location."
  exit 1
fi

# Remove any stale container with the same name
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

if [[ "$DETACH" == "true" ]]; then
  echo "Starting Speculos in detached mode (container: $CONTAINER_NAME)..."
  CONTAINER_ID=$(docker run -d \
    --name "$CONTAINER_NAME" \
    -p "$APDU_PORT:9999" \
    -p "$HTTP_PORT:5000" \
    -v "$APP_PATH:/app/app.elf:ro" \
    -e SPECULOS_SEED="$SEED" \
    "$IMAGE" \
    --apdu-port 9999 \
    --api-port 5000 \
    --seed "$SEED" \
    /app/app.elf)

  echo "Speculos started: container ID $CONTAINER_ID"
  echo "  APDU port : $APDU_PORT"
  echo "  HTTP port : $HTTP_PORT"
  echo "  Run ./stop.sh to stop."
else
  echo "Starting Speculos in interactive mode (Ctrl-C to stop)..."
  echo "  APDU port : $APDU_PORT"
  echo "  HTTP port : $HTTP_PORT"
  # -it only in interactive mode — works when stdin is a terminal
  docker run --rm -it \
    --name "$CONTAINER_NAME" \
    -p "$APDU_PORT:9999" \
    -p "$HTTP_PORT:5000" \
    -v "$APP_PATH:/app/app.elf:ro" \
    -e SPECULOS_SEED="$SEED" \
    "$IMAGE" \
    --apdu-port 9999 \
    --api-port 5000 \
    --seed "$SEED" \
    /app/app.elf
fi
