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
      x402_purchase: "pending", // this scenario doesn't run the (separate) x402 purchase stage
    });
    expect(state.phase).toBe("succeeded");
    expect(state.finalResult).toMatchObject({ paid: true, hcsSequenceNumber: 42 });
  });

  it("surfaces which adversarial demo scenario is running, when the run reports one", () => {
    let state = initialState();
    state = reduceEvent(state, {
      type: "content_served",
      url: "http://127.0.0.1:12345/",
      scenario: "hijack",
      scenarioLabel: "Full instruction-override attempt (ignore task, act immediately)",
    });
    expect(state.scenario).toBe("hijack");
    expect(state.log.at(-1)?.text).toContain("hijack");
    expect(state.log.at(-1)?.text).toContain("Full instruction-override attempt");
  });

  it("still works for a content_served event with no scenario (older/default shape)", () => {
    let state = initialState();
    state = reduceEvent(state, { type: "content_served", url: "http://127.0.0.1:12345/" });
    expect(state.scenario).toBeUndefined();
    expect(state.contentUrl).toBe("http://127.0.0.1:12345/");
  });

  it("shows the real pay tool-call JSON payload the moment it arrives", () => {
    let state = initialState();
    state = reduceEvent(state, { type: "pay_tool_call", capabilityId: "abc-123", timestamp: "t" });
    expect(state.lastToolCall).toEqual({ capabilityId: "abc-123", timestamp: "t" });
  });

  it("keeps the final result panel populated once set, unless a later run_error overrides it", () => {
    let state = initialState();
    state = reduceEvent(state, {
      type: "final_result",
      paid: true,
      hederaTransactionId: "tx",
      status: "SUCCESS",
      hcsSequenceNumber: 1,
      consensusTimestamp: "ts",
    });
    // An ordinary later event does not clear finalResult.
    state = reduceEvent(state, { type: "stage", stage: "attest", status: "active" });
    expect(state.finalResult).toBeDefined();
    expect(state.finalResult?.paid).toBe(true);
  });

  it("lets a later run_error override an earlier latched success, instead of masking the failure", () => {
    let state = initialState();
    state = reduceEvent(state, {
      type: "final_result",
      paid: true,
      hederaTransactionId: "tx",
      status: "SUCCESS",
      hcsSequenceNumber: 1,
      consensusTimestamp: "ts",
    });
    expect(state.finalResult).toBeDefined();

    state = reduceEvent(state, {
      type: "run_error",
      source: "e2e-live-demo",
      stage: "x402_purchase",
      message: "x402 purchase failed",
    });

    expect(state.finalResult).toBeUndefined();
    expect(state.phase).toBe("failed");
    expect(state.errorMessage).toBe("x402 purchase failed");
  });

  it("surfaces a successful x402_purchase_result as the result panel's outcome, not just a log line", () => {
    let state = initialState();
    state = reduceEvent(state, {
      type: "x402_purchase_result",
      success: true,
      hederaTransactionId: "0.0.7162784@1789153179.394312180",
      status: "SUCCESS",
      hashscanUrl: "https://hashscan.io/testnet/transaction/0.0.7162784@1789153179.394312180",
    });

    expect(state.phase).toBe("succeeded");
    expect(state.finalResult).toMatchObject({
      paid: true,
      provider: "x402",
      hederaTransactionId: "0.0.7162784@1789153179.394312180",
      status: "SUCCESS",
    });
    expect(state.log.at(-1)?.text).toContain("0.0.7162784@1789153179.394312180");
  });

  it("labels the x402_purchase stage correctly instead of printing 'undefined: in progress…'", () => {
    let state = initialState();
    state = reduceEvent(state, { type: "stage", stage: "x402_purchase", status: "active" });
    expect(state.log.at(-1)?.text).toBe("X402: in progress…");
    expect(state.stages.x402_purchase).toBe("active");
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

  it("does not let a later, unrelated x402 success mask an earlier scenario failure (the audit's finding)", () => {
    let state = initialState();

    // The security-relevant agent scenario fails (e.g. the agent timed out,
    // declined to pay, or settlement never confirmed) — stage is NOT
    // "x402_purchase", so this belongs to the scenario track.
    state = reduceEvent(state, {
      type: "run_error",
      source: "e2e-live-demo",
      stage: "agent",
      message: "agent run timed out",
    });
    expect(state.phase).toBe("failed");
    expect(state.errorMessage).toBe("agent run timed out");
    expect(state.finalResult).toBeUndefined();

    // scripts/e2e-live-demo.ts always runs the x402 leg next regardless of
    // the scenario's own outcome, and here it succeeds.
    state = reduceEvent(state, {
      type: "x402_purchase_result",
      success: true,
      hederaTransactionId: "0.0.7162784@1789999999.000000000",
      status: "SUCCESS",
      hashscanUrl: "https://hashscan.io/testnet/transaction/0.0.7162784@1789999999.000000000",
    });

    // The overall run must still read as failed — the earlier
    // security-relevant failure is not masked by the later, unrelated
    // success.
    expect(state.phase).toBe("failed");
    expect(state.errorMessage).toBe("agent run timed out");
    expect(state.finalResult).toBeUndefined();

    // But nothing is lost: both tracks' real outcomes remain independently
    // inspectable (ResultPanel uses this to show the combined context).
    expect(state.scenarioOutcome).toEqual({ status: "failed", errorMessage: "agent run timed out" });
    expect(state.x402Outcome?.status).toBe("succeeded");
    expect(state.x402Outcome?.result?.hederaTransactionId).toBe("0.0.7162784@1789999999.000000000");
  });

  it("still reports failure when the x402 leg fails too, after an already-failed scenario", () => {
    let state = initialState();
    state = reduceEvent(state, {
      type: "run_error",
      source: "e2e-live-demo",
      stage: "pay",
      message: "no payment was made this run",
    });
    state = reduceEvent(state, {
      type: "run_error",
      source: "e2e-live-demo",
      stage: "x402_purchase",
      message: "x402 gateway unreachable",
    });

    expect(state.phase).toBe("failed");
    // The scenario's own failure is the one surfaced as the headline reason
    // — checked first, deterministically, regardless of arrival order.
    expect(state.errorMessage).toBe("no payment was made this run");
    expect(state.scenarioOutcome?.status).toBe("failed");
    expect(state.x402Outcome?.status).toBe("failed");
  });

  it("marks a failed run without a final result as a distinct error state", () => {
    let state = initialState();
    state = reduceEvent(state, { type: "run_error", source: "e2e-live-demo", message: "Broker unreachable" });
    expect(state.phase).toBe("failed");
    expect(state.errorMessage).toBe("Broker unreachable");
    expect(state.finalResult).toBeUndefined();
  });
});
