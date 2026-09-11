/**
 * Standalone test client for apps/gated-content-service — a plain runnable
 * script, not a test-framework test, so a human can watch it happen.
 *
 * Flow:
 *   1. GET the gated endpoint with no payment -> expect a real 402 with a
 *      PaymentRequired body (accepts[0] is the PaymentRequirements).
 *   2. Build + sign a real Hedera TransferTransaction against those
 *      requirements via @paybound/x402-blocky402-client's client helpers
 *      (extracted from this file on Day 2 so apps/broker's x402 settlement
 *      strategy doesn't have to duplicate it — see that package).
 *   3. Resubmit with X-PAYMENT set -> expect 200 with content + the real
 *      Hedera transaction ID from Blocky402's /settle call.
 *
 * Required env (see .env.example): PAYER_ACCOUNT_ID, PAYER_PRIVATE_KEY.
 */
import {
  PrivateKey,
  encodeXPaymentHeader,
  signPaymentRequirements,
} from "@paybound/x402-blocky402-client";
import type { PaymentRequired } from "@x402/core/types";

const GATED_SERVICE_URL = process.env.GATED_SERVICE_URL ?? "http://localhost:3210";
const GATED_PATH = "/gated-research-snippet";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set — see .env.example`);
  }
  return value;
}

async function main(): Promise<void> {
  const payerAccountId = requireEnv("PAYER_ACCOUNT_ID");
  const payerPrivateKey = PrivateKey.fromStringDer(requireEnv("PAYER_PRIVATE_KEY"));

  console.log(`=== [1/3] GET ${GATED_PATH} with no payment ===`);
  const unpaidRes = await fetch(`${GATED_SERVICE_URL}${GATED_PATH}`);
  const unpaidBody = await unpaidRes.json();
  console.log(`status: ${unpaidRes.status}`);
  console.log(JSON.stringify(unpaidBody, null, 2));

  if (unpaidRes.status !== 402) {
    throw new Error(`Expected HTTP 402, got ${unpaidRes.status}`);
  }

  const paymentRequired = unpaidBody as PaymentRequired;
  const requirements = paymentRequired.accepts[0];
  if (!requirements) {
    throw new Error("402 response had no entries in accepts[]");
  }
  console.log("\nChosen PaymentRequirements:");
  console.log(JSON.stringify(requirements, null, 2));

  console.log("\n=== [2/3] Building + signing a real Hedera TransferTransaction ===");
  const paymentPayload = await signPaymentRequirements(
    payerAccountId,
    payerPrivateKey,
    paymentRequired.x402Version,
    requirements,
  );
  const xPaymentHeader = encodeXPaymentHeader(paymentPayload);
  console.log(`Signed by payer: ${payerAccountId}`);
  console.log(`X-PAYMENT header (base64, ${xPaymentHeader.length} chars): ${xPaymentHeader.slice(0, 60)}...`);

  console.log(`\n=== [3/3] Resubmitting GET ${GATED_PATH} with X-PAYMENT ===`);
  const paidRes = await fetch(`${GATED_SERVICE_URL}${GATED_PATH}`, {
    headers: { "X-PAYMENT": xPaymentHeader },
  });
  const paidBody = await paidRes.json();
  console.log(`status: ${paidRes.status}`);
  console.log(JSON.stringify(paidBody, null, 2));

  if (paidRes.status !== 200) {
    throw new Error(`Paid request failed with HTTP ${paidRes.status} — see body above for Blocky402's reported reason`);
  }

  const settlement = (paidBody as { settlement?: { transaction?: string; hashscanUrl?: string } }).settlement;
  console.log("\n=== SUCCESS ===");
  console.log(`Hedera transaction ID: ${settlement?.transaction}`);
  console.log(`HashScan: ${settlement?.hashscanUrl}`);
}

main().catch((err: unknown) => {
  console.error("\n✗ test-client failed:", err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exitCode = 1;
});
