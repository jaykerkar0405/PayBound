import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { app } from "../index.js";
import { db } from "../db.js";
import { seedRegistry } from "../registry.js";
import { createTask } from "../budget.js";
import { issueCapability } from "../issuer.js";
import { hashCanonical } from "../hash.js";

async function postPay(body: unknown) {
  return app.request("/pay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setUpCapability(overrides: { price?: string; maxTotalSpend?: string } = {}) {
  const taskHash = hashCanonical(randomUUID());
  const resourceId = randomUUID();
  const price = overrides.price ?? "10.00";

  seedRegistry([{ resourceId, recipient: "0xRECIPIENT", price }]);
  createTask(hashCanonical({ taskHash }), overrides.maxTotalSpend ?? "100.00");

  const issued = issueCapability({
    taskDefinition: { taskHash },
    resourceId,
    exactAmount: price,
    paymentRequest: { detail: "test" },
    session: "sandbox-public-key",
  });

  return issued.capabilityId;
}

function expireCapability(capabilityId: string) {
  db.prepare("UPDATE capabilities SET expiry = ? WHERE capability_id = ?").run(
    new Date(Date.now() - 60_000).toISOString(),
    capabilityId,
  );
}

function containsKey(value: unknown, key: string): boolean {
  if (value === null || typeof value !== "object") return false;
  for (const [k, v] of Object.entries(value)) {
    if (k === key) return true;
    if (containsKey(v, key)) return true;
  }
  return false;
}

describe("POST /pay", () => {
  it("returns 400 with invalid_capability_id for a malformed capabilityId (wrong type)", async () => {
    const res = await postPay({ capabilityId: 12345 });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("invalid_capability_id");
    expect(typeof body.message).toBe("string");
  });

  it("returns 400 with invalid_capability_id when capabilityId is missing entirely", async () => {
    const res = await postPay({});

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_capability_id");
  });

  it("returns 404 with capability_not_found for a well-formed but unknown capabilityId", async () => {
    const unknownId = randomUUID();
    const res = await postPay({ capabilityId: unknownId });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; capabilityId: string };
    expect(body.error).toBe("capability_not_found");
    expect(body.capabilityId).toBe(unknownId);
  });

  it("returns 200 with a SUBMITTED state for a valid, freshly issued capability, with the reservedFrom/issuedFrom chain present", async () => {
    const capabilityId = setUpCapability();

    const res = await postPay({ capabilityId });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      state: { status: string; reservedFrom: { status: string; issuedFrom: { status: string } } };
    };
    expect(body.state.status).toBe("SUBMITTED");
    expect(body.state.reservedFrom.status).toBe("RESERVED");
    expect(body.state.reservedFrom.issuedFrom.status).toBe("ISSUED");
  });

  it("returns 200 with REPLAY when the same capabilityId is posted a second time", async () => {
    const capabilityId = setUpCapability();
    await postPay({ capabilityId });

    const res = await postPay({ capabilityId });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authorized: false, reason: "REPLAY" });
  });

  it("returns 200 with STALE_NONCE for an expired capability", async () => {
    const capabilityId = setUpCapability();
    expireCapability(capabilityId);

    const res = await postPay({ capabilityId });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authorized: false, reason: "STALE_NONCE" });
  });

  it("returns 200 with BUDGET_EXCEEDED when the task's budget is already exhausted", async () => {
    const capabilityId = setUpCapability({ price: "10.00", maxTotalSpend: "5.00" });

    const res = await postPay({ capabilityId });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authorized: false, reason: "BUDGET_EXCEEDED" });
  });

  it("never includes a nonce field anywhere in a successful pay response (regression guard — enforced structurally by PublicPaymentState/publicSubmittedPaymentStateSchema, not a runtime strip step)", async () => {
    const capabilityId = setUpCapability();

    const res = await postPay({ capabilityId });
    const body: unknown = await res.json();

    expect(containsKey(body, "nonce")).toBe(false);
  });
});
