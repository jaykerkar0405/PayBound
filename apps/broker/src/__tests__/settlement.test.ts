import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db.js";
import { seedRegistry } from "../registry.js";
import { issueCapability } from "../issuer.js";
import { createTask } from "../budget.js";
import { reservePayment, submitPayment } from "../state-machine.js";
import {
  settleAndRecord,
  sweepRecoverablePayments,
  isSettlementConfigured,
  type SettlementDeps,
} from "../settlement.js";
import type { HederaReconciliationResult } from "@paybound/settlement";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

function hederaTxIdForNonce(nonce: string): string | null {
  const row = db
    .prepare<[string], { hedera_transaction_id: string | null }>(
      "SELECT hedera_transaction_id FROM payment_submissions WHERE nonce = ?",
    )
    .get(nonce);
  return row?.hedera_transaction_id ?? null;
}

function fakeDeps(overrides: Partial<SettlementDeps> = {}): SettlementDeps {
  return {
    submitToHedera: vi.fn(),
    queryHederaTransactionReceipt: vi.fn(),
    logSettlementOutcome: vi.fn().mockResolvedValue({ transactionId: "0.0.999@1.1" }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isSettlementConfigured
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// settleAndRecord — core outcome mapping
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// settleAndRecord — Gap 1: hedera_transaction_id persistence
// ---------------------------------------------------------------------------

describe("settleAndRecord — Gap 1: hedera_transaction_id persistence", () => {
  const orig2 = {
    accountId: process.env.HEDERA_TESTNET_ACCOUNT_ID,
    privateKey: process.env.HEDERA_TESTNET_PRIVATE_KEY,
  };
  afterEach(() => {
    if (orig2.accountId === undefined) delete process.env.HEDERA_TESTNET_ACCOUNT_ID;
    else process.env.HEDERA_TESTNET_ACCOUNT_ID = orig2.accountId;
    if (orig2.privateKey === undefined) delete process.env.HEDERA_TESTNET_PRIVATE_KEY;
    else process.env.HEDERA_TESTNET_PRIVATE_KEY = orig2.privateKey;
  });
  beforeEach(() => {
    process.env.HEDERA_TESTNET_ACCOUNT_ID = "0.0.1234";
    process.env.HEDERA_TESTNET_PRIVATE_KEY = "302e...";
  });

  it("persists hedera_transaction_id after a settled outcome", async () => {
    const submitted = await setUpSubmitted();
    const txId = "0.0.1@500.0";
    await settleAndRecord(submitted, fakeDeps({
      submitToHedera: vi.fn().mockResolvedValue({ outcome: "settled", transactionId: txId, status: "SUCCESS" }),
    }));
    expect(hederaTxIdForNonce(submitted.capability.nonce)).toBe(txId);
  });

  it("persists hedera_transaction_id even when the payment ends up RECOVERABLE", async () => {
    const submitted = await setUpSubmitted();
    const txId = "0.0.1@501.0";
    await settleAndRecord(submitted, fakeDeps({
      submitToHedera: vi.fn().mockResolvedValue({ outcome: "unknown", transactionId: txId, status: null }),
      queryHederaTransactionReceipt: vi.fn().mockRejectedValue(new Error("RECEIPT_NOT_FOUND")),
    }));
    expect(submissionStatus(submitted.capability.nonce)).toBe("RECOVERABLE");
    expect(hederaTxIdForNonce(submitted.capability.nonce)).toBe(txId);
  });

  it("does NOT persist hedera_transaction_id when submitToHedera throws (never dispatched)", async () => {
    const submitted = await setUpSubmitted();
    await settleAndRecord(submitted, fakeDeps({
      submitToHedera: vi.fn().mockRejectedValue(new Error("network error")),
    }));
    expect(hederaTxIdForNonce(submitted.capability.nonce)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sweepRecoverablePayments (Gap 1 + Gap 2 combined)
// ---------------------------------------------------------------------------

describe("sweepRecoverablePayments", () => {
  const orig3 = {
    accountId: process.env.HEDERA_TESTNET_ACCOUNT_ID,
    privateKey: process.env.HEDERA_TESTNET_PRIVATE_KEY,
  };
  afterEach(() => {
    if (orig3.accountId === undefined) delete process.env.HEDERA_TESTNET_ACCOUNT_ID;
    else process.env.HEDERA_TESTNET_ACCOUNT_ID = orig3.accountId;
    if (orig3.privateKey === undefined) delete process.env.HEDERA_TESTNET_PRIVATE_KEY;
    else process.env.HEDERA_TESTNET_PRIVATE_KEY = orig3.privateKey;
  });

  async function makeRecoverable(txId: string) {
    process.env.HEDERA_TESTNET_ACCOUNT_ID = "0.0.1234";
    process.env.HEDERA_TESTNET_PRIVATE_KEY = "302e...";
    const submitted = await setUpSubmitted();
    await settleAndRecord(submitted, fakeDeps({
      submitToHedera: vi.fn().mockResolvedValue({ outcome: "unknown", transactionId: txId, status: null }),
      queryHederaTransactionReceipt: vi.fn().mockRejectedValue(new Error("RECEIPT_NOT_FOUND")),
    }));
    return submitted;
  }

  it("resolves RECOVERABLE+txId to SETTLED when reconciliation confirms SUCCESS", async () => {
    const submitted = await makeRecoverable("0.0.1@600.0");
    await sweepRecoverablePayments({
      queryHederaTransactionReceipt: vi.fn().mockResolvedValue({
        outcome: "settled", transactionId: "0.0.1@600.0", status: "SUCCESS",
      } satisfies HederaReconciliationResult),
    });
    expect(submissionStatus(submitted.capability.nonce)).toBe("SETTLED");
  });

  it("resolves RECOVERABLE+txId to FAILED when reconciliation returns definitive failure", async () => {
    const submitted = await makeRecoverable("0.0.1@601.0");
    await sweepRecoverablePayments({
      queryHederaTransactionReceipt: vi.fn().mockResolvedValue({
        outcome: "failed", transactionId: "0.0.1@601.0", status: "INSUFFICIENT_ACCOUNT_BALANCE",
      } satisfies HederaReconciliationResult),
    });
    expect(submissionStatus(submitted.capability.nonce)).toBe("FAILED");
  });

  it("leaves RECOVERABLE untouched and does not throw when reconciliation still fails", async () => {
    const submitted = await makeRecoverable("0.0.1@602.0");
    await expect(sweepRecoverablePayments({
      queryHederaTransactionReceipt: vi.fn().mockRejectedValue(new Error("mirror: not found yet")),
    })).resolves.toBeUndefined();
    expect(submissionStatus(submitted.capability.nonce)).toBe("RECOVERABLE");
  });

  it("is a no-op when settlement credentials are not configured", async () => {
    delete process.env.HEDERA_TESTNET_ACCOUNT_ID;
    delete process.env.HEDERA_TESTNET_PRIVATE_KEY;
    const queryFn = vi.fn();
    await sweepRecoverablePayments({ queryHederaTransactionReceipt: queryFn });
    expect(queryFn).not.toHaveBeenCalled();
  });
});
