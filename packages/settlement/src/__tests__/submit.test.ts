import { describe, expect, it } from "vitest";
import type { SubmittedPaymentState } from "@paybound/capability-spec";
import { submitToHedera } from "../submit.js";

const hasTestnetCredentials =
  process.env.HEDERA_TESTNET_ACCOUNT_ID !== undefined &&
  process.env.HEDERA_TESTNET_PRIVATE_KEY !== undefined;

const capability = {
  taskHash: "test-task",
  resourceId: "test-resource",
  recipient: process.env.HEDERA_TESTNET_ACCOUNT_ID ?? "0.0.2",
  exactAmount: "0.00000001",
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
  it("submits one tinybar transfer to Hedera Testnet", async () => {
    const result = await submitToHedera(submittedPayment);

    expect(result.transactionId).toMatch(/^\d+\.\d+\.\d+@\d+\.\d+$/);
    expect(result.status).toBe("SUCCESS");
  });
});