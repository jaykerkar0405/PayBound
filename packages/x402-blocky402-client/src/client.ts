/**
 * Consumer-side helpers for paying an x402-gated resource — the role
 * apps/gated-content-service/scripts/test-client.ts (Day 1) and
 * packages/settlement's submitViaX402 (Day 2) both play: build + sign a
 * real Hedera TransferTransaction against a resource's PaymentRequirements,
 * then resubmit the request with X-PAYMENT set. The resource server (not
 * this code) is the one that calls Blocky402's /verify and /settle — see
 * facilitator.ts for that side.
 */
import { createClientHederaSigner, ExactHederaScheme, PrivateKey } from "@x402/hedera";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";

/**
 * Re-exported from @x402/hedera (not @hashgraph/sdk) deliberately: even
 * though both packages describe themselves as "Hiero SDK" at different
 * versions, callers must construct keys with the SAME PrivateKey class
 * `createClientHederaSigner`/`ExactHederaScheme` actually expect internally
 * — a same-shaped instance from a different package version isn't
 * guaranteed to satisfy their internal checks.
 */
export { PrivateKey };

/**
 * Builds and signs a PaymentPayload for `requirements`, using the real
 * @x402/hedera client helpers (same shapes Day 1's standalone test-client.ts
 * proved live: `accepted` singular, requirements copied through unchanged).
 */
export async function signPaymentRequirements(
  payerAccountId: string,
  payerPrivateKey: PrivateKey,
  x402Version: number,
  requirements: PaymentRequirements,
): Promise<PaymentPayload> {
  const signer = createClientHederaSigner(payerAccountId, payerPrivateKey);
  const scheme = new ExactHederaScheme(signer);
  const payloadResult = await scheme.createPaymentPayload(x402Version, requirements);

  return {
    x402Version: payloadResult.x402Version,
    accepted: requirements,
    payload: payloadResult.payload,
    ...(payloadResult.extensions ? { extensions: payloadResult.extensions } : {}),
  };
}

export function encodeXPaymentHeader(paymentPayload: PaymentPayload): string {
  return encodePaymentSignatureHeader(paymentPayload);
}

export interface FetchGatedResourceOptions {
  readonly resourceUrl: string;
  readonly payerAccountId: string;
  readonly payerPrivateKey: PrivateKey;
  readonly fetchImpl?: typeof fetch;
}

export interface FetchGatedResourceResult {
  /** The 402 PaymentRequired body returned by the unauthenticated request. */
  readonly paymentRequired: PaymentRequired;
  /** The single PaymentRequirements entry chosen (accepts[0]). */
  readonly requirements: PaymentRequirements;
  /** The signed payload sent as X-PAYMENT. */
  readonly paymentPayload: PaymentPayload;
  /** The paid retry's raw HTTP status. */
  readonly status: number;
  /** The paid retry's parsed JSON body (whatever shape the resource server returns). */
  readonly body: unknown;
}

/**
 * Full consumer-side round trip: unauthenticated GET -> expect 402 -> sign
 * against accepts[0] -> resubmit with X-PAYMENT. Throws if the initial
 * request isn't a real 402, or if accepts[] is empty — both mean the
 * resource isn't actually x402-gated the way this helper expects, which
 * should fail loudly rather than silently "succeed" with no payment.
 */
export async function fetchGatedResource(
  options: FetchGatedResourceOptions,
): Promise<FetchGatedResourceResult> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const unpaidRes = await fetchImpl(options.resourceUrl);
  if (unpaidRes.status !== 402) {
    throw new Error(
      `${options.resourceUrl} did not return HTTP 402 for an unauthenticated request (got ${unpaidRes.status}) — not an x402-gated resource, or already paid?`,
    );
  }
  const paymentRequired = (await unpaidRes.json()) as PaymentRequired;
  const requirements = paymentRequired.accepts[0];
  if (!requirements) {
    throw new Error(`${options.resourceUrl}'s 402 response had no entries in accepts[]`);
  }

  const paymentPayload = await signPaymentRequirements(
    options.payerAccountId,
    options.payerPrivateKey,
    paymentRequired.x402Version,
    requirements,
  );
  const xPaymentHeader = encodeXPaymentHeader(paymentPayload);

  const paidRes = await fetchImpl(options.resourceUrl, {
    headers: { "X-PAYMENT": xPaymentHeader },
  });
  const body: unknown = await paidRes.json().catch(() => undefined);

  return { paymentRequired, requirements, paymentPayload, status: paidRes.status, body };
}
