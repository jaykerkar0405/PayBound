/**
 * Thin client for the Blocky402 x402 facilitator (testnet:
 * https://api.testnet.blocky402.com) — GET /supported, POST /verify,
 * POST /settle. Talks the "exact" scheme on Hedera per
 * https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md.
 *
 * IMPORTANT — field name mismatch (confirmed against the live facilitator,
 * not just the spec doc): the x402-foundation spec's prose names the
 * settlement identifier field `transactionId`, but Blocky402's actual
 * /settle response (and the published @x402/core PaymentPayload/
 * SettleResponse types this file imports) use `transaction`. Do NOT
 * "correct" this back to `transactionId` without re-checking a live
 * response — see the raw /settle bodies captured in the Step 2 live
 * verification output.
 */
import type {
  PaymentRequirements,
  PaymentRequired,
  PaymentPayload,
  VerifyRequest,
  VerifyResponse,
  SettleRequest,
  SettleResponse,
  SupportedResponse,
} from "@x402/core/types";
import { config } from "./config.js";

export const X402_VERSION = 2;
export const HEDERA_TESTNET_NETWORK = "hedera:testnet";
/** x402's asset id for native HBAR (not an HTS token). */
export const HBAR_ASSET_ID = "0.0.0";

export async function fetchSupported(): Promise<SupportedResponse> {
  const res = await fetch(`${config.blocky402Url}/supported`);
  if (!res.ok) {
    throw new Error(`Blocky402 /supported returned HTTP ${res.status}`);
  }
  return (await res.json()) as SupportedResponse;
}

/**
 * Live fee-payer account for hedera:testnet, fetched from Blocky402's own
 * /supported endpoint every call — never hardcoded, since this can change
 * on their end.
 */
export async function fetchHederaFeePayer(): Promise<string> {
  const supported = await fetchSupported();
  const kind = supported.kinds.find(
    (k) => k.scheme === "exact" && k.network === HEDERA_TESTNET_NETWORK,
  );
  const feePayer = kind?.extra?.["feePayer"];
  if (typeof feePayer !== "string") {
    throw new Error(
      `Blocky402 /supported did not advertise a hedera:testnet fee payer. Full response: ${JSON.stringify(supported)}`,
    );
  }
  return feePayer;
}

export function buildPaymentRequirements(feePayer: string): PaymentRequirements {
  return {
    scheme: "exact",
    network: HEDERA_TESTNET_NETWORK,
    asset: HBAR_ASSET_ID,
    amount: config.priceTinybars,
    payTo: config.payToAccountId,
    maxTimeoutSeconds: 300,
    extra: { feePayer },
  };
}

/**
 * Builds the HTTP 402 response body. `resource` is optional on the real
 * @x402/core `PaymentRequired` type and Blocky402 genuinely accepts a
 * request that omits it (confirmed live: a /verify POST with no `resource`
 * field anywhere returned 200 with a signature-level `isValid: false`, not
 * a 400 shape-validation error) — included anyway since it's cheap and
 * matches the x402 spec's intent of describing what's being paid for.
 */
export function buildPaymentRequired(
  requirements: PaymentRequirements,
  resourceUrl: string,
): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    resource: {
      url: resourceUrl,
      description: "PayBound standalone Blocky402 proof — gated market-data snippet",
      mimeType: "application/json",
    },
    accepts: [requirements],
  };
}

export async function verifyPayment(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
): Promise<VerifyResponse> {
  const body: VerifyRequest = { x402Version: X402_VERSION, paymentPayload, paymentRequirements };
  const res = await fetch(`${config.blocky402Url}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as VerifyResponse;
}

export async function settlePayment(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
): Promise<SettleResponse> {
  const body: SettleRequest = { x402Version: X402_VERSION, paymentPayload, paymentRequirements };
  const res = await fetch(`${config.blocky402Url}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as SettleResponse;
}
