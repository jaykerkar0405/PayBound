# @paybound/ledger-signer

A minimal, custom APDU client for signing with a Ledger Hedera device app,
built directly against the device app's `INS_SIGN_TRANSACTION` instruction
rather than through `hw-app-hedera` (whose JS wrapper never exposed a
binding for it — see `docs/LEDGER_HEDERA_RESEARCH.md`).

## Transports

`signHederaPayload(rawTransactionBody, keyIndex, transport)` (`src/index.ts`)
supports two transports, selected per call via the `transport` argument
(`LedgerTransportConfig`):

- **`{ kind: "hid" }`** (default) — real Ledger hardware over USB, via
  `node-hid` (`src/device.ts`'s `openLedgerDevice`). **Documented but not
  implemented/tested against real hardware.** This project has no physical
  Ledger device available; this path is unit-tested only against its own
  device-discovery failure (`src/__tests__/worker-concurrency.test.ts`,
  `apps/broker/src/__tests__/signer.test.ts`), never against a real device
  actually signing.
- **`{ kind: "speculos", host, port }`** — [Speculos](https://github.com/LedgerHQ/speculos)
  (Ledger's official device emulator), Ledger's real device app running
  under emulation, over its TCP APDU port (`src/device.ts`'s
  `exchangeApduOverSpeculos`). This is what `apps/broker` actually uses by
  default (task 3.2, issue 45) — see `speculos/README.md` in this package
  for what's checked in there and how to run it, and
  `apps/broker/src/__tests__/setup.speculos.ts` for how the broker's own
  test suite drives it unattended.

Both transports carry the exact same APDU (`src/apdu.ts`) over the exact
same HID-over-USB framing where applicable (`src/hid-framing.ts`, used only
by the `hid` transport — Speculos's TCP protocol needs no such framing, see
`device.ts`'s doc comment on `exchangeApduOverSpeculos`) — only the
transport layer differs between them.

## Known limitation

**This has never been run against real Ledger hardware.** Every "real
signer" test/verification in this repo (including the full property test
suite, `apps/broker/src/__tests__/property.test.ts`) runs against Speculos,
not physical hardware. Speculos is Ledger's own official emulator and runs
the actual, unmodified device app — it's a reasonable substitute at the
protocol level (see `docs/LEDGER_HEDERA_RESEARCH.md`) — but it is still a
substitute, not a guarantee that behavior is identical on real hardware
(timing, real user confirmation flow, and hardware-specific edge cases
are not covered).

## Why device I/O runs in a worker thread

`node-hid`'s write/read calls genuinely block the calling thread — for as
long as a user takes to physically confirm on-device. `signHederaPayload`
runs that I/O in a worker thread (`src/worker.ts`) so it never stalls a
server's main event loop; see `src/index.ts`'s doc comment and
`src/__tests__/worker-concurrency.test.ts`.
