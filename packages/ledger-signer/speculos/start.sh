#!/usr/bin/env bash
# Starts Speculos running app-hedera.elf on the ports apps/broker/src/config.ts
# defaults to (LEDGER_SPECULOS_HOST=127.0.0.1, LEDGER_SPECULOS_PORT=9999).
# See README.md in this directory for what this is and why.
#
# Usage:
#   ./start.sh            # interactive (foreground, Ctrl-C to stop) — requires a real terminal
#   ./start.sh --detach   # detached background container (run stop.sh to stop)
#
# The original `docker run -it` invocation fails in non-interactive/scripted
# contexts ("cannot attach stdin to a TTY-enabled container because stdin is
# not a terminal"). Pass --detach for those contexts.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DETACH=false
if [[ "${1:-}" == "--detach" ]]; then
  DETACH=true
fi

CONTAINER_NAME="paybound-speculos"
IMAGE="ghcr.io/ledgerhq/speculos@sha256:6ed9eefd51cddd862b746719af4cd7a3265fe43d0588c388359753cab8d46d11"
SEED="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

# Remove any stale container with the same name
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

if [[ "$DETACH" == "true" ]]; then
  echo "Starting Speculos in detached mode (container: $CONTAINER_NAME)..."
  CONTAINER_ID=$(docker run -d \
    --name "$CONTAINER_NAME" \
    -p 9999:9999 -p 5000:5000 \
    -v "$script_dir":/speculos/local \
    "$IMAGE" \
    --model nanox --display headless \
    --apdu-port 9999 --api-port 5000 \
    --seed "$SEED" \
    /speculos/local/app-hedera.elf)
  echo "Speculos started: container ID $CONTAINER_ID"
  echo "  APDU port : 9999"
  echo "  HTTP port : 5000"
  echo "  Run ./stop.sh to stop."
else
  echo "Starting Speculos in interactive mode (Ctrl-C to stop)..."
  # -it only in interactive mode — works when stdin is a terminal
  exec docker run --rm -it \
    --name "$CONTAINER_NAME" \
    -p 9999:9999 -p 5000:5000 \
    -v "$script_dir":/speculos/local \
    "$IMAGE" \
    --model nanox --display headless \
    --apdu-port 9999 --api-port 5000 \
    --seed "$SEED" \
    /speculos/local/app-hedera.elf
fi
