import { describe, expect, it, vi } from "vitest";
import { auditCapabilityIssued, auditAuthorizationDecision } from "../hcs-audit.js";

const capabilityIssuedEvent = {
  eventType: "capability_issued" as const,
  timestamp: "2026-01-01T00:00:00.000Z",
  taskHash: "task-hash",
  resourceId: "resource-id",
  recipient: "0xRECIPIENT",
  exactAmount: "10.00",
  paymentRequestHash: "request-hash",
  session: "session-key",
  expiry: "2026-01-01T00:05:00.000Z",
};

const authorizationDecisionEvent = {
  eventType: "authorization_decision" as const,
  timestamp: "2026-01-01T00:00:00.000Z",
  taskHash: "task-hash",
  resourceId: "resource-id",
  authorized: true,
  reason: null,
};

describe("auditCapabilityIssued", () => {
  it("calls the injected logger with exactly the given event", async () => {
    const logFn = vi.fn().mockResolvedValue({ transactionId: "0.0.1@1.1" });

    await auditCapabilityIssued(capabilityIssuedEvent, logFn);

    expect(logFn).toHaveBeenCalledExactlyOnceWith(capabilityIssuedEvent);
  });

  it("catches a rejection from the logger instead of throwing (HCS logging is optional, non-load-bearing)", async () => {
    const logFn = vi.fn().mockRejectedValue(new Error("HCS topic ID is missing"));

    await expect(auditCapabilityIssued(capabilityIssuedEvent, logFn)).resolves.toBeUndefined();
  });
});

describe("auditAuthorizationDecision", () => {
  it("calls the injected logger with exactly the given event", async () => {
    const logFn = vi.fn().mockResolvedValue({ transactionId: "0.0.1@1.1" });

    await auditAuthorizationDecision(authorizationDecisionEvent, logFn);

    expect(logFn).toHaveBeenCalledExactlyOnceWith(authorizationDecisionEvent);
  });

  it("catches a rejection from the logger instead of throwing", async () => {
    const logFn = vi.fn().mockRejectedValue(new Error("network error"));

    await expect(auditAuthorizationDecision(authorizationDecisionEvent, logFn)).resolves.toBeUndefined();
  });
});
