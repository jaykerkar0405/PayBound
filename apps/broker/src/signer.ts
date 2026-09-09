import { createHmac } from "node:crypto";
import { config } from "./config.js";
import { signHederaPayload } from "@paybound/ledger-signer";

/**
 * STUB SIGNER — not real cryptographic signing tied to any real key.
 *
 * For Phase 1 (and still the default — see `resolveSigner` below), this
 * produces a deterministic placeholder signature — an HMAC over the
 * payload using a fixed, development-only secret — so the rest of the
 * system (capability issuance, the payment state machine) has something
 * shaped like a signature to persist and pass around.
 */
const STUB_SIGNING_SECRET = "paybound-phase-1-stub-signer-do-not-use-in-production";

export function stubSign(payload: string): string {
  return createHmac("sha256", STUB_SIGNING_SECRET).update(payload).digest("hex");
}

/**
 * Real Ledger-backed signer (task 3.1b) — a drop-in `(payload) => string`
 * replacement for `stubSign`, backed by a custom APDU client talking
 * directly to the Ledger Hedera device app's INS_SIGN_TRANSACTION
 * instruction (curve: ECDSA secp256k1; see docs/LEDGER_HEDERA_RESEARCH.md
 * and docs/OPEN_QUESTIONS.md "Resolved: Ledger signing curve mismatch").
 * Requires a connected, unlocked Ledger with the Hedera app open — throws
 * otherwise (see @paybound/ledger-signer's device.ts).
 */
export function ledgerSign(payload: string): string {
  return signHederaPayload(Buffer.from(payload, "utf8"), config.ledgerKeyIndex).toString("hex");
}

/**
 * The `@hashgraph/sdk` `transaction.signWith(publicKey, transactionSigner)`
 * integration seam confirmed in docs/LEDGER_HEDERA_RESEARCH.md — for
 * signing real Hedera transactions with the same Ledger-backed key used by
 * `ledgerSign` above.
 */
export function hederaTransactionSigner(
  keyIndex: number = config.ledgerKeyIndex,
): (message: Uint8Array) => Promise<Uint8Array> {
  return async (message) => signHederaPayload(Buffer.from(message), keyIndex);
}

/**
 * Picks the signer `submitPayment` (state-machine.ts) should use: the real
 * Ledger signer when explicitly enabled (config.ledgerSigningEnabled),
 * otherwise the Phase 1 stub. Task 3.2 covers flipping the default and
 * re-verifying the property test suite (docs/TASKS.md) against the real
 * signer.
 */
export function resolveSigner(): (payload: string) => string {
  return config.ledgerSigningEnabled ? ledgerSign : stubSign;
}
