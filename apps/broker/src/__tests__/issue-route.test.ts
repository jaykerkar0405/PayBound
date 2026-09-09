import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { app } from "../index.js";
import { seedRegistry } from "../registry.js";

async function postIssue(body: unknown) {
  return app.request("/issue", {
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
