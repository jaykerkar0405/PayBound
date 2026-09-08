import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PaymentAuthorizationRequest } from "@paybound/capability-spec";
import { app } from "../index.js";
import { db } from "../db.js";
import { seedRegistry } from "../registry.js";
import { createTask, getTask } from "../budget.js";
import { issueCapability, getCapabilityRecord } from "../issuer.js";
import { hashCanonical } from "../hash.js";
import { authorize } from "../authorize.js";

/**
 * Task 1.8 property-test suite: comprehensive, adversarial-style coverage
 * proving Broker.authorize(payment) holds every SECURITY_INVARIANT.md
 * clause, driven through the real pay() HTTP endpoint (task 1.7) wherever
 * that's actually possible.
 *
 * Not every clause is HTTP-reachable, and that's by design, not a gap in
 * this suite: apps/broker/src/routes/pay.ts constructs the `payment`
 * object entirely by copying the looked-up capability's own fields
 * (amount, destination, resource, taskHash, session, paymentRequestHash),
 * so those 6 field-matching clauses (1-6) trivially hold "by construction"
 * on every real HTTP request — there is no field in the sandbox-facing
 * PayRequest ({ capabilityId } only) that could ever populate a mismatched
 * value. This matches SECURITY_INVARIANT.md clause 2's own note that
 * substitution is "mostly a backstop against a compromised or buggy
 * Broker construction path, not against the agent itself." So clauses
 * 1-6 below are tested by calling authorize() directly with a
 * deliberately mismatched PaymentAuthorizationRequest, which is the only
 * way to actually exercise that backstop; clauses 7-9 (replay, stale
 * nonce, over-budget) depend on DB state, not request-body content, so
 * they're reachable — and are tested — through the real HTTP endpoint.
 */

async function postPay(capabilityId: unknown) {
  return app.request("/pay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capabilityId }),
  });
}

function setUpCapabilityRecord(
  overrides: { price?: string; maxTotalSpend?: string; session?: string } = {},
) {
  const taskDefinition = { id: randomUUID() };
  const realTaskHash = hashCanonical(taskDefinition);
  const resourceId = randomUUID();
  const price = overrides.price ?? "10.00";
  const session = overrides.session ?? "sandbox-public-key";

  seedRegistry([{ resourceId, recipient: "0xRECIPIENT", price }]);
  createTask(realTaskHash, overrides.maxTotalSpend ?? "100.00");

  const issued = issueCapability({
    taskDefinition,
    resourceId,
    exactAmount: price,
    paymentRequest: { detail: "property-test" },
    session,
  });

  const record = getCapabilityRecord(issued.capabilityId);
  if (record === undefined) throw new Error("expected capability record to exist");
  const task = getTask(realTaskHash);
  if (task === undefined) throw new Error("expected task to exist");

  const validPayment: PaymentAuthorizationRequest = {
    amount: record.capability.exactAmount,
    destination: record.capability.recipient,
    resource: record.capability.resourceId,
    taskHash: record.capability.taskHash,
    session: record.capability.session,
    paymentRequestHash: record.capability.paymentRequestHash,
  };

  return { capability: record.capability, task, validPayment, capabilityId: issued.capabilityId };
}

function expireCapability(capabilityId: string) {
  db.prepare("UPDATE capabilities SET expiry = ? WHERE capability_id = ?").run(
    new Date(Date.now() - 60_000).toISOString(),
    capabilityId,
  );
}

describe("property: replay", () => {
  it("paying the same capabilityId a second time returns REPLAY, not a generic failure", async () => {
    const { capabilityId } = setUpCapabilityRecord();

    const first = await postPay(capabilityId);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { state: { status: string } };
    expect(firstBody.state.status).toBe("SUBMITTED");

    const second = await postPay(capabilityId);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ authorized: false, reason: "REPLAY" });
  });
});

describe("property: substitution", () => {
  // Tested via authorize() directly, not the HTTP layer — see the file-level
  // comment above. SECURITY_INVARIANT.md clause 2 ("Substitution"): "this
  // clause is mostly a backstop against a compromised or buggy Broker
  // construction path, not against the agent itself," since pay()'s own
  // construction always copies `destination` from the looked-up capability.
  it("payment.destination !== capability.recipient returns SUBSTITUTION", () => {
    const { capability, task, validPayment } = setUpCapabilityRecord();
    const payment = { ...validPayment, destination: "0xATTACKER" };

    expect(authorize({ payment, capability, task })).toEqual({
      authorized: false,
      reason: "SUBSTITUTION",
    });
  });
});

describe("property: resource mismatch (task 1.8's 'escalation' case)", () => {
  // docs/TASKS.md's task 1.8 line lists "escalation" among the cases to
  // test, but docs/THREAT_MODEL.md ("Escalation is not one of the
  // Broker's invariant clauses") and SECURITY_INVARIANT.md clause 3 are
  // explicit that escalation is an agent/sandbox-layer UX decision, not a
  // Broker.authorize outcome — there is no ESCALATED state. An
  // out-of-registry/different-resource payment attempt that reaches
  // authorize() anyway simply hard-fails as RESOURCE_MISMATCH; it does
  // not escalate. Tested via authorize() directly for the same reason as
  // substitution above: pay()'s own construction always copies `resource`
  // from the looked-up capability, so this is unreachable via the real
  // HTTP request body.
  it("payment.resource !== capability.resourceId returns RESOURCE_MISMATCH", () => {
    const { capability, task, validPayment } = setUpCapabilityRecord();
    const payment = { ...validPayment, resource: randomUUID() };

    expect(authorize({ payment, capability, task })).toEqual({
      authorized: false,
      reason: "RESOURCE_MISMATCH",
    });
  });
});

describe("property: stale nonce", () => {
  it("paying an expired capability returns STALE_NONCE via the real HTTP endpoint", async () => {
    const { capabilityId } = setUpCapabilityRecord();
    expireCapability(capabilityId);

    const res = await postPay(capabilityId);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authorized: false, reason: "STALE_NONCE" });
  });
});

describe("property: session mismatch", () => {
  // Tested via authorize() directly — pay()'s own construction always
  // copies `session` from the looked-up capability, so this mismatch is
  // unreachable via the real HTTP request body (the same "backstop, not
  // an agent-facing path" reasoning as substitution above).
  it("payment.session !== capability.session returns SESSION_MISMATCH", () => {
    const { capability, task, validPayment } = setUpCapabilityRecord();
    const payment = { ...validPayment, session: "a-different-session-key" };

    expect(authorize({ payment, capability, task })).toEqual({
      authorized: false,
      reason: "SESSION_MISMATCH",
    });
  });
});

describe("property: task_hash mismatch", () => {
  // Tested via authorize() directly, for the same reason as session
  // mismatch above.
  it("payment.taskHash !== capability.taskHash returns TASK_HASH_MISMATCH", () => {
    const { capability, task, validPayment } = setUpCapabilityRecord();
    const payment = { ...validPayment, taskHash: randomUUID() };

    expect(authorize({ payment, capability, task })).toEqual({
      authorized: false,
      reason: "TASK_HASH_MISMATCH",
    });
  });
});

describe("property: amount mismatch", () => {
  // Not explicitly named in task 1.8's list, but one of the 9 clauses —
  // included for full invariant coverage, per this suite's stated
  // purpose. Tested via authorize() directly, for the same reason as the
  // other field-matching clauses above.
  it("payment.amount !== capability.exactAmount returns AMOUNT_MISMATCH", () => {
    const { capability, task, validPayment } = setUpCapabilityRecord();
    const payment = { ...validPayment, amount: "999999.00" };

    expect(authorize({ payment, capability, task })).toEqual({
      authorized: false,
      reason: "AMOUNT_MISMATCH",
    });
  });
});

describe("property: request forgery", () => {
  // Not explicitly named in task 1.8's list, but one of the 9 clauses —
  // included for full invariant coverage. Tested via authorize()
  // directly, for the same reason as the other field-matching clauses
  // above. destination/amount are left unchanged so this is distinctly a
  // request-forgery case, not a substitution case.
  it("payment.paymentRequestHash !== capability.paymentRequestHash returns REQUEST_FORGERY", () => {
    const { capability, task, validPayment } = setUpCapabilityRecord();
    const payment = { ...validPayment, paymentRequestHash: randomUUID() };

    expect(authorize({ payment, capability, task })).toEqual({
      authorized: false,
      reason: "REQUEST_FORGERY",
    });
    expect(payment.destination).toBe(validPayment.destination);
    expect(payment.amount).toBe(validPayment.amount);
  });
});

describe("property: concurrent double-spend on the same task budget", () => {
  it("of 5 concurrently paid capabilities against a task with room for exactly one, exactly one succeeds and the other 4 return BUDGET_EXCEEDED", async () => {
    const taskDefinition = { scenario: "concurrent-double-spend", id: randomUUID() };
    const realTaskHash = hashCanonical(taskDefinition);
    createTask(realTaskHash, "10");

    const capabilityIds = Array.from({ length: 5 }, () => {
      const resourceId = randomUUID();
      seedRegistry([{ resourceId, recipient: "0xRECIPIENT", price: "10" }]);
      const issued = issueCapability({
        taskDefinition,
        resourceId,
        exactAmount: "10",
        paymentRequest: { detail: "concurrent-double-spend" },
        session: "sandbox-public-key",
      });
      return issued.capabilityId;
    });

    const responses = await Promise.all(capabilityIds.map((capabilityId) => postPay(capabilityId)));
    const bodies = (await Promise.all(responses.map((res) => res.json()))) as Array<
      { state: { status: string } } | { authorized: false; reason: string }
    >;

    const successes = bodies.filter(
      (body): body is { state: { status: string } } => "state" in body && body.state.status === "SUBMITTED",
    );
    const budgetExceeded = bodies.filter(
      (body) => "authorized" in body && body.authorized === false && body.reason === "BUDGET_EXCEEDED",
    );

    expect(successes).toHaveLength(1);
    expect(budgetExceeded).toHaveLength(4);
  });
});

describe("property: malformed capability_id", () => {
  it("a capabilityId that fails payRequestSchema's branded-string validation returns 400", async () => {
    const res = await app.request("/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capabilityId: 12345 }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_capability_id");
  });

  it("a missing capabilityId field returns 400", async () => {
    const res = await app.request("/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_capability_id");
  });
});

describe("property: unknown capability_id", () => {
  it("a syntactically valid but never-issued capabilityId returns 404", async () => {
    const unknownId = randomUUID();

    const res = await postPay(unknownId);

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; capabilityId: string };
    expect(body.error).toBe("capability_not_found");
    expect(body.capabilityId).toBe(unknownId);
  });
});
