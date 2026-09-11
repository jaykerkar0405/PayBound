import { describe, it, expect } from "vitest";
import { initialState, reduceEvent, STAGE_ORDER } from "../state.js";
import type { PbEvent } from "../events.js";

describe("reduceEvent", () => {
  it("starts every stage pending", () => {
    const state = initialState();
    for (const stage of STAGE_ORDER) {
      expect(state.stages[stage]).toBe("pending");
    }
  });

  it("tracks the full real e2e:live stage sequence in order (Attest -> Issue -> Agent -> Pay -> Settle -> HCS)", () => {
    let state = initialState();
    const events: PbEvent[] = [
      { type: "run_started" },
      { type: "stage", stage: "attest", status: "active" },
      { type: "stage", stage: "attest", status: "done" },
      { type: "stage", stage: "issue", status: "active" },
      { type: "capability_issued", capabilityId: "961c4a38-94b6-4b8c-9392-9fae2e5423af" },
      { type: "stage", stage: "issue", status: "done" },
      { type: "stage", stage: "agent", status: "active" },
      { type: "pay_tool_call", capabilityId: "961c4a38-94b6-4b8c-9392-9fae2e5423af", timestamp: "t" },
      { type: "payment_outcome", provider: "gemini", capabilityId: "961c4a38-94b6-4b8c-9392-9fae2e5423af", paid: true },
      { type: "stage", stage: "settle", status: "active" },
      {
        type: "settlement_found",
        status: "SUCCESS",
        hederaTransactionId: "0.0.10421552@1789060641.584955378",
        consensusTimestamp: "1789060649.198800104",
        sequenceNumber: 42,
      },
      { type: "stage", stage: "settle", status: "done" },
      { type: "stage", stage: "hcs", status: "active" },
      { type: "mirror_confirmed", outcome: "settled", status: "SUCCESS", hashscanUrl: "https://hashscan.io/testnet/transaction/x" },
      { type: "stage", stage: "hcs", status: "done" },
      {
        type: "final_result",
        paid: true,
        provider: "gemini",
        capabilityId: "961c4a38-94b6-4b8c-9392-9fae2e5423af",
        hederaTransactionId: "0.0.10421552@1789060641.584955378",
        status: "SUCCESS",
        hcsSequenceNumber: 42,
        consensusTimestamp: "1789060649.198800104",
        hashscanUrl: "https://hashscan.io/testnet/transaction/x",
      },
    ];

    for (const event of events) {
      state = reduceEvent(state, event);
    }

    expect(state.stages).toEqual({
      attest: "done",
      issue: "done",
      agent: "done", // pay_tool_call marks agent done
      pay: "done",
      settle: "done",
      hcs: "done",
    });
    expect(state.phase).toBe("succeeded");
    expect(state.finalResult).toMatchObject({ paid: true, hcsSequenceNumber: 42 });
  });

  it("shows the real pay tool-call JSON payload the moment it arrives", () => {
    let state = initialState();
    state = reduceEvent(state, { type: "pay_tool_call", capabilityId: "abc-123", timestamp: "t" });
    expect(state.lastToolCall).toEqual({ capabilityId: "abc-123", timestamp: "t" });
  });

  it("keeps the final result panel populated permanently once set", () => {
    let state = initialState();
    state = reduceEvent(state, {
      type: "final_result",
      paid: true,
      hederaTransactionId: "tx",
      status: "SUCCESS",
      hcsSequenceNumber: 1,
      consensusTimestamp: "ts",
    });
    // No later event clears finalResult once set.
    state = reduceEvent(state, { type: "stage", stage: "attest", status: "active" });
    expect(state.finalResult).toBeDefined();
    expect(state.finalResult?.paid).toBe(true);
  });

  it("caps the event log at the last 10 lines without dropping the most recent ones", () => {
    let state = initialState();
    for (let i = 0; i < 25; i++) {
      state = reduceEvent(state, { type: "run_error", source: "test", message: `err-${i}` });
    }
    expect(state.log).toHaveLength(10);
    expect(state.log.at(-1)?.text).toContain("err-24");
  });

  it("handles a burst of rapid successive events (authorization + settlement close together) without dropping any", () => {
    let state = initialState();
    const burst: PbEvent[] = [
      { type: "payment_outcome", provider: "gemini", paid: true },
      { type: "stage", stage: "settle", status: "active" },
      {
        type: "settlement_found",
        status: "SUCCESS",
        hederaTransactionId: "tx",
        consensusTimestamp: "ts",
        sequenceNumber: 7,
      },
      { type: "stage", stage: "settle", status: "done" },
    ];
    for (const event of burst) state = reduceEvent(state, event);
    expect(state.stages.pay).toBe("done");
    expect(state.stages.settle).toBe("done");
    expect(state.log.some((l) => l.text.includes("seq=7"))).toBe(true);
  });

  it("marks a failed run without a final result as a distinct error state", () => {
    let state = initialState();
    state = reduceEvent(state, { type: "run_error", source: "e2e-live-demo", message: "Broker unreachable" });
    expect(state.phase).toBe("failed");
    expect(state.errorMessage).toBe("Broker unreachable");
    expect(state.finalResult).toBeUndefined();
  });
});
