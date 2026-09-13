import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { capabilityIdSchema } from "@paybound/capability-spec";
import { seedRegistry } from "../registry.js";
import { getCapabilityRecord, issueCapability, type IssueCapabilityInput } from "../issuer.js";

async function seedResource(overrides: Partial<{ resourceId: string; recipient: string; price: string }> = {}) {
  const entry = {
    resourceId: overrides.resourceId ?? randomUUID(),
    recipient: overrides.recipient ?? "0xRECIPIENT",
    price: overrides.price ?? "10.00",
  };
  await seedRegistry([entry]);
  return entry;
}

function makeInput(overrides: Partial<IssueCapabilityInput> = {}): IssueCapabilityInput {
  return {
    taskDefinition: { goal: "buy a widget" },
    resourceId: overrides.resourceId ?? "",
    exactAmount: overrides.exactAmount ?? "10.00",
    paymentRequest: { detail: "widget purchase" },
    session: overrides.session ?? "sandbox-public-key",
  };
}

describe("issueCapability", () => {
  it("succeeds against a registered resource and returns a well-formed capabilityId + expiry", async () => {
    const resource = await seedResource();

    const result = await issueCapability(makeInput({ resourceId: resource.resourceId, exactAmount: resource.price }));

    expect(() => capabilityIdSchema.parse(result.capabilityId)).not.toThrow();
    expect(typeof result.expiry).toBe("string");
    expect(new Date(result.expiry).toString()).not.toBe("Invalid Date");
  });

  it("throws when the resourceId does not exist in the registry", async () => {
    await expect(
      issueCapability(makeInput({ resourceId: randomUUID(), exactAmount: "10.00" })),
    ).rejects.toThrow();
  });

  it("throws when exactAmount does not match the registry entry's price", async () => {
    const resource = await seedResource({ price: "10.00" });

    await expect(
      issueCapability(makeInput({ resourceId: resource.resourceId, exactAmount: "999.00" })),
    ).rejects.toThrow();
  });

  it("persists a capability with maxUses === 1", async () => {
    const resource = await seedResource();
    const result = await issueCapability(makeInput({ resourceId: resource.resourceId, exactAmount: resource.price }));

    const record = await getCapabilityRecord(result.capabilityId);
    expect(record?.capability.maxUses).toBe(1);
  });

  it("persists a short, fixed-TTL expiry (within 10 minutes of issuance)", async () => {
    const resource = await seedResource();
    const before = Date.now();
    const result = await issueCapability(makeInput({ resourceId: resource.resourceId, exactAmount: resource.price }));

    const expiryMs = new Date(result.expiry).getTime();
    expect(expiryMs).toBeGreaterThan(before);
    expect(expiryMs - before).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it("never uses the same value for nonce and capabilityId", async () => {
    const resource = await seedResource();
    const result = await issueCapability(makeInput({ resourceId: resource.resourceId, exactAmount: resource.price }));

    const record = await getCapabilityRecord(result.capabilityId);
    expect(record?.capability.nonce).not.toBe(result.capabilityId);
  });

  it("produces distinct nonce and capabilityId values across separate issuances of the same input", async () => {
    const resource = await seedResource();
    const input = makeInput({ resourceId: resource.resourceId, exactAmount: resource.price });

    const first = await issueCapability(input);
    const second = await issueCapability(input);

    expect(first.capabilityId).not.toBe(second.capabilityId);
    const firstRecord = await getCapabilityRecord(first.capabilityId);
    const secondRecord = await getCapabilityRecord(second.capabilityId);
    expect(firstRecord?.capability.nonce).not.toBe(secondRecord?.capability.nonce);
  });

  it("sets recipient from the registry entry, not any caller-supplied value (issueCapability accepts no recipient input)", async () => {
    const resource = await seedResource({ recipient: "0xREGISTRY_RECIPIENT" });
    const input = makeInput({ resourceId: resource.resourceId, exactAmount: resource.price });

    expect("recipient" in input).toBe(false);

    const result = await issueCapability(input);
    const record = await getCapabilityRecord(result.capabilityId);
    expect(record?.capability.recipient).toBe("0xREGISTRY_RECIPIENT");
  });

  it("produces and persists a stub signature alongside the capability record", async () => {
    const resource = await seedResource();
    const result = await issueCapability(makeInput({ resourceId: resource.resourceId, exactAmount: resource.price }));

    const record = await getCapabilityRecord(result.capabilityId);
    expect(typeof record?.signature).toBe("string");
    expect(record?.signature.length).toBeGreaterThan(0);
  });

  it("fires the HCS capability_issued audit event with the persisted capability's fields, excluding nonce (task 4.2)", async () => {
    const resource = await seedResource({ recipient: "0xAUDIT_RECIPIENT" });
    const auditFn = vi.fn().mockResolvedValue(undefined);

    const result = await issueCapability(
      makeInput({ resourceId: resource.resourceId, exactAmount: resource.price }),
      auditFn,
    );
    const record = await getCapabilityRecord(result.capabilityId);

    expect(auditFn).toHaveBeenCalledTimes(1);
    const [event] = auditFn.mock.calls[0] as [Record<string, unknown>];
    expect(event).toMatchObject({
      eventType: "capability_issued",
      taskHash: record?.capability.taskHash,
      resourceId: resource.resourceId,
      recipient: "0xAUDIT_RECIPIENT",
      exactAmount: resource.price,
      paymentRequestHash: record?.capability.paymentRequestHash,
      session: record?.capability.session,
      expiry: result.expiry,
    });
    expect(event).not.toHaveProperty("nonce");
  });

  it("does not fire the HCS audit event when issuance fails validation", async () => {
    const auditFn = vi.fn().mockResolvedValue(undefined);

    await expect(issueCapability(makeInput({ resourceId: randomUUID() }), auditFn)).rejects.toThrow();

    expect(auditFn).not.toHaveBeenCalled();
  });
});
