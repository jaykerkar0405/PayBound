#!/usr/bin/env bash
# Starts Speculos running app-hedera.elf on the ports apps/broker/src/config.ts
# defaults to (LEDGER_SPECULOS_HOST=127.0.0.1, LEDGER_SPECULOS_PORT=9999).
# See README.md in this directory for what this is and why.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec docker run --rm -it \
  -p 9999:9999 -p 5000:5000 \
  -v "$script_dir":/speculos/local \
  ghcr.io/ledgerhq/speculos@sha256:6ed9eefd51cddd862b746719af4cd7a3265fe43d0588c388359753cab8d46d11 \
  --model nanox --display headless \
  --apdu-port 9999 --api-port 5000 \
  --seed "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" \
  /speculos/local/app-hedera.elf
