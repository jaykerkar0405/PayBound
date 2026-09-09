import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db.js";
import { seedRegistry } from "../registry.js";
import { issueCapability } from "../issuer.js";
import { createTask } from "../budget.js";
import { reservePayment, submitPayment } from "../state-machine.js";
import { settleAndRecord, isSettlementConfigured, type SettlementDeps } from "../settlement.js";

async function setUpSubmitted() {
  const taskHash = randomUUID();
  const resourceId = randomUUID();
  seedRegistry([{ resourceId, recipient: "0xRECIPIENT", price: "10.00" }]);
  createTask(taskHash, "100.00");

  const issued = issueCapability({
    taskDefinition: { taskHash },
    resourceId,
    exactAmount: "10.00",
    paymentRequest: { detail: "test" },
    session: "sandbox-public-key",
  });

  const reserved = reservePayment(issued.capabilityId, taskHash, "10.00");
  if (!reserved.ok) throw new Error("expected reservation to succeed");
  return submitPayment(reserved.state, (payload) => `sig:${payload.length}`);
}

function submissionStatus(nonce: string): string | null {
  const row = db
    .prepare<[string], { status: string | null }>("SELECT status FROM payment_submissions WHERE nonce = ?")
    .get(nonce);
  return row?.status ?? null;
}

function fakeDeps(overrides: Partial<SettlementDeps> = {}): SettlementDeps {
  return {
    submitToHedera: vi.fn(),
    queryHederaTransactionReceipt: vi.fn(),
    logSettlementOutcome: vi.fn().mockResolvedValue({ transactionId: "0.0.999@1.1" }),
    ...overrides,
  };
}

describe("isSettlementConfigured", () => {
  const original = {
    accountId: process.env.HEDERA_TESTNET_ACCOUNT_ID,
    privateKey: process.env.HEDERA_TESTNET_PRIVATE_KEY,
  };

  afterEach(() => {
    if (original.accountId === undefined) delete process.env.HEDERA_TESTNET_ACCOUNT_ID;
    else process.env.HEDERA_TESTNET_ACCOUNT_ID = original.accountId;
    if (original.privateKey === undefined) delete process.env.HEDERA_TESTNET_PRIVATE_KEY;
    else process.env.HEDERA_TESTNET_PRIVATE_KEY = original.privateKey;
  });

  it("is false when neither credential is set", () => {
    delete process.env.HEDERA_TESTNET_ACCOUNT_ID;
    delete process.env.HEDERA_TESTNET_PRIVATE_KEY;
    expect(isSettlementConfigured()).toBe(false);
  });

  it("is false when only one credential is set", () => {
    process.env.HEDERA_TESTNET_ACCOUNT_ID = "0.0.1234";
    delete process.env.HEDERA_TESTNET_PRIVATE_KEY;
    expect(isSettlementConfigured()).toBe(false);
  });

  it("is true when both credentials are set", () => {
    process.env.HEDERA_TESTNET_ACCOUNT_ID = "0.0.1234";
    process.env.HEDERA_TESTNET_PRIVATE_KEY = "302e...";
    expect(isSettlementConfigured()).toBe(true);
  });
});

describe("settleAndRecord", () => {
  const original = {
    accountId: process.env.HEDERA_TESTNET_ACCOUNT_ID,
    privateKey: process.env.HEDERA_TESTNET_PRIVATE_KEY,
  };

  afterEach(() => {
    if (original.accountId === undefined) delete process.env.HEDERA_TESTNET_ACCOUNT_ID;
    else process.env.HEDERA_TESTNET_ACCOUNT_ID = original.accountId;
    if (original.privateKey === undefined) delete process.env.HEDERA_TESTNET_PRIVATE_KEY;
    else process.env.HEDERA_TESTNET_PRIVATE_KEY = original.privateKey;
  });

  describe("when settlement is not configured", () => {
    beforeEach(() => {
      delete process.env.HEDERA_TESTNET_ACCOUNT_ID;
      delete process.env.HEDERA_TESTNET_PRIVATE_KEY;
    });

    it("leaves the payment at SUBMITTED (no status row) and never calls submitToHedera", async () => {
      const submitted = await setUpSubmitted();
      const deps = fakeDeps();

      await settleAndRecord(submitted, deps);

      expect(deps.submitToHedera).not.toHaveBeenCalled();
      expect(submissionStatus(submitted.capability.nonce)).toBeNull();
    });
  });

  describe("when settlement is configured", () => {
    beforeEach(() => {
      process.env.HEDERA_TESTNET_ACCOUNT_ID = "0.0.1234";
      process.env.HEDERA_TESTNET_PRIVATE_KEY = "302e...";
    });

    it("a definitive 'settled' result resolves the payment to SETTLED and logs the real transaction ID", async () => {
      const submitted = await setUpSubmitted();
      const deps = fakeDeps({
        submitToHedera: vi
          .fn()
          .mockResolvedValue({ outcome: "settled", transactionId: "0.0.1@1.1", status: "SUCCESS" }),
      });

      await settleAndRecord(submitted, deps);

      expect(submissionStatus(submitted.capability.nonce)).toBe("SETTLED");
      expect(deps.queryHederaTransactionReceipt).not.toHaveBeenCalled();
      expect(deps.logSettlementOutcome).toHaveBeenCalledExactlyOnceWith({
        eventType: "settlement_outcome",
        timestamp: expect.any(String) as string,
        taskHash: submitted.capability.taskHash,
        hederaTransactionId: "0.0.1@1.1",
        status: "SUCCESS",
      });
    });

    it("a definitive 'failed' result resolves the payment to FAILED and still logs the transaction ID", async () => {
      const submitted = await setUpSubmitted();
      const deps = fakeDeps({
        submitToHedera: vi.fn().mockResolvedValue({
          outcome: "failed",
          transactionId: "0.0.1@1.2",
          status: "INSUFFICIENT_ACCOUNT_BALANCE",
        }),
      });

      await settleAndRecord(submitted, deps);

      expect(submissionStatus(submitted.capability.nonce)).toBe("FAILED");
      expect(deps.logSettlementOutcome).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ hederaTransactionId: "0.0.1@1.2", status: "INSUFFICIENT_ACCOUNT_BALANCE" }),
      );
    });

    it("an 'unknown' result that reconciliation resolves settles the payment using the reconciled outcome", async () => {
      const submitted = await setUpSubmitted();
      const deps = fakeDeps({
        submitToHedera: vi
          .fn()
          .mockResolvedValue({ outcome: "unknown", transactionId: "0.0.1@1.3", status: null }),
        queryHederaTransactionReceipt: vi
          .fn()
          .mockResolvedValue({ outcome: "settled", transactionId: "0.0.1@1.3", status: "SUCCESS" }),
      });

      await settleAndRecord(submitted, deps);

      expect(deps.queryHederaTransactionReceipt).toHaveBeenCalledExactlyOnceWith("0.0.1@1.3");
      expect(submissionStatus(submitted.capability.nonce)).toBe("SETTLED");
      expect(deps.logSettlementOutcome).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ hederaTransactionId: "0.0.1@1.3", status: "SUCCESS" }),
      );
    });

    it("an 'unknown' result where reconciliation also can't confirm leaves the payment RECOVERABLE, not a blind retry", async () => {
      const submitted = await setUpSubmitted();
      const deps = fakeDeps({
        submitToHedera: vi
          .fn()
          .mockResolvedValue({ outcome: "unknown", transactionId: "0.0.1@1.4", status: null }),
        queryHederaTransactionReceipt: vi.fn().mockRejectedValue(new Error("still no receipt")),
      });

      await settleAndRecord(submitted, deps);

      expect(deps.submitToHedera).toHaveBeenCalledTimes(1);
      expect(submissionStatus(submitted.capability.nonce)).toBe("RECOVERABLE");
      expect(deps.logSettlementOutcome).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ hederaTransactionId: "0.0.1@1.4", status: "unknown" }),
      );
    });

    it("submitToHedera throwing outright (no transaction ID ever exists) leaves the payment RECOVERABLE and logs nothing to HCS", async () => {
      const submitted = await setUpSubmitted();
      const deps = fakeDeps({
        submitToHedera: vi.fn().mockRejectedValue(new Error("could not reach Hedera")),
      });

      await settleAndRecord(submitted, deps);

      expect(deps.queryHederaTransactionReceipt).not.toHaveBeenCalled();
      expect(submissionStatus(submitted.capability.nonce)).toBe("RECOVERABLE");
      expect(deps.logSettlementOutcome).not.toHaveBeenCalled();
    });

    it("a failure to log to HCS does not prevent the payment from resolving", async () => {
      const submitted = await setUpSubmitted();
      const deps = fakeDeps({
        submitToHedera: vi
          .fn()
          .mockResolvedValue({ outcome: "settled", transactionId: "0.0.1@1.5", status: "SUCCESS" }),
        logSettlementOutcome: vi.fn().mockRejectedValue(new Error("HCS topic ID is missing")),
      });

      await expect(settleAndRecord(submitted, deps)).resolves.toBeUndefined();
      expect(submissionStatus(submitted.capability.nonce)).toBe("SETTLED");
    });
  });
});
