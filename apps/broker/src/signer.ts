import { createHmac } from "node:crypto";
import { config } from "./config.js";
import { signHederaPayload, type LedgerTransportConfig } from "@paybound/ledger-signer";
import { buildSignableHederaTransactionBody } from "./hedera-transaction-body.js";

/**
 * STUB SIGNER — not real cryptographic signing tied to any real key.
 *
 * From Phase 1, used only when the real Ledger signer is explicitly
 * disabled (`LEDGER_SIGNING_ENABLED=false` — see `resolveSigner` below).
 * Produces a deterministic placeholder signature — an HMAC over the
 * payload using a fixed, development-only secret — so the rest of the
 * system (capability issuance, the payment state machine) has something
 * shaped like a signature to persist and pass around.
 */
const STUB_SIGNING_SECRET = "paybound-phase-1-stub-signer-do-not-use-in-production";

export function stubSign(payload: string): string {
  return createHmac("sha256", STUB_SIGNING_SECRET).update(payload).digest("hex");
}

/**
 * Builds the transport `ledgerSign`/`hederaTransactionSigner` talk over
 * from `config` (task 3.2, issue 45): `speculos` by default (pointed at
 * `config.ledgerSpeculosHost`/`ledgerSpeculosPort`), `hid` when
 * `LEDGER_TRANSPORT=hid` is set — the real-hardware path, documented but
 * never run against real hardware here.
 */
function resolveLedgerTransport(): LedgerTransportConfig {
  return config.ledgerTransport === "hid"
    ? { kind: "hid" }
    : { kind: "speculos", host: config.ledgerSpeculosHost, port: config.ledgerSpeculosPort };
}

/**
 * Real Ledger-backed signer (task 3.1b, transport swapped in task 3.2) — a
 * drop-in replacement for `stubSign`, backed by a custom APDU client
 * talking directly to the Ledger Hedera device app's INS_SIGN_TRANSACTION
 * instruction (curve: ECDSA secp256k1; see docs/LEDGER_HEDERA_RESEARCH.md
 * and docs/OPEN_QUESTIONS.md "Resolved: Ledger signing curve mismatch").
 * Requires either a connected, unlocked Ledger with the Hedera app open
 * (`hid` transport) or a reachable Speculos instance running that same app
 * (`speculos` transport, the default — see @paybound/ledger-signer's
 * README) — rejects otherwise (see @paybound/ledger-signer's device.ts).
 *
 * `payload` is `canonicalize(reserved.capability)` (state-machine.ts) — an
 * arbitrary JSON string, not a Hedera protobuf `TransactionBody`, which is
 * all the device app will actually parse and sign. This wraps it via
 * `buildSignableHederaTransactionBody` (hedera-transaction-body.ts) rather
 * than sending it as-is; see that module's doc comment for why and for the
 * "known limitation" this implies (no real recipient/amount encoded here —
 * that's `hederaTransactionSigner` below's job, once real settlement is
 * wired in).
 *
 * `transportOverride` exists for testability (forcing a specific transport
 * regardless of `config.ledgerTransport`, which — like the rest of
 * `config` — is fixed for the life of the process); production code should
 * never need to pass it.
 *
 * Async, not `(payload) => string`: `@paybound/ledger-signer`'s actual
 * device I/O runs in a worker thread (see its index.ts) so that however
 * long the user takes to physically confirm on-device never blocks this
 * process's main event loop. `resolveSigner`/`submitPayment` (state-
 * machine.ts) accept either a sync or async signer for exactly this
 * reason.
 */
export async function ledgerSign(
  payload: string,
  transportOverride?: LedgerTransportConfig,
): Promise<string> {
  const transactionBody = buildSignableHederaTransactionBody(payload);
  const signature = await signHederaPayload(
    transactionBody,
    config.ledgerKeyIndex,
    transportOverride ?? resolveLedgerTransport(),
  );
  return signature.toString("hex");
}

/**
 * The `@hashgraph/sdk` `transaction.signWith(publicKey, transactionSigner)`
 * integration seam confirmed in docs/LEDGER_HEDERA_RESEARCH.md — for
 * signing real Hedera transactions with the same Ledger-backed key used by
 * `ledgerSign` above. Unlike `ledgerSign`, `message` here is expected to
 * already be a real, fully-formed `TransactionBody` encoding (that's what
 * `@hashgraph/sdk`'s `signWith` hands its signer callback), so it needs no
 * wrapping — this is the seam `ledgerSign`'s doc comment refers to as
 * where a real recipient/amount will actually flow through once
 * packages/settlement is wired into this flow.
 *
 * `transportOverride`: see `ledgerSign`'s doc comment.
 */
export function hederaTransactionSigner(
  keyIndex: number = config.ledgerKeyIndex,
  transportOverride?: LedgerTransportConfig,
): (message: Uint8Array) => Promise<Uint8Array> {
  return async (message) =>
    signHederaPayload(Buffer.from(message), keyIndex, transportOverride ?? resolveLedgerTransport());
}

/**
 * Picks the signer `submitPayment` (state-machine.ts) should use: the real
 * Ledger signer by default (`config.ledgerSigningEnabled`, on by default as
 * of task 3.2 — see config.ts), falling back to the Phase 1 stub only when
 * explicitly disabled (`LEDGER_SIGNING_ENABLED=false`).
 */
export function resolveSigner(): (payload: string) => string | Promise<string> {
  return config.ledgerSigningEnabled ? ledgerSign : stubSign;
}
