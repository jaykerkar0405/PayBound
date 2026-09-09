#!/usr/bin/env bash
# Reproduces app-hedera.elf from source, per README.md's "What's checked in
# here" section. Requires docker and network access.
set -euo pipefail

commit="6c2add31229656f369a9f20bd28388e679f761a1"
builder_image="ghcr.io/ledgerhq/ledger-app-builder/ledger-app-builder@sha256:17a1b9019562808a950755939b088b54312d4bd068bcb4b15cb1cbf89448f818"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

git clone https://github.com/LedgerHQ/app-hedera.git "$work_dir/app-hedera"
git -C "$work_dir/app-hedera" checkout "$commit"

docker run --rm -v "$work_dir/app-hedera":/app \
  -e PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python \
  -e BOLOS_SDK=/opt/nanox-secure-sdk \
  "$builder_image" \
  make

cp "$work_dir/app-hedera/bin/app.elf" "$script_dir/../app-hedera.elf"
sha256sum "$script_dir/../app-hedera.elf"
