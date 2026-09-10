/**
 * Tests for the Chainlink CRE confidential spend-policy check (task 5.2).
 *
 * The two critical requirements from the task:
 * 1. CRE disabled / errors / unreachable → issuance STILL SUCCEEDS (the
 *    "non-load-bearing" / fail-open requirement).
 * 2. CRE enabled AND gateway explicitly denies → issuance is BLOCKED
 *    (so the check is not a no-op gate).
 *
 * All tests use the dep-injection pattern (no module mocking) — identical
 * to how settlement.test.ts tests settleAndRecord.
 */
import { describe, it, expect, vi } from "vitest";
import { checkSpendPolicy, type CrePolicyDeps } from "../cre-policy.js";

// ---------------------------------------------------------------------------
// Helper: build injectable deps
// ---------------------------------------------------------------------------

function fakeDeps(overrides: Partial<CrePolicyDeps> = {}): CrePolicyDeps {
  return {
    fetchFn: vi.fn(),
    isEnabled: () => false,
    gatewayUrl: () => undefined,
    ...overrides,
  };
}

function mockFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Gating — CRE disabled (the non-load-bearing requirement)
// ---------------------------------------------------------------------------

describe("checkSpendPolicy — gating (non-load-bearing requirement)", () => {
  it("returns allowed=true immediately when CRE is disabled, without calling the gateway", async () => {
    const fetchFn = vi.fn();
    const result = await checkSpendPolicy("res-1", "0.10", fakeDeps({ fetchFn, isEnabled: () => false }));

    expect(result.allowed).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled(); // no network call at all
  });

  it("returns allowed=true when CRE_ENABLED=true but CRE_GATEWAY_URL is not set", async () => {
    const fetchFn = vi.fn();
    const result = await checkSpendPolicy(
      "res-1", "0.10",
      fakeDeps({ fetchFn, isEnabled: () => true, gatewayUrl: () => undefined }),
    );

    expect(result.allowed).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns allowed=true when CRE_ENABLED=true but CRE_GATEWAY_URL is empty string", async () => {
    const result = await checkSpendPolicy(
      "res-1", "0.10",
      fakeDeps({ isEnabled: () => true, gatewayUrl: () => "" }),
    );
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error paths — all must fail-open (issuance must continue)
// ---------------------------------------------------------------------------

describe("checkSpendPolicy — fail-open on all error paths", () => {
  const enabledDeps = (fetchFn: typeof fetch) =>
    fakeDeps({ fetchFn, isEnabled: () => true, gatewayUrl: () => "https://cre.example.com/policy" });

  it("returns allowed=true when the gateway throws (network error / unreachable)", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    const result = await checkSpendPolicy("res-1", "0.10", enabledDeps(fetchFn));

    expect(result.allowed).toBe(true);
  });

  it("returns allowed=true when the gateway returns a non-2xx response", async () => {
    const result = await checkSpendPolicy(
      "res-1", "0.10",
      enabledDeps(mockFetch({}, 503)),
    );
    expect(result.allowed).toBe(true);
  });

  it("returns allowed=true when the gateway response is missing the 'allowed' boolean field", async () => {
    const result = await checkSpendPolicy(
      "res-1", "0.10",
      enabledDeps(mockFetch({ verdict: "ok" })), // wrong field name
    );
    expect(result.allowed).toBe(true);
  });

  it("returns allowed=true when the gateway response JSON is not an object", async () => {
    const result = await checkSpendPolicy(
      "res-1", "0.10",
      enabledDeps(mockFetch("not-an-object")),
    );
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Happy path — CRE actually runs and can block (the "not a no-op" requirement)
// ---------------------------------------------------------------------------

describe("checkSpendPolicy — CRE enabled and functional", () => {
  const enabledDeps = (fetchFn: typeof fetch) =>
    fakeDeps({ fetchFn, isEnabled: () => true, gatewayUrl: () => "https://cre.example.com/policy" });

  it("returns allowed=true when the gateway confirms the amount is within the spend cap", async () => {
    const result = await checkSpendPolicy(
      "res-1", "0.10",
      enabledDeps(mockFetch({ allowed: true, reason: "within cap" })),
    );
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("within cap");
  });

  it("returns allowed=false when the gateway explicitly denies (spend cap exceeded)", async () => {
    const result = await checkSpendPolicy(
      "res-1", "99.99",
      enabledDeps(mockFetch({ allowed: false, reason: "exceeds confidential cap for resource res-1" })),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("exceeds confidential cap");
  });

  it("calls the gateway with the correct resource ID and amount in the POST body", async () => {
    const fetchFn = mockFetch({ allowed: true });
    await checkSpendPolicy("res-xyz", "1.23", enabledDeps(fetchFn));

    expect(fetchFn).toHaveBeenCalledExactlyOnceWith(
      "https://cre.example.com/policy",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ resourceId: "res-xyz", exactAmount: "1.23" }),
      }),
    );
  });

  it("uses a default reason when the gateway denies without a reason field", async () => {
    const result = await checkSpendPolicy(
      "res-1", "99.99",
      enabledDeps(mockFetch({ allowed: false })),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("CRE policy: spend cap exceeded");
  });
});

// ---------------------------------------------------------------------------
// Issue route integration — POST /issue must pass through CRE correctly
// ---------------------------------------------------------------------------

import { app } from "../index.js";
import { seedRegistry } from "../registry.js";
import { createTask } from "../budget.js";
import { hashCanonical } from "../hash.js";
import { randomUUID } from "node:crypto";

describe("POST /issue — CRE integration", () => {
  function validBody(resourceId: string) {
    return {
      taskDefinition: { id: randomUUID() },
      resourceId,
      exactAmount: "10.00",
      paymentRequest: { detail: "test" },
      session: "sandbox-public-key",
    };
  }

  it("returns 200 when CRE is disabled (CRE_ENABLED unset) — issuance unaffected", async () => {
    delete process.env.CRE_ENABLED;
    const resourceId = randomUUID();
    seedRegistry([{ resourceId, recipient: "0xRECIPIENT", price: "10.00" }]);
    createTask(hashCanonical(randomUUID()), "100.00");

    const res = await app.request("/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody(resourceId)),
    });

    expect(res.status).toBe(200);
  });

  it("returns 200 when CRE is enabled but gateway is unreachable — fail-open, issuance still succeeds", async () => {
    process.env.CRE_ENABLED = "true";
    process.env.CRE_GATEWAY_URL = "http://127.0.0.1:19999/policy"; // nothing listening here
    const resourceId = randomUUID();
    seedRegistry([{ resourceId, recipient: "0xRECIPIENT", price: "10.00" }]);
    createTask(hashCanonical(randomUUID()), "100.00");

    const res = await app.request("/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody(resourceId)),
    });

    // Must succeed — a broken CRE gateway must never take /issue offline
    expect(res.status).toBe(200);

    delete process.env.CRE_ENABLED;
    delete process.env.CRE_GATEWAY_URL;
  });
});
