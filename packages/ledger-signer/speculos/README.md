# Speculos Ledger emulator

[Speculos](https://github.com/LedgerHQ/speculos) is the Ledger hardware wallet
emulator used for development and testing. PayBound uses it to run the broker's
Ledger signing path without a physical device.

## Prerequisites

- Docker installed and running
- The compiled Ledger app `.elf` binary (built separately — see task 3.1)

## Starting Speculos

### Interactive mode (human-attended)

```bash
./start.sh
```

Starts Speculos in the foreground with a visible emulated device screen.
Press **Ctrl-C** to stop. Use this during the live demo — the device screen
shows transaction fields that a human can review and approve.

### Detached mode (scripted / background)

```bash
./start.sh --detach
```

Starts Speculos as a detached Docker container (`docker run -d`). Use this in
scripts or CI contexts where stdin is not a terminal (the original `docker run -it`
fails with *"cannot attach stdin to a TTY-enabled container because stdin is not
a terminal"* in these contexts).

Stop the container when done:

```bash
./stop.sh
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `SPECULOS_APDU_PORT` | `9999` | Port the broker connects to for APDU signing |
| `SPECULOS_HTTP_PORT` | `5000` | Port for Speculos's HTTP button API (for auto-pressing in tests) |
| `SPECULOS_APP_PATH` | `./app/app.elf` | Path to the compiled Ledger app binary |
| `SPECULOS_SEED` | test mnemonic | BIP-39 mnemonic — **do not use the default in production** |

## Approving transactions during the live demo

When the broker submits a signing request, Speculos displays a transaction
review screen. A human must navigate and approve:

1. Press **right** to advance through each transaction field.
2. Press **both buttons** on the final "Sign"/"Approve" screen to confirm.

> **Approval timeout**: the broker's signing call waits up to 60 s
> (`SPECULOS_EXCHANGE_TIMEOUT_MS` in `packages/ledger-signer/src/device.ts`).
> If approval takes longer, the call times out with:
> `"ledger device: timed out waiting for a Speculos APDU response"`.
> Restart Speculos to clear stale device state (status word `0x6901`) before
> retrying.

See `docs/DEMO_SIGNING_APPROACH.md` for the full decision rationale on why
human approval was chosen over auto-approval for the demo.

## Test-time auto-approver

The automated test suite wires in a Speculos button poller via
`apps/broker/src/__tests__/setup.speculos.ts` (created as part of task 3.1).
This poller is **test-only infrastructure** — it does not ship with the broker
and is not used in any demo or production context.
