import { describe, expect, it } from "vitest";
import type { SubmittedPaymentState } from "@paybound/capability-spec";
import { submitToHedera } from "../submit.js";

const hasTestnetCredentials =
  process.env.HEDERA_TESTNET_ACCOUNT_ID !== undefined &&
  process.env.HEDERA_TESTNET_PRIVATE_KEY !== undefined;

// Recipient is the operator's own account — valid for testnet verification since
// Hedera allows self-transfers and this keeps the test self-contained with no
// external dependency on a second funded account. In production the recipient
// comes from capability.recipient (a pre-vetted resource registry address).
const capability = {
  taskHash: "test-task",
  resourceId: "test-resource",
  // Falls back to "0.0.2" (Hedera fee account, always exists on testnet) when
  // no credentials are set — the describe.skipIf guard above means this path
  // is never actually executed without credentials.
  recipient: process.env.HEDERA_TESTNET_ACCOUNT_ID ?? "0.0.2",
  exactAmount: "0.00000001", // 1 tinybar — minimum meaningful transfer amount
  paymentRequestHash: "test-request",
  session: "test-session",
  nonce: "test-nonce",
  expiry: "2999-01-01T00:00:00.000Z",
  maxUses: 1 as const,
};

const submittedPayment: SubmittedPaymentState = {
  status: "SUBMITTED",
  capability,
  reservedFrom: {
    status: "RESERVED",
    capability,
    issuedFrom: { status: "ISSUED", capability },
  },
};

describe.skipIf(!hasTestnetCredentials)("submitToHedera", () => {
  it(
    "submits one tinybar transfer to Hedera Testnet and receives a SUCCESS receipt",
    async () => {
      const result = await submitToHedera(submittedPayment);

      // Transaction ID must match Hedera's shard.realm.num@seconds.nanos format
      expect(result.transactionId).toMatch(/^\d+\.\d+\.\d+@\d+\.\d+$/);
      expect(result.status).toBe("SUCCESS");
    },
    30_000, // 30s timeout — real Hedera Testnet consensus can take up to ~10s
  );
});