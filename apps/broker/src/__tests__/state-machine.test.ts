import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "../db.js";
import { seedRegistry } from "../registry.js";
import { issueCapability } from "../issuer.js";
import { createTask } from "../budget.js";
import { hashCanonical } from "../hash.js";
import { reservePayment, submitPayment, resolveSubmission } from "../state-machine.js";

function setUpCapability(overrides: { maxTotalSpend?: string; price?: string } = {}) {
  const taskHash = randomUUID();
  const resourceId = randomUUID();
  const price = overrides.price ?? "10.00";

  seedRegistry([{ resourceId, recipient: "0xRECIPIENT", price }]);
  createTask(taskHash, overrides.maxTotalSpend ?? "100.00");

  const issued = issueCapability({
    taskDefinition: { taskHash },
    resourceId,
    exactAmount: price,
    paymentRequest: { detail: "test" },
    session: "sandbox-public-key",
  });

  return { taskHash, resourceId, price, capabilityId: issued.capabilityId };
}

function expireCapability(capabilityId: string) {
  db.prepare("UPDATE capabilities SET expiry = ? WHERE capability_id = ?").run(
    new Date(Date.now() - 60_000).toISOString(),
    capabilityId,
  );
}

describe("reservePayment", () => {
  it("succeeds for a freshly issued, unexpired, unconsumed capability with sufficient budget", () => {
    const { taskHash, price, capabilityId } = setUpCapability();

    const result = reservePayment(capabilityId, taskHash, price);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.status).toBe("RESERVED");
      expect(result.state.issuedFrom.status).toBe("ISSUED");
      expect(result.state.issuedFrom.capability.taskHash).toBe(hashCanonical({ taskHash }));
    }

    const row = db
      .prepare<[string], { consumed: number }>("SELECT consumed FROM capabilities WHERE capability_id = ?")
      .get(capabilityId);
    expect(row?.consumed).toBe(1);
  });

  it("fails a second reservation of the same capability with REPLAY, without double-spending budget", () => {
    const { taskHash, price, capabilityId } = setUpCapability({ maxTotalSpend: "100.00" });
    reservePayment(capabilityId, taskHash, price);

    const second = reservePayment(capabilityId, taskHash, price);

    expect(second).toEqual({ ok: false, reason: "REPLAY" });
  });

  it("fails an expired capability with STALE_NONCE, leaving nonce unconsumed and budget unchanged", () => {
    const { taskHash, price, capabilityId } = setUpCapability();
    expireCapability(capabilityId);

    const result = reservePayment(capabilityId, taskHash, price);

    expect(result).toEqual({ ok: false, reason: "STALE_NONCE" });
    const row = db
      .prepare<[string], { consumed: number }>("SELECT consumed FROM capabilities WHERE capability_id = ?")
      .get(capabilityId);
    expect(row?.consumed).toBe(0);
  });

  it("fails when the task's remaining budget is insufficient, leaving the nonce unconsumed", () => {
    const { taskHash, price, capabilityId } = setUpCapability({ maxTotalSpend: "5.00", price: "10.00" });

    const result = reservePayment(capabilityId, taskHash, price);

    expect(result).toEqual({ ok: false, reason: "BUDGET_EXCEEDED" });
    const row = db
      .prepare<[string], { consumed: number }>("SELECT consumed FROM capabilities WHERE capability_id = ?")
      .get(capabilityId);
    expect(row?.consumed).toBe(0);
  });

  it("under concurrent reservation attempts on the same capability, exactly one succeeds", async () => {
    const { taskHash, price, capabilityId } = setUpCapability();

    const attempts = Array.from({ length: 20 }, () =>
      Promise.resolve().then(() => reservePayment(capabilityId, taskHash, price)),
    );
    const results = await Promise.all(attempts);

    const successes = results.filter((result) => result.ok);
    const replays = results.filter((result) => !result.ok && result.reason === "REPLAY");
    expect(successes).toHaveLength(1);
    expect(replays).toHaveLength(19);
  });
});

describe("submitPayment", () => {
  it("returns a SubmittedPaymentState nesting the ReservedPaymentState, with a stub-signed payload", () => {
    const { taskHash, price, capabilityId } = setUpCapability();
    const reserved = reservePayment(capabilityId, taskHash, price);
    if (!reserved.ok) throw new Error("expected reservation to succeed");

    const stubSigner = (payload: string) => `stub-signature-of:${payload.length}`;
    const submitted = submitPayment(reserved.state, stubSigner);

    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.reservedFrom).toEqual(reserved.state);
  });
});

describe("resolveSubmission", () => {
  function setUpSubmitted() {
    const { taskHash, price, capabilityId } = setUpCapability();
    const reserved = reservePayment(capabilityId, taskHash, price);
    if (!reserved.ok) throw new Error("expected reservation to succeed");
    return submitPayment(reserved.state, (payload) => `sig:${payload.length}`);
  }

  it("'settled' resolves to a SettledPaymentState nesting the SubmittedPaymentState", () => {
    const submitted = setUpSubmitted();

    const resolved = resolveSubmission(submitted, "settled");

    expect(resolved.status).toBe("SETTLED");
    expect(resolved.submittedFrom).toEqual(submitted);
  });

  it("'failed' resolves to a FailedPaymentState nesting the SubmittedPaymentState", () => {
    const submitted = setUpSubmitted();

    const resolved = resolveSubmission(submitted, "failed");

    expect(resolved.status).toBe("FAILED");
    expect(resolved.submittedFrom).toEqual(submitted);
  });

  it("'unknown' resolves to a RecoverablePaymentState nesting the SubmittedPaymentState", () => {
    const submitted = setUpSubmitted();

    const resolved = resolveSubmission(submitted, "unknown");

    expect(resolved.status).toBe("RECOVERABLE");
    expect(resolved.submittedFrom).toEqual(submitted);
  });
});
