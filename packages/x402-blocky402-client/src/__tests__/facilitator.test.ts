import { describe, expect, it } from "vitest";
import { buildPaymentRequired, buildPaymentRequirements } from "../facilitator.js";

describe("buildPaymentRequirements", () => {
  it("builds the exact-scheme shape with the given payTo/amount/feePayer and sane defaults", () => {
    const requirements = buildPaymentRequirements({
      payTo: "0.0.1234",
      amountTinybars: "100000",
      feePayer: "0.0.9999",
    });

    expect(requirements).toEqual({
      scheme: "exact",
      network: "hedera:testnet",
      asset: "0.0.0",
      amount: "100000",
      payTo: "0.0.1234",
      maxTimeoutSeconds: 300,
      extra: { feePayer: "0.0.9999" },
    });
  });

  it("lets callers override network/asset/maxTimeoutSeconds", () => {
    const requirements = buildPaymentRequirements({
      payTo: "0.0.1234",
      amountTinybars: "5",
      feePayer: "0.0.9999",
      network: "hedera:mainnet",
      asset: "0.0.456858",
      maxTimeoutSeconds: 60,
    });

    expect(requirements.network).toBe("hedera:mainnet");
    expect(requirements.asset).toBe("0.0.456858");
    expect(requirements.maxTimeoutSeconds).toBe(60);
  });
});

describe("buildPaymentRequired", () => {
  it("wraps requirements in accepts[], per the real @x402/core PaymentRequired shape (not a bare PaymentRequirements object)", () => {
    const requirements = buildPaymentRequirements({
      payTo: "0.0.1234",
      amountTinybars: "100000",
      feePayer: "0.0.9999",
    });

    const paymentRequired = buildPaymentRequired(requirements, "https://example.com/resource", "a resource");

    expect(paymentRequired.x402Version).toBe(2);
    expect(paymentRequired.accepts).toEqual([requirements]);
    expect(paymentRequired.resource).toEqual({
      url: "https://example.com/resource",
      description: "a resource",
      mimeType: "application/json",
    });
  });

  it("omits description when none is given, per resource being optional", () => {
    const requirements = buildPaymentRequirements({
      payTo: "0.0.1234",
      amountTinybars: "100000",
      feePayer: "0.0.9999",
    });

    const paymentRequired = buildPaymentRequired(requirements, "https://example.com/resource");

    expect(paymentRequired.resource.description).toBeUndefined();
  });
});
