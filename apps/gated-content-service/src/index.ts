/**
 * Standalone x402-gated resource server, settled through the Blocky402
 * testnet facilitator on Hedera. Day-1 proof for the Hedera "AI & Agentic
 * Payments" track: fully isolated from apps/broker and every other
 * PayBound package — nothing here is wired into the Broker/e2e demo yet.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload } from "@x402/core/types";
import { config } from "./config.js";
import {
  buildPaymentRequired,
  buildPaymentRequirements,
  fetchHederaFeePayer,
  settlePayment,
  verifyPayment,
} from "./blocky402.js";

const GATED_PATH = "/gated-research-snippet";

/** Clearly synthetic content — not scraped, just plausible enough to demo. */
const GATED_CONTENT = {
  title: "Q3 Synthetic Market Snapshot (demo data — not real)",
  generatedAt: "2026-09-11T00:00:00Z",
  entries: [
    { symbol: "DEMO-A", priceUsd: 128.42, changePct: 2.1 },
    { symbol: "DEMO-B", priceUsd: 54.19, changePct: -0.8 },
    { symbol: "DEMO-C", priceUsd: 990.03, changePct: 5.6 },
  ],
};

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok", service: "gated-content-service" }));

app.get(GATED_PATH, async (c) => {
  const paymentHeader = c.req.header("X-PAYMENT");

  if (paymentHeader === undefined) {
    const feePayer = await fetchHederaFeePayer();
    const requirements = buildPaymentRequirements(feePayer);
    const resourceUrl = new URL(c.req.url).toString();
    const paymentRequired = buildPaymentRequired(requirements, resourceUrl);
    return c.json(paymentRequired, 402);
  }

  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = decodePaymentSignatureHeader(paymentHeader);
  } catch (err) {
    return c.json(
      { error: "malformed X-PAYMENT header", detail: err instanceof Error ? err.message : String(err) },
      400,
    );
  }

  // The client copies the exact PaymentRequirements it chose into
  // `paymentPayload.accepted` (x402 protocol convention) — the resource
  // server passes that straight through to Blocky402 rather than
  // recomputing requirements itself, since this service is stateless
  // between the 402 and the paid retry.
  const paymentRequirements = paymentPayload.accepted;

  const verifyResult = await verifyPayment(paymentPayload, paymentRequirements);
  console.log(`[blocky402] POST /verify response: ${JSON.stringify(verifyResult)}`);
  if (!verifyResult.isValid) {
    return c.json(
      {
        error: "payment verification failed",
        invalidReason: verifyResult.invalidReason,
        invalidMessage: verifyResult.invalidMessage,
      },
      402,
    );
  }

  const settleResult = await settlePayment(paymentPayload, paymentRequirements);
  console.log(`[blocky402] POST /settle response: ${JSON.stringify(settleResult)}`);
  if (!settleResult.success) {
    return c.json(
      {
        error: "settlement failed",
        errorReason: settleResult.errorReason,
        errorMessage: settleResult.errorMessage,
      },
      402,
    );
  }

  // settleResult.transaction is the Hedera transaction ID — see
  // blocky402.ts's top comment on the transaction/transactionId field-name
  // mismatch between the x402-foundation spec prose and Blocky402's actual
  // response.
  return c.json(
    {
      data: GATED_CONTENT,
      settlement: {
        transaction: settleResult.transaction,
        network: settleResult.network,
        payer: settleResult.payer,
        hashscanUrl: `https://hashscan.io/testnet/transaction/${settleResult.transaction}`,
      },
    },
    200,
  );
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`gated-content-service listening on http://localhost:${info.port}`);
  console.log(`  gated endpoint: http://localhost:${info.port}${GATED_PATH}`);
});

export { app, GATED_PATH };
