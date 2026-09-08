import { createHmac } from "node:crypto";

/**
 * STUB SIGNER — not real cryptographic signing tied to any real key.
 *
 * Real Ledger-backed signing is task 3.1; the signing curve itself
 * (secp256k1 vs Ed25519) is still an open question blocking it (see
 * docs/OPEN_QUESTIONS.md "Ledger signing curve mismatch"). For Phase 1,
 * this produces a deterministic placeholder signature — an HMAC over the
 * payload using a fixed, development-only secret — so the rest of the
 * system (capability issuance, the payment state machine) has something
 * shaped like a signature to persist and pass around.
 */
const STUB_SIGNING_SECRET = "paybound-phase-1-stub-signer-do-not-use-in-production";

export function stubSign(payload: string): string {
  return createHmac("sha256", STUB_SIGNING_SECRET).update(payload).digest("hex");
}
