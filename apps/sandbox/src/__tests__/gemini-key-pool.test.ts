import { describe, expect, it, vi, afterEach } from "vitest";
import { RetryError } from "ai";
import { classifyGeminiQuotaError, createGeminiKeyPool, RPM_COOLDOWN_MS } from "../gemini-key-pool.js";

/** Shapes a fake APICallError-like object matching the real fields classifyGeminiQuotaError reads. */
function fakeApiCallError(statusCode: number, details?: unknown[]): unknown {
  return {
    name: "AI_APICallError",
    statusCode,
    data: details ? { error: { code: statusCode, message: "quota", status: "RESOURCE_EXHAUSTED", details } } : undefined,
  };
}

const RPM_VIOLATION = [
  { "@type": "type.googleapis.com/google.rpc.Help", links: [] },
  {
    "@type": "type.googleapis.com/google.rpc.QuotaFailure",
    violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }],
  },
  { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "23s" },
];

const RPD_VIOLATION = [
  { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] },
  { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "22s" },
];

describe("classifyGeminiQuotaError", () => {
  it("classifies a real-shaped RPM 429 (from a live captured response) as rpm", () => {
    expect(classifyGeminiQuotaError(fakeApiCallError(429, RPM_VIOLATION))).toBe("rpm");
  });

  it("classifies a real-shaped RPD 429 (from a live captured response) as rpd", () => {
    expect(classifyGeminiQuotaError(fakeApiCallError(429, RPD_VIOLATION))).toBe("rpd");
  });

  it("does not use retryDelay magnitude to distinguish — both real shapes have short retryDelay", () => {
    // Both fixtures above have a ~20s retryDelay; only quotaId differs. This test exists to
    // pin the (initially counter-intuitive) empirical finding that retryDelay alone cannot
    // discriminate rpm/rpd — see gemini-key-pool.ts's top doc comment.
    expect(classifyGeminiQuotaError(fakeApiCallError(429, RPM_VIOLATION))).not.toBe(
      classifyGeminiQuotaError(fakeApiCallError(429, RPD_VIOLATION)),
    );
  });

  it("classifies a non-429 error as other", () => {
    expect(classifyGeminiQuotaError(fakeApiCallError(500))).toBe("other");
  });

  it("classifies a 429 with no recognizable quotaId as other", () => {
    expect(classifyGeminiQuotaError(fakeApiCallError(429, [{ "@type": "something-else" }]))).toBe("other");
  });

  it("classifies a plain network error (no statusCode at all) as other", () => {
    expect(classifyGeminiQuotaError(new Error("fetch failed"))).toBe("other");
  });

  it("unwraps ai's RetryError ('Failed after N attempts') to classify the real underlying error", () => {
    // RetryError's real constructor sets `.lastError = errors[errors.length - 1]` —
    // matches what @ai-sdk/google's internal retry loop actually throws (observed live
    // in PR #87/#88's output: "Failed after 3 attempts. Last error: AI_APICallError: ...").
    const wrapped = new RetryError({
      message: "Failed after 3 attempts. Last error: ...",
      reason: "maxRetriesExceeded",
      errors: [fakeApiCallError(429, RPM_VIOLATION)],
    });
    expect(classifyGeminiQuotaError(wrapped)).toBe("rpm");
  });
});

describe("createGeminiKeyPool", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the single key when only one is configured", () => {
    const pool = createGeminiKeyPool(["key-a"]);
    expect(pool.size).toBe(1);
    expect(pool.nextAvailable()).toEqual({ index: 1, key: "key-a" });
  });

  it("stays available after a reported success", () => {
    const pool = createGeminiKeyPool(["key-a"]);
    pool.reportSuccess(1);
    expect(pool.nextAvailable()).toEqual({ index: 1, key: "key-a" });
  });

  it("rotates to the next key immediately on RPM exhaustion, without waiting", () => {
    const pool = createGeminiKeyPool(["key-a", "key-b", "key-c"]);
    const first = pool.nextAvailable();
    expect(first?.index).toBe(1);

    pool.reportRpmExhausted(1);

    const second = pool.nextAvailable();
    expect(second).toEqual({ index: 2, key: "key-b" });
  });

  it("makes an RPM-cooled key available again once RPM_COOLDOWN_MS has elapsed", () => {
    vi.useFakeTimers();
    const pool = createGeminiKeyPool(["key-a", "key-b"]);

    pool.reportRpmExhausted(1);
    expect(pool.nextAvailable()?.index).toBe(2); // key-a still cooling, key-b picked

    vi.advanceTimersByTime(RPM_COOLDOWN_MS - 1);
    expect(pool.nextAvailable()?.index).toBe(2); // not yet — key-a still cooling

    vi.advanceTimersByTime(2);
    expect(pool.nextAvailable()?.index).toBe(1); // key-a's window cleared, tried first again
  });

  it("marks an RPD-exhausted key permanently unavailable — time passing does not revive it", () => {
    vi.useFakeTimers();
    const pool = createGeminiKeyPool(["key-a", "key-b"]);

    pool.reportRpdExhausted(1);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000); // a full day

    expect(pool.nextAvailable()).toEqual({ index: 2, key: "key-b" });
  });

  it("returns undefined once every key is RPM-cooling-down simultaneously", () => {
    const pool = createGeminiKeyPool(["key-a", "key-b"]);
    pool.reportRpmExhausted(1);
    pool.reportRpmExhausted(2);
    expect(pool.nextAvailable()).toBeUndefined();
  });

  it("returns undefined once every key is RPD-exhausted", () => {
    const pool = createGeminiKeyPool(["key-a", "key-b"]);
    pool.reportRpdExhausted(1);
    pool.reportRpdExhausted(2);
    expect(pool.nextAvailable()).toBeUndefined();
  });

  it("returns undefined for a mix of RPD-exhausted and still-cooling-down keys", () => {
    const pool = createGeminiKeyPool(["key-a", "key-b"]);
    pool.reportRpdExhausted(1);
    pool.reportRpmExhausted(2);
    expect(pool.nextAvailable()).toBeUndefined();
  });

  it("returns undefined immediately for an empty pool", () => {
    const pool = createGeminiKeyPool([]);
    expect(pool.size).toBe(0);
    expect(pool.nextAvailable()).toBeUndefined();
  });
});
