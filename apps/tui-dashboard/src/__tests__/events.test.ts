import { describe, it, expect } from "vitest";
import { parseLine } from "../events.js";

describe("parseLine", () => {
  it("parses a bare PB_TUI_EVENT line", () => {
    const event = parseLine('PB_TUI_EVENT {"type":"run_started"}');
    expect(event).toEqual({ type: "run_started" });
  });

  it("parses a PB_TUI_EVENT line forwarded through e2e-live-demo.ts's [sandbox] prefix", () => {
    const event = parseLine(
      '  [sandbox] PB_TUI_EVENT {"type":"pay_tool_call","capabilityId":"961c4a38-94b6-4b8c-9392-9fae2e5423af","timestamp":"2026-09-11T00:00:00.000Z"}',
    );
    expect(event).toEqual({
      type: "pay_tool_call",
      capabilityId: "961c4a38-94b6-4b8c-9392-9fae2e5423af",
      timestamp: "2026-09-11T00:00:00.000Z",
    });
  });

  it("returns undefined for ordinary human-readable output lines", () => {
    expect(parseLine("[1/6] Pre-flight checks...")).toBeUndefined();
    expect(parseLine("  Broker reachable at http://127.0.0.1:3000.")).toBeUndefined();
    expect(parseLine("")).toBeUndefined();
  });

  it("returns undefined for malformed JSON after the marker rather than throwing", () => {
    expect(() => parseLine("PB_TUI_EVENT {not json")).not.toThrow();
    expect(parseLine("PB_TUI_EVENT {not json")).toBeUndefined();
  });

  it("returns undefined for a well-formed but unrecognized event type", () => {
    expect(parseLine('PB_TUI_EVENT {"type":"something_new"}')).toBeUndefined();
  });

  it("finds the marker regardless of what precedes it on the line", () => {
    const event = parseLine('some noise before it PB_TUI_EVENT {"type":"run_started"}');
    expect(event).toEqual({ type: "run_started" });
  });
});
