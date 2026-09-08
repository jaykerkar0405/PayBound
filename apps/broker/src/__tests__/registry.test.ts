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
  it("seeds a valid entry and looks it up by resourceId", () => {
    const entry = makeEntry();

    seedRegistry([entry]);

    expect(getResourceById(entry.resourceId)).toEqual(entry);
  });

  it("returns undefined for a resourceId that was never seeded", () => {
    expect(getResourceById(randomUUID())).toBeUndefined();
  });

  it("fails to seed two entries with the same resourceId", () => {
    const resourceId = randomUUID();
    seedRegistry([makeEntry({ resourceId })]);

    expect(() => seedRegistry([makeEntry({ resourceId })])).toThrow();

    // The original entry is untouched, not overwritten or duplicated.
    expect(getResourceById(resourceId)).toEqual(makeEntry({ resourceId }));
  });

  it("throws on an entry that fails schema validation, before any write occurs", () => {
    const resourceId = randomUUID();
    const invalidEntry = { resourceId, recipient: "0xRECIPIENT" } as never;

    expect(() => seedRegistry([invalidEntry])).toThrow();
    expect(getResourceById(resourceId)).toBeUndefined();
  });

  it("round-trips price as a string, preserving exact value", () => {
    const entry = makeEntry({ price: "0.10" });

    seedRegistry([entry]);
    const result = getResourceById(entry.resourceId);

    expect(typeof result?.price).toBe("string");
    expect(result?.price).toBe("0.10");
  });
});
