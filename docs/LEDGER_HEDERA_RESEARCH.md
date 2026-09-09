# Ledger–Hedera Signing Feasibility Research (Issue 3.1a)

## Finding

**Yes — the Ledger Hedera device app defines a real signing instruction, `INS_SIGN_TRANSACTION` (opcode `0x04`), and it is a single-APDU-exchange operation, not a multi-step/streamed protocol.**

This resolves the open question directly: the gap identified in `docs/OPEN_QUESTIONS.md` is confirmed to be in the `@ledgerhq/hw-app-hedera` JS host wrapper only — the device firmware supports signing.

## Evidence

Source: [`LedgerHQ/app-hedera`](https://github.com/LedgerHQ/app-hedera), commit `6c2add31229656f369a9f20bd28388e679f761a1` (cloned directly for this research, not inferred from docs).

- **Instruction set** — `src/handlers.h`:
  ```c
  #define INS_GET_APP_CONFIGURATION 0x01
  #define INS_GET_PUBLIC_KEY 0x02
  #define INS_SIGN_TRANSACTION 0x04
  ```
  `INS_SIGN_TRANSACTION` is dispatched in `src/main.c`'s APDU loop (`case INS_SIGN_TRANSACTION: handle_sign_transaction(...)`), alongside `INS_GET_PUBLIC_KEY` — the only method `hw-app-hedera`'s JS wrapper currently exposes a binding for. The device app has strictly more capability than the host library surfaces.

- **Handler implementation** — `src/sign_transaction.c:385` (`handle_sign_transaction`):
  - Takes the full APDU payload (`buffer`, `len`) in one call.
  - First 4 bytes (`INDEX_SIZE`) are the BIP-32 key index (little-endian `uint32_t`); the remainder is the raw transaction body.
  - The remainder is decoded in place as a single protobuf message (`pb_decode(&stream, Hedera_TransactionBody_fields, ...)`) — no reassembly across multiple calls, no "more data follows" continuation flag.
  - Immediately signs the decoded transaction via `hedera_sign(...)` and returns the signature (`G_io_apdu_buffer`) in the same exchange (`io_exchange(CHANNEL_APDU | IO_RETURN_AFTER_TX, tx)` inside the invoked `ui_sign_transaction()` confirm flow).
  - Size bound: `MAX_TX_SIZE` = 512 bytes (`src/ui/app_globals.h:11`), checked against `len - INDEX_SIZE` with a `THROW(EXCEPTION_MALFORMED_APDU)` on overflow — there is no chunking mechanism to exceed this; a transaction must fit in one exchange or it is rejected outright.

## Complexity / time estimate

**Single-exchange APDU client — low-to-moderate implementation effort, roughly comparable in shape to what `hw-app-hedera` already does for `getPublicKey`.**

A working client needs to:
1. Build one APDU: `CLA | INS_SIGN_TRANSACTION (0x04) | P1 | P2 | Lc | [4-byte LE key index][raw protobuf TransactionBody bytes]`.
2. Send it via the existing Ledger transport (`@ledgerhq/hw-transport-*`, same transport `hw-app-hedera` already uses for `getPublicKey`).
3. Parse the response as the raw signature bytes.

No multi-APDU streaming/continuation protocol needs to be implemented (unlike some Ledger apps, e.g. Ethereum's chunked large-payload signing) — this significantly reduces scope. The one real constraint to design around in 3.1b is the 512-byte transaction body cap: PayBound's Hedera transactions (crypto transfers with a memo) need to be confirmed to fit within that bound, which they should for typical payment transactions but should be explicitly checked against `Hedera_TransactionBody_fields`'s encoded size during 3.1b, not assumed.

Rough estimate: **half a day to a day** to write and test a minimal APDU signing client against this instruction (build APDU, transport call, parse response, wire into `@hashgraph/sdk`'s `transaction.signWith(publicKey, transactionSigner)` seam), assuming test-device or emulator access. This does not include UI/display-flow polishing on the device side (already handled by the existing `ui_sign_transaction()` confirm screens in the app) or broader integration work in the broker.

## Path decision for 3.1b

Given the above, 3.1b should implement **Path A: a minimal custom APDU client that talks directly to the existing, unmodified `app-hedera` device app**, bypassing `hw-app-hedera`'s incomplete JS wrapper rather than waiting on or forking it. No changes to the device-app firmware are required — `INS_SIGN_TRANSACTION` already exists and is shipped in the current app. No Path B (waiting for/upstreaming a `hw-app-hedera` fix, or building a DMK-based signer kit that doesn't exist yet for Hedera) is necessary.
