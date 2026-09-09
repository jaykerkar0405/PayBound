# Speculos setup (task 3.2, issue 45)

This project has **no physical Ledger device**. `app-hedera.elf` in this
directory, run under [Speculos](https://github.com/LedgerHQ/speculos)
(Ledger's official device emulator), stands in for one — Speculos emulates
the actual device app and exposes the same APDU interface over TCP that a
real device exposes over USB/HID, and `@paybound/ledger-signer`'s
`apdu.ts`/`hid-framing.ts` logic is transport-agnostic at the protocol
layer (see `docs/LEDGER_HEDERA_RESEARCH.md`).

**This has never been run against real Ledger hardware.** `LEDGER_TRANSPORT=hid`
(the real-USB path, `packages/ledger-signer/src/device.ts`'s `openLedgerDevice`)
is implemented and unit-tested against its own failure path, but not
verified end to end against a real device — that remains a documented,
untested future option.

## What's checked in here

`app-hedera.elf` — a build of
[`LedgerHQ/app-hedera`](https://github.com/LedgerHQ/app-hedera), commit
[`6c2add31229656f369a9f20bd28388e679f761a1`](https://github.com/LedgerHQ/app-hedera/commit/6c2add31229656f369a9f20bd28388e679f761a1)
(the same commit `docs/LEDGER_HEDERA_RESEARCH.md` cites), for the **Nano X**
target (`BOLOS_SDK=/opt/nanox-secure-sdk`), app version `1.9.1`.

```
sha256sum app-hedera.elf
03ab50dbc94556c57b5146d1615a82b0ef2de5d99c79e2e4c8dcdd1f8269a41a  app-hedera.elf
```

Built with:

```
docker run --rm -v "$PWD":/app \
  -e PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python \
  -e BOLOS_SDK=/opt/nanox-secure-sdk \
  ghcr.io/ledgerhq/ledger-app-builder/ledger-app-builder@sha256:17a1b9019562808a950755939b088b54312d4bd068bcb4b15cb1cbf89448f818 \
  make
```
(`bin/app.elf` is the output, copied here as `app-hedera.elf`.)

A compiled binary is committed rather than rebuilt on every `pnpm test` run
because building it needs network access to clone `LedgerHQ/app-hedera` and
pull a ~5GB builder image, and takes several minutes — too slow/fragile for
routine local test runs. `scripts/rebuild.sh` in this directory reproduces
it from scratch (clones the exact commit above and runs the same `docker
run` command) for anyone who wants to verify or update it.

## Running it

```
docker run --rm -it \
  -p 9999:9999 -p 5000:5000 \
  -v "$PWD/packages/ledger-signer/speculos":/speculos/local \
  ghcr.io/ledgerhq/speculos@sha256:6ed9eefd51cddd862b746719af4cd7a3265fe43d0588c388359753cab8d46d11 \
  --model nanox --display headless \
  --apdu-port 9999 --api-port 5000 \
  --seed "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" \
  /speculos/local/app-hedera.elf
```

or via the wrapper script (same command, run from the repo root):

```
packages/ledger-signer/speculos/start.sh
```

This matches `apps/broker/src/config.ts`'s defaults
(`LEDGER_TRANSPORT=speculos`, `LEDGER_SPECULOS_HOST=127.0.0.1`,
`LEDGER_SPECULOS_PORT=9999`) — `pnpm --filter broker test` expects an
instance already running at that host/port (`apps/broker/src/__tests__/setup.speculos.ts`
checks connectivity and fails fast with this same instruction if it isn't,
and auto-approves the on-device review screens for the duration of the test
run — see that file's comment for why review-screen automation belongs
there and not in `@paybound/ledger-signer` itself).

The seed above is Speculos's own well-known BIP-39 test seed (used
throughout Ledger's own app test suites) — not a secret, and not connected
to any real funds; do not reuse it for anything real.

## Why signing works against a dummy transaction, not a real one

`apps/broker/src/hedera-transaction-body.ts` explains this in full — short
version: the device app only accepts a structurally valid Hedera
`TransactionBody` protobuf, but this project's Phase 1-3 payment flow
doesn't have a real Hedera-account-shaped recipient/amount to encode yet
(that's a later phase's integration, via `packages/settlement`). So the
bytes actually signed are a fixed, clearly-dummy 1-tinybar transfer between
two placeholder accounts, with the real payment's content bound in via a
SHA-256 digest in the transaction's `memo` field.
