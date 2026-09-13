import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getResourceById, seedRegistry } from "../registry.js";

function makeEntry(overrides: Partial<{ resourceId: string; recipient: string; price: string }> = {}) {
  return {
    resourceId: overrides.resourceId ?? randomUUID(),
    recipient: overrides.recipient ?? "0xRECIPIENT",
    price: overrides.price ?? "10.00",
  };
}

describe("registry", () => {
  it("seeds a valid entry and looks it up by resourceId", async () => {
    const entry = makeEntry();

    await seedRegistry([entry]);

    expect(await getResourceById(entry.resourceId)).toEqual(entry);
  });

  it("returns undefined for a resourceId that was never seeded", async () => {
    expect(await getResourceById(randomUUID())).toBeUndefined();
  });

  it("fails to seed two entries with the same resourceId", async () => {
    const resourceId = randomUUID();
    await seedRegistry([makeEntry({ resourceId })]);

    await expect(seedRegistry([makeEntry({ resourceId })])).rejects.toThrow();

    // The original entry is untouched, not overwritten or duplicated.
    expect(await getResourceById(resourceId)).toEqual(makeEntry({ resourceId }));
  });

  it("throws on an entry that fails schema validation, before any write occurs", async () => {
    const resourceId = randomUUID();
    const invalidEntry = { resourceId, recipient: "0xRECIPIENT" } as never;

    await expect(seedRegistry([invalidEntry])).rejects.toThrow();
    expect(await getResourceById(resourceId)).toBeUndefined();
  });

  it("round-trips price as a string, preserving exact value", async () => {
    const entry = makeEntry({ price: "0.10" });

    await seedRegistry([entry]);
    const result = await getResourceById(entry.resourceId);

    expect(typeof result?.price).toBe("string");
    expect(result?.price).toBe("0.10");
  });
});
