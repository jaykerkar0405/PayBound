/**
 * Server/resource-side helpers for talking to the Blocky402 x402 facilitator
 * (https://blocky402.com) — GET /supported, POST /verify, POST /settle.
 * Talks the "exact" scheme on Hedera per
 * https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md.
 *
 * Extracted from apps/gated-content-service's Day-1 standalone proof
 * (originally src/blocky402.ts) so apps/broker's settlement strategy
 * (packages/settlement) doesn't have to re-derive or duplicate it — see
 * that package's submit-x402.ts.
 *
 * IMPORTANT — field name mismatch (confirmed against the live facilitator,
 * not just the spec doc): the x402-foundation spec's prose names the
 * settlement identifier field `transactionId`, but Blocky402's actual
 * /settle response (and the published @x402/core PaymentPayload/
 * SettleResponse types this file imports) use `transaction`. Do NOT
 * "correct" this back to `transactionId` without re-checking a live
 * response first.
 */
import type {
  Network,
  PaymentRequirements,
  PaymentRequired,
  PaymentPayload,
  VerifyRequest,
  VerifyResponse,
  SettleRequest,
  SettleResponse,
  SupportedResponse,
} from "@x402/core/types";
import { DEFAULT_BLOCKY402_URL, HBAR_ASSET_ID, HEDERA_TESTNET_NETWORK, X402_VERSION } from "./constants.js";

export interface FacilitatorClientOptions {
  readonly blocky402Url?: string;
  readonly fetchImpl?: typeof fetch;
}

export async function fetchSupported(options: FacilitatorClientOptions = {}): Promise<SupportedResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(`${options.blocky402Url ?? DEFAULT_BLOCKY402_URL}/supported`);
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
export async function fetchHederaFeePayer(options: FacilitatorClientOptions = {}): Promise<string> {
  const supported = await fetchSupported(options);
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

export interface BuildPaymentRequirementsOptions {
  readonly payTo: string;
  readonly amountTinybars: string;
  readonly feePayer: string;
  readonly maxTimeoutSeconds?: number;
  readonly asset?: string;
  readonly network?: Network;
}

export function buildPaymentRequirements(options: BuildPaymentRequirementsOptions): PaymentRequirements {
  return {
    scheme: "exact",
    network: options.network ?? HEDERA_TESTNET_NETWORK,
    asset: options.asset ?? HBAR_ASSET_ID,
    amount: options.amountTinybars,
    payTo: options.payTo,
    maxTimeoutSeconds: options.maxTimeoutSeconds ?? 300,
    extra: { feePayer: options.feePayer },
  };
}

/**
 * Builds the HTTP 402 response body. `resource` is optional on the real
 * @x402/core `PaymentRequired` type and Blocky402 genuinely accepts a
 * request that omits it (confirmed live against the real facilitator: a
 * /verify POST with no `resource` field anywhere returned 200 with a
 * signature-level `isValid: false`, not a 400 shape-validation error) —
 * included anyway since it's cheap and matches the x402 spec's intent of
 * describing what's being paid for.
 */
export function buildPaymentRequired(
  requirements: PaymentRequirements,
  resourceUrl: string,
  description?: string,
): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    resource: {
      url: resourceUrl,
      ...(description !== undefined ? { description } : {}),
      mimeType: "application/json",
    },
    accepts: [requirements],
  };
}

export async function verifyPayment(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
  options: FacilitatorClientOptions = {},
): Promise<VerifyResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body: VerifyRequest = { x402Version: X402_VERSION, paymentPayload, paymentRequirements };
  const res = await fetchImpl(`${options.blocky402Url ?? DEFAULT_BLOCKY402_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as VerifyResponse;
}

export async function settlePayment(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
  options: FacilitatorClientOptions = {},
): Promise<SettleResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body: SettleRequest = { x402Version: X402_VERSION, paymentPayload, paymentRequirements };
  const res = await fetchImpl(`${options.blocky402Url ?? DEFAULT_BLOCKY402_URL}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as SettleResponse;
}
