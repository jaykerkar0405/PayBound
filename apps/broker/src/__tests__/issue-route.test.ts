import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { app } from "../index.js";
import { seedRegistry } from "../registry.js";
import { getTask } from "../budget.js";
import { hashCanonical } from "../hash.js";

async function postIssue(body: unknown) {
  return app.request("/issue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postPay(body: unknown) {
  return app.request("/pay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Seeds one registry entry and returns its resourceId + price. */
function seedOne(price = "10.00") {
  const resourceId = randomUUID();
  seedRegistry([{ resourceId, recipient: "0xRECIPIENT", price }]);
  return { resourceId, price };
}

/** Minimal valid request body for POST /issue. */
function validBody(overrides: Partial<Record<string, unknown>> = {}) {
  const { resourceId, price } = seedOne();
  return {
    taskDefinition: { description: "test task" },
    resourceId,
    exactAmount: price,
    paymentRequest: { detail: "test" },
    session: "sandbox-public-key",
    ...overrides,
  };
}

describe("POST /issue", () => {
  it("returns 200 with capabilityId and expiry for a valid request", async () => {
    const res = await postIssue(validBody());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { capabilityId: string; expiry: string };
    expect(typeof body.capabilityId).toBe("string");
    expect(body.capabilityId.length).toBeGreaterThan(0);
    expect(typeof body.expiry).toBe("string");
    // expiry should be a future ISO timestamp
    expect(new Date(body.expiry).getTime()).toBeGreaterThan(Date.now());
  });

  it("returns 404 with unknown_resource when resourceId is not in the registry", async () => {
    const body = {
      taskDefinition: { description: "test" },
      resourceId: randomUUID(), // not seeded
      exactAmount: "10.00",
      paymentRequest: { detail: "test" },
      session: "sandbox-public-key",
    };

    const res = await postIssue(body);

    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string; message: string };
    expect(json.error).toBe("unknown_resource");
    expect(typeof json.message).toBe("string");
  });

  it("returns 422 with price_mismatch when exactAmount doesn't match the registry price", async () => {
    const { resourceId } = seedOne("10.00");
    const res = await postIssue({
      taskDefinition: { description: "test" },
      resourceId,
      exactAmount: "99.99", // wrong price
      paymentRequest: { detail: "test" },
      session: "sandbox-public-key",
    });

    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string; message: string };
    expect(json.error).toBe("price_mismatch");
    expect(typeof json.message).toBe("string");
  });

  it("returns 400 with invalid_request when the request body is malformed (missing required fields)", async () => {
    const res = await postIssue({ taskDefinition: { x: 1 } }); // missing resourceId, exactAmount, session

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; message: string };
    expect(json.error).toBe("invalid_request");
    expect(typeof json.message).toBe("string");
  });

  it("returns 400 with invalid_request when resourceId is not a valid UUID string", async () => {
    const { price } = seedOne();
    const res = await postIssue({
      taskDefinition: {},
      resourceId: 12345, // wrong type
      exactAmount: price,
      paymentRequest: {},
      session: "sandbox-public-key",
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("invalid_request");
  });
});

describe("POST /issue — task budget creation (task 6.x)", () => {
  it("creates a task budget synchronously, so the issued capability can immediately be paid end-to-end", async () => {
    // Unique taskDefinition: validBody()'s default is a fixed literal,
    // fine for issue-only tests but unsafe here since this test actually
    // pays — a fixed taskHash would collide with leftover spentSoFar from
    // a prior run of this same test against the shared broker.db file.
    const body = validBody({ taskDefinition: { description: "test task", nonce: randomUUID() } });

    const issueRes = await postIssue(body);
    expect(issueRes.status).toBe(200);
    const { capabilityId } = (await issueRes.json()) as { capabilityId: string };

    // The actual regression test for the bug: /pay used to throw looking
    // up a task budget row that was never created by /issue.
    const payRes = await postPay({ capabilityId });
    expect(payRes.status).toBe(200);
    const payBody = (await payRes.json()) as { state?: { status: string } };
    expect(payBody.state?.status).toBe("SUBMITTED");
  });

  it("a second /issue for the same task definition succeeds without re-creating or erroring, issuing against the already-funded task", async () => {
    const { resourceId, price } = seedOne("10.00");
    // Unique per test run: a fixed literal here would collide with
    // leftover DB state from a prior run of this same test against the
    // shared broker.db file (taskHash is a content hash, so identical
    // content always hashes to the same taskHash).
    const taskDefinition = { description: "shared task, issued against twice", nonce: randomUUID() };
    const body = {
      taskDefinition,
      resourceId,
      exactAmount: price,
      paymentRequest: { detail: "first" },
      session: "sandbox-public-key",
    };

    const firstRes = await postIssue(body);
    expect(firstRes.status).toBe(200);
    const { capabilityId: firstCapabilityId } = (await firstRes.json()) as { capabilityId: string };

    // Second /issue call for the identical taskDefinition -> identical
    // taskHash. Must succeed (not throw, not 500) and must NOT re-create
    // or re-fund the task — createTask()'s own PRIMARY KEY constraint
    // would throw on a naive unconditional second call.
    const secondRes = await postIssue({ ...body, paymentRequest: { detail: "second" } });
    expect(secondRes.status).toBe(200);
    const { capabilityId: secondCapabilityId } = (await secondRes.json()) as { capabilityId: string };

    expect(secondCapabilityId).not.toBe(firstCapabilityId);

    const taskHash = hashCanonical(taskDefinition);
    const task = getTask(taskHash);
    expect(task).toBeDefined();
    // The budget is exactly one resource's price, not doubled/re-funded
    // by the second /issue call.
    expect(task?.maxTotalSpend).toBe(price);
    expect(task?.spentSoFar).toBe("0");

    // Paying the first capability exhausts the shared budget; paying the
    // second capability against the same now-exhausted task correctly
    // hits BUDGET_EXCEEDED rather than a second free payment — confirms
    // the idempotent creation didn't silently grant extra budget.
    const firstPayRes = await postPay({ capabilityId: firstCapabilityId });
    expect(firstPayRes.status).toBe(200);
    const firstPayBody = (await firstPayRes.json()) as { state?: { status: string } };
    expect(firstPayBody.state?.status).toBe("SUBMITTED");

    const secondPayRes = await postPay({ capabilityId: secondCapabilityId });
    expect(secondPayRes.status).toBe(200);
    const secondPayBody = (await secondPayRes.json()) as { authorized?: boolean; reason?: string };
    expect(secondPayBody.authorized).toBe(false);
    expect(secondPayBody.reason).toBe("BUDGET_EXCEEDED");
  });
});
