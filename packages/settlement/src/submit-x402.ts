/**
 * A second, additive settlement strategy alongside submit.ts's direct
 * TransferTransaction path: settles a payment by actually consuming an
 * x402-gated resource (apps/gated-content-service, Day 1's isolated proof)
 * through the live Blocky402 testnet facilitator, using
 * @paybound/x402-blocky402-client's client-side helpers — the same
 * build-sign-resubmit flow that package's own scripts/test-client.ts
 * already proved works live.
 *
 * settleAndRecord (apps/broker/src/settlement.ts) is untouched by this
 * file — its `deps` parameter already supports swapping `submitToHedera`
 * for an alternate implementation with the same call signature, which is
 * exactly what `createX402Submitter` below produces. Nothing here is wired
 * into the Broker's normal POST /pay dispatch (routes/pay.ts always uses
 * the real `submitToHedera` via `defaultDeps`) — a caller that wants this
 * strategy calls `settleAndRecord(submitted, { ...defaultDeps,
 * submitToHedera: createX402Submitter(options) })` directly.
 */
import { Hbar } from "@hashgraph/sdk";
import { encodeXPaymentHeader, signPaymentRequirements, type PrivateKey } from "@paybound/x402-blocky402-client";
import type { PaymentRequired } from "@x402/core/types";
import type { SubmittedPaymentState } from "@paybound/capability-spec";
import type { HederaSubmissionResult } from "./submit.js";

export interface X402SubmissionOptions {
  /** URL of the x402-gated resource to pay for (e.g. apps/gated-content-service's endpoint). */
  readonly resourceUrl: string;
  /** Hedera account that signs and pays — the Broker's own operator account, by convention. */
  readonly payerAccountId: string;
  readonly payerPrivateKey: PrivateKey;
  readonly fetchImpl?: typeof fetch;
}

interface GatedResourceSettlementBody {
  readonly settlement?: { readonly transaction?: string; readonly network?: string };
  readonly error?: string;
  readonly invalidReason?: string;
  readonly invalidMessage?: string;
  readonly errorReason?: string;
  readonly errorMessage?: string;
}

/**
 * Settles `submitted` by actually paying for `options.resourceUrl` through
 * the live x402 flow: unauthenticated GET -> 402 PaymentRequired -> sign
 * against accepts[0] -> resubmit with X-PAYMENT.
 *
 * Precondition (checked before anything is signed or dispatched, mirroring
 * SECURITY_INVARIANT.md's `payment.destination == capability.recipient`
 * clause applied to this path): the resource's live PaymentRequirements —
 * payTo and amount, as actually advertised by the resource server just now
 * — must match what the capability already authorized. A mismatch throws
 * (never dispatched, no transaction ID exists) rather than silently paying
 * a different destination or amount than what was authorized;
 * settleAndRecord's existing catch handling then leaves the payment
 * RECOVERABLE for investigation, exactly as it does for any other
 * submission that never dispatched.
 *
 * On success, the resource server has already waited for Blocky402's
 * `/settle` response before returning 200 — that facilitator response is
 * itself the confirmation that the transfer reached consensus with SUCCESS
 * (@x402/hedera's `createHederaSignAndSubmitTransaction` only resolves once
 * a SUCCESS receipt is confirmed) — so this resolves directly to `"settled"`
 * with no separate receipt query needed, the same fast path the direct
 * strategy takes when `submitToHedera` itself gets an immediate SUCCESS
 * receipt.
 */
export async function submitViaX402(
  submitted: SubmittedPaymentState,
  options: X402SubmissionOptions,
): Promise<HederaSubmissionResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const expectedTinybars = Hbar.fromString(submitted.capability.exactAmount).toTinybars().toString();

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

  if (requirements.payTo !== submitted.capability.recipient) {
    throw new Error(
      `x402 requirements payTo (${requirements.payTo}) does not match capability recipient ` +
        `(${submitted.capability.recipient}) for ${options.resourceUrl} — refusing to pay.`,
    );
  }
  if (requirements.amount !== expectedTinybars) {
    throw new Error(
      `x402 requirements amount (${requirements.amount} tinybars) does not match capability ` +
        `exactAmount (${submitted.capability.exactAmount} HBAR = ${expectedTinybars} tinybars) ` +
        `for ${options.resourceUrl} — refusing to pay.`,
    );
  }

  const paymentPayload = await signPaymentRequirements(
    options.payerAccountId,
    options.payerPrivateKey,
    paymentRequired.x402Version,
    requirements,
  );
  const xPaymentHeader = encodeXPaymentHeader(paymentPayload);

  const paidRes = await fetchImpl(options.resourceUrl, { headers: { "X-PAYMENT": xPaymentHeader } });
  const body = (await paidRes.json().catch(() => undefined)) as GatedResourceSettlementBody | undefined;
  const transactionId = body?.settlement?.transaction;

  if (paidRes.status !== 200 || transactionId === undefined || transactionId === "") {
    throw new Error(
      `x402 payment for ${options.resourceUrl} did not succeed: HTTP ${paidRes.status} ${JSON.stringify(body)}`,
    );
  }

  return { outcome: "settled", transactionId, status: "SUCCESS" };
}

/**
 * Binds `options` into a function matching `SettlementDeps["submitToHedera"]`'s
 * exact shape `(submitted: SubmittedPaymentState) => Promise<HederaSubmissionResult>`
 * — the seam apps/broker/src/settlement.ts's `settleAndRecord` already
 * accepts via its `deps` parameter, with zero changes to that file. Usage:
 *
 *   await settleAndRecord(submitted, {
 *     ...defaultDeps,
 *     submitToHedera: createX402Submitter({ resourceUrl, payerAccountId, payerPrivateKey }),
 *   });
 */
export function createX402Submitter(
  options: X402SubmissionOptions,
): (submitted: SubmittedPaymentState) => Promise<HederaSubmissionResult> {
  return (submitted) => submitViaX402(submitted, options);
}
