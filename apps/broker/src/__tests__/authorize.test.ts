import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PaymentAuthorizationRequest, Capability, Task } from "@paybound/capability-spec";
import { db } from "../db.js";
import { seedRegistry } from "../registry.js";
import { issueCapability, getCapabilityRecord } from "../issuer.js";
import { createTask, getTask } from "../budget.js";
import { authorize } from "../authorize.js";
import { hashCanonical } from "../hash.js";

function setUp(overrides: { price?: string; maxTotalSpend?: string; session?: string } = {}) {
  const price = overrides.price ?? "10.00";
  const session = overrides.session ?? "sandbox-public-key";
  const resourceId = randomUUID();
  const taskHash = hashCanonical(randomUUID());

  seedRegistry([{ resourceId, recipient: "0xRECIPIENT", price }]);
  createTask(taskHash, overrides.maxTotalSpend ?? "100.00");

  const issued = issueCapability({
    taskDefinition: { taskHash },
    resourceId,
    exactAmount: price,
    paymentRequest: { detail: "test" },
    session,
  });

  const record = getCapabilityRecord(issued.capabilityId);
  if (record === undefined) throw new Error("expected capability record to exist");
  const task = getTask(taskHash);
  if (task === undefined) throw new Error("expected task to exist");

  const capability: Capability = record.capability;
  const validPayment: PaymentAuthorizationRequest = {
    amount: capability.exactAmount,
    destination: capability.recipient,
    resource: capability.resourceId,
    taskHash: capability.taskHash,
    session: capability.session,
    paymentRequestHash: capability.paymentRequestHash,
  };

  return { capability, task, validPayment, capabilityId: issued.capabilityId };
}

function consumedFlag(capabilityId: string): number | undefined {
  return db
    .prepare<[string], { consumed: number }>("SELECT consumed FROM capabilities WHERE capability_id = ?")
    .get(capabilityId)?.consumed;
}

describe("authorize", () => {
  it("amount mismatch -> AMOUNT_MISMATCH", () => {
    const { capability, task, validPayment } = setUp();
    const payment = { ...validPayment, amount: "999.00" };

    expect(authorize({ payment, capability, task })).toEqual({
      authorized: false,
      reason: "AMOUNT_MISMATCH",
    });
  });

  it("substitution -> SUBSTITUTION", () => {
    const { capability, task, validPayment } = setUp();
    const payment = { ...validPayment, destination: "0xATTACKER" };

    expect(authorize({ payment, capability, task })).toEqual({
      authorized: false,
      reason: "SUBSTITUTION",
    });
  });

  it("resource mismatch -> RESOURCE_MISMATCH", () => {
    const { capability, task, validPayment } = setUp();
    const payment = { ...validPayment, resource: randomUUID() };

    expect(authorize({ payment, capability, task })).toEqual({
      authorized: false,
      reason: "RESOURCE_MISMATCH",
    });
  });

  it("task_hash mismatch -> TASK_HASH_MISMATCH", () => {
    const { capability, task, validPayment } = setUp();
    const payment = { ...validPayment, taskHash: randomUUID() };

    expect(authorize({ payment, capability, task })).toEqual({
      authorized: false,
      reason: "TASK_HASH_MISMATCH",
    });
  });

  it("session mismatch -> SESSION_MISMATCH", () => {
    const { capability, task, validPayment } = setUp();
    const payment = { ...validPayment, session: "different-session-key" };

    expect(authorize({ payment, capability, task })).toEqual({
      authorized: false,
      reason: "SESSION_MISMATCH",
    });
  });

  it("request forgery -> REQUEST_FORGERY (destination/amount unchanged, distinct from substitution)", () => {
    const { capability, task, validPayment } = setUp();
    const payment = { ...validPayment, paymentRequestHash: randomUUID() };

    expect(authorize({ payment, capability, task })).toEqual({
      authorized: false,
      reason: "REQUEST_FORGERY",
    });
    expect(payment.destination).toBe(validPayment.destination);
    expect(payment.amount).toBe(validPayment.amount);
  });

  it("replay: reusing an already-consumed capability -> REPLAY", () => {
    const { capability, task, validPayment } = setUp();

    const first = authorize({ payment: validPayment, capability, task });
    expect(first.authorized).toBe(true);
    if (first.authorized) {
      expect(first.state.status).toBe("RESERVED");
    }

    expect(authorize({ payment: validPayment, capability, task })).toEqual({
      authorized: false,
      reason: "REPLAY",
    });
  });

  it("stale nonce: an expired capability -> STALE_NONCE", () => {
    const { capability, task, validPayment, capabilityId } = setUp();
    db.prepare("UPDATE capabilities SET expiry = ? WHERE capability_id = ?").run(
      new Date(Date.now() - 60_000).toISOString(),
      capabilityId,
    );

    expect(authorize({ payment: validPayment, capability, task })).toEqual({
      authorized: false,
      reason: "STALE_NONCE",
    });
  });

  it("over-budget: insufficient task budget -> BUDGET_EXCEEDED", () => {
    const { capability, task, validPayment } = setUp({ price: "10.00", maxTotalSpend: "5.00" });

    expect(authorize({ payment: validPayment, capability, task })).toEqual({
      authorized: false,
      reason: "BUDGET_EXCEEDED",
    });
  });

  it("a fully valid payment is authorized, returning the real ReservedPaymentState", () => {
    const { capability, task, validPayment } = setUp();

    const result = authorize({ payment: validPayment, capability, task });

    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.state.status).toBe("RESERVED");
      expect(result.state.issuedFrom.status).toBe("ISSUED");
      expect(result.state.capability.taskHash).toBe(capability.taskHash);
    }
  });

  it("deterministically reports the higher-precedence clause when multiple are violated", () => {
    const { capability, task, validPayment } = setUp();
    const payment = { ...validPayment, amount: "999.00", destination: "0xATTACKER" };

    expect(authorize({ payment, capability, task })).toEqual({
      authorized: false,
      reason: "AMOUNT_MISMATCH",
    });
  });

  it("a clause 1-6 rejection does not burn the nonce or increment the task's spentSoFar", () => {
    const { capability, task, validPayment, capabilityId } = setUp();
    const payment = { ...validPayment, amount: "999.00" };

    authorize({ payment, capability, task });

    expect(consumedFlag(capabilityId)).toBe(0);
    expect(getTask(task.taskHash as Task["taskHash"])?.spentSoFar).toBe("0");
  });
});
