/**
 * Local, config-bound wrapper around @paybound/x402-blocky402-client's
 * generic Blocky402/Hedera exact-scheme helpers.
 *
 * Day 1 built this logic directly in this file, standalone; Day 2 extracted
 * the generic parts into packages/x402-blocky402-client so apps/broker's
 * new x402 settlement strategy doesn't have to duplicate or re-derive it.
 * This file now only binds this service's own config (payTo, price,
 * facilitator URL) onto the shared functions — see that package for the
 * full implementation, including the transaction/transactionId field-name
 * discrepancy note (x402-foundation's spec prose says `transactionId`;
 * Blocky402's real /settle response says `transaction` — do not "fix" that
 * back without re-checking a live response first).
 */
import type { PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse, VerifyResponse } from "@x402/core/types";
import {
  buildPaymentRequired as buildPaymentRequiredShared,
  buildPaymentRequirements as buildPaymentRequirementsShared,
  fetchHederaFeePayer as fetchHederaFeePayerShared,
  settlePayment as settlePaymentShared,
  verifyPayment as verifyPaymentShared,
} from "@paybound/x402-blocky402-client";
import { config } from "./config.js";

export async function fetchHederaFeePayer(): Promise<string> {
  return fetchHederaFeePayerShared({ blocky402Url: config.blocky402Url });
}

export function buildPaymentRequirements(feePayer: string): PaymentRequirements {
  return buildPaymentRequirementsShared({
    payTo: config.payToAccountId,
    amountTinybars: config.priceTinybars,
    feePayer,
  });
}

export function buildPaymentRequired(requirements: PaymentRequirements, resourceUrl: string): PaymentRequired {
  return buildPaymentRequiredShared(
    requirements,
    resourceUrl,
    "PayBound standalone Blocky402 proof — gated market-data snippet",
  );
}

export async function verifyPayment(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
): Promise<VerifyResponse> {
  return verifyPaymentShared(paymentPayload, paymentRequirements, { blocky402Url: config.blocky402Url });
}

export async function settlePayment(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
): Promise<SettleResponse> {
  return settlePaymentShared(paymentPayload, paymentRequirements, { blocky402Url: config.blocky402Url });
}
