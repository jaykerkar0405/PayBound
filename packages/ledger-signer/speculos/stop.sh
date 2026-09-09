#!/usr/bin/env bash
# packages/ledger-signer/speculos/stop.sh
#
# Stops the Speculos Docker container started by start.sh --detach.
#
# Usage:
#   ./stop.sh

set -euo pipefail

CONTAINER_NAME="paybound-speculos"

if docker ps -q --filter "name=$CONTAINER_NAME" | grep -q .; then
  echo "Stopping Speculos container ($CONTAINER_NAME)..."
  docker stop "$CONTAINER_NAME"
  echo "Done."
else
  echo "No running Speculos container named '$CONTAINER_NAME' found."
fi
