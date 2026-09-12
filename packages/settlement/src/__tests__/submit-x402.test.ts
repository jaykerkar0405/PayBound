import { describe, expect, it, vi } from "vitest";
import type { SubmittedPaymentState } from "@paybound/capability-spec";
import { PrivateKey } from "@paybound/x402-blocky402-client";
import { createX402Submitter, submitViaX402 } from "../submit-x402.js";

const RESOURCE_URL = "http://localhost:9999/gated-resource";
const PAYER_ACCOUNT_ID = "0.0.1234";
// A throwaway key generated purely locally — signing a TransferTransaction
// is offline crypto, no network call, so tests never touch real Hedera or
// Blocky402; only the injected fake `fetchImpl` stands in for those.
const PAYER_PRIVATE_KEY = PrivateKey.generateED25519();

const capability = {
  taskHash: "test-task",
  resourceId: "test-resource",
  recipient: "0.0.5678",
  exactAmount: "0.001", // HBAR -> 100000 tinybars
  paymentRequestHash: "test-request",
  session: "test-session",
  nonce: "test-nonce",
  expiry: "2999-01-01T00:00:00.000Z",
  maxUses: 1 as const,
};

const submittedPayment: SubmittedPaymentState = {
  status: "SUBMITTED",
  capability,
  reservedFrom: {
    status: "RESERVED",
    capability,
    issuedFrom: { status: "ISSUED", capability },
  },
};

function paymentRequiredBody(payTo: string, amount: string): unknown {
  return {
    x402Version: 2,
    resource: { url: RESOURCE_URL, mimeType: "application/json" },
    accepts: [
      {
        scheme: "exact",
        network: "hedera:testnet",
        asset: "0.0.0",
        amount,
        payTo,
        maxTimeoutSeconds: 300,
        extra: { feePayer: "0.0.999" },
      },
    ],
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function baseOptions(fetchImpl: typeof fetch) {
  return {
    resourceUrl: RESOURCE_URL,
    payerAccountId: PAYER_ACCOUNT_ID,
    payerPrivateKey: PAYER_PRIVATE_KEY,
    fetchImpl,
  };
}

describe("submitViaX402", () => {
  it("throws when the unauthenticated GET does not return 402", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    await expect(submitViaX402(submittedPayment, baseOptions(fetchImpl))).rejects.toThrow(
      /did not return HTTP 402/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws when the 402 response has no accepts[] entries", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(402, { x402Version: 2, resource: { url: RESOURCE_URL }, accepts: [] }));

    await expect(submitViaX402(submittedPayment, baseOptions(fetchImpl))).rejects.toThrow(
      /no entries in accepts/,
    );
  });

  it("fails closed (throws, never signs or dispatches a second request) when the resource's payTo does not match capability.recipient", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(402, paymentRequiredBody("0.0.WRONG", "100000")));

    await expect(submitViaX402(submittedPayment, baseOptions(fetchImpl))).rejects.toThrow(
      /does not match capability recipient/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed (throws, never signs or dispatches a second request) when the resource's amount does not match capability.exactAmount", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(402, paymentRequiredBody(capability.recipient, "999")));

    await expect(submitViaX402(submittedPayment, baseOptions(fetchImpl))).rejects.toThrow(
      /does not match capability exactAmount/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns a settled outcome with the real transaction ID when the resource server confirms payment", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(402, paymentRequiredBody(capability.recipient, "100000")))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: { title: "demo" },
          settlement: { transaction: "0.0.999@1.1", network: "hedera:testnet" },
        }),
      );

    const result = await submitViaX402(submittedPayment, baseOptions(fetchImpl));

    expect(result).toEqual({
      outcome: "settled",
      transactionId: "0.0.999@1.1",
      status: "SUCCESS",
      strategy: "hedera_x402",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const secondCallInit = fetchImpl.mock.calls[1]?.[1] as RequestInit | undefined;
    const headers = secondCallInit?.headers as Record<string, string> | undefined;
    expect(headers?.["X-PAYMENT"]).toEqual(expect.any(String));
  });

  it("throws when the paid retry does not return 200 with a transaction ID", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(402, paymentRequiredBody(capability.recipient, "100000")))
      .mockResolvedValueOnce(
        jsonResponse(402, {
          error: "payment verification failed",
          invalidReason: "invalid_exact_hedera_payload_signature_invalid",
        }),
      );

    await expect(submitViaX402(submittedPayment, baseOptions(fetchImpl))).rejects.toThrow(/did not succeed/);
  });
});

describe("createX402Submitter", () => {
  it("produces a function matching SettlementDeps['submitToHedera']'s shape, delegating to submitViaX402", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(402, paymentRequiredBody(capability.recipient, "100000")))
      .mockResolvedValueOnce(jsonResponse(200, { settlement: { transaction: "0.0.999@2.2" } }));

    const submitter = createX402Submitter(baseOptions(fetchImpl));
    const result = await submitter(submittedPayment);

    expect(result).toEqual({
      outcome: "settled",
      transactionId: "0.0.999@2.2",
      status: "SUCCESS",
      strategy: "hedera_x402",
    });
  });
});
