/**
 * Real x402-gated content purchase — Hedera track, Day 2 Step 2.
 *
 * A deliberately SEPARATE payment stage from apps/sandbox's agent loop:
 * per the approved Day-2 framing, the sandboxed agent's readContent/pay
 * tool-calling loop (agent.ts, tools/read-content.ts, tools/pay.ts) stays
 * completely untouched — payTool structurally cannot carry a destination,
 * amount, or resource URL (by design, to prevent prompt-injection-driven
 * fund redirection), and readContent has no 402-awareness. Routing a real
 * x402 payment through that loop would require weakening one of those
 * invariants, which this task explicitly does not do.
 *
 * Instead, this file has the BROKER itself act as "the platform" that
 * consumes apps/gated-content-service (satisfying the Hedera track's
 * "platform or agent... consumes that service" requirement) — using its
 * own operator credentials, through the exact same authorize/submit
 * building blocks routes/pay.ts uses in production (authorize.ts,
 * state-machine.ts's submitPayment, signer.ts's resolveSigner), then
 * settling through packages/settlement's new x402 strategy
 * (createX402Submitter) instead of the default direct-transfer one — a
 * substitution settleAndRecord's existing `deps` parameter already
 * supports, with zero changes to settlement.ts itself.
 *
 * Usage (from apps/broker/, real Hedera credentials + a running
 * gated-content-service required):
 *   node --env-file=.env.local --import tsx/esm scripts/pay-for-gated-content.ts
 * Or import `payForGatedContent()` directly — e2e-live-demo.ts does this
 * as an additional, independent stage after its existing agent-run stages.
 */
import { seedRegistry, getResourceById } from "../src/registry.js";
import { createTask, getTask, increaseTaskBudget } from "../src/budget.js";
import { hashCanonical } from "../src/hash.js";
import { issueCapability, getCapabilityRecord } from "../src/issuer.js";
import { authorize } from "../src/authorize.js";
import { submitPayment } from "../src/state-machine.js";
import { resolveSigner } from "../src/signer.js";
import { settleAndRecord, type SettlementDeps } from "../src/settlement.js";
import {
  queryHederaTransactionReceipt,
  logSettlementOutcome,
  createX402Submitter,
  requireConfig,
  type HederaSubmissionResult,
} from "@paybound/settlement";
import { PrivateKey } from "@paybound/x402-blocky402-client";
import type { PaymentAuthorizationRequest, SubmittedPaymentState } from "@paybound/capability-spec";

/** Fixed, not randomly generated — required for idempotent registry/task seeding across repeated demo runs. */
export const GATED_CONTENT_RESOURCE_ID = "9b2e6f9a-3f1a-4b1e-8a9e-0c3a2f6d1b47";
export const GATED_CONTENT_TASK_DEFINITION = { purchase: "Hedera track Day-2 real x402-gated content purchase" };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`pay-for-gated-content: ${name} is not set — see apps/broker/.env.example`);
  }
  return value;
}

/**
 * The gated resource's own advertised URL/payTo/price — read from env
 * rather than hardcoded, since they name apps/gated-content-service's
 * *current* configuration (see that package's .env.local), which this
 * script has no authority over and must not assume.
 */
function gatedContentConfig(): { readonly url: string; readonly payTo: string; readonly priceHbar: string } {
  return {
    url: requireEnv("GATED_CONTENT_URL"),
    payTo: requireEnv("GATED_CONTENT_PAYTO_ACCOUNT_ID"),
    priceHbar: requireEnv("GATED_CONTENT_PRICE_HBAR"),
  };
}

export async function checkGatedContentServiceReachable(url: string): Promise<void> {
  try {
    // A bare GET should return 402 (payment required) — any response at
    // all confirms the service is up; the actual x402 flow below is what
    // validates it's genuinely gated.
    await fetch(url);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach gated-content-service at ${url}: ${detail}\n` +
        "  Start it first: pnpm --filter gated-content-service dev:live",
      { cause: err },
    );
  }
}

/**
 * Total budget ceiling across ALL runs of this script — deliberately much
 * larger than one payment's price. `increaseTaskBudget` raises `maxTotalSpend`
 * to *at least* the given value and never lowers it (budget.ts) — it is not
 * an additive top-up. Seeding the ceiling at exactly one payment's price
 * would authorize exactly one payment ever, then permanently block every
 * later run (including Step 3's required repeat verification runs) with
 * BUDGET_EXCEEDED, since a second `increaseTaskBudget` call with the same
 * per-payment price would be a no-op. 1 HBAR (1000x this resource's 0.001
 * HBAR price) gives headroom for hundreds of demo/test runs, same
 * reasoning as seed-live-agent-run.ts's own LIVE_AGENT_RUN_BUDGET.
 */
const GATED_CONTENT_BUDGET_HBAR = "1";

/** Idempotently seeds the registry entry + task budget for the gated-content purchase, matching seed-live-agent-run.ts's convention. */
function ensureGatedContentSeeded(payTo: string, priceHbar: string): { readonly taskHash: string } {
  const taskHash = hashCanonical(GATED_CONTENT_TASK_DEFINITION);

  if (getResourceById(GATED_CONTENT_RESOURCE_ID) === undefined) {
    seedRegistry([{ resourceId: GATED_CONTENT_RESOURCE_ID, recipient: payTo, price: priceHbar }]);
  }

  if (getTask(taskHash) === undefined) {
    createTask(taskHash, GATED_CONTENT_BUDGET_HBAR, GATED_CONTENT_RESOURCE_ID);
  } else {
    increaseTaskBudget(taskHash, GATED_CONTENT_BUDGET_HBAR);
  }

  return { taskHash };
}

export interface PayForGatedContentResult {
  readonly submitted: SubmittedPaymentState;
  readonly settlement: HederaSubmissionResult;
}

/**
 * Issues a capability for the gated-content resource, authorizes + submits
 * it through the real state machine (same building blocks routes/pay.ts
 * uses), then settles it through the x402 strategy instead of the direct
 * one — the Broker paying, with its own operator credentials, for a real
 * x402-gated request end to end.
 *
 * Captures the real `HederaSubmissionResult` via a thin wrapper around
 * `createX402Submitter` rather than duplicating settleAndRecord's own
 * outcome-resolution/persistence/HCS-logging logic — that logic runs
 * unmodified (queryHederaTransactionReceipt/logSettlementOutcome are the
 * same real functions routes/pay.ts's default path uses), this only reads
 * back what it already produced.
 */
export async function payForGatedContent(): Promise<PayForGatedContentResult> {
  const { url, payTo, priceHbar } = gatedContentConfig();
  await checkGatedContentServiceReachable(url);

  const { taskHash } = ensureGatedContentSeeded(payTo, priceHbar);

  const issued = issueCapability({
    taskDefinition: GATED_CONTENT_TASK_DEFINITION,
    resourceId: GATED_CONTENT_RESOURCE_ID,
    exactAmount: priceHbar,
    paymentRequest: { detail: "Hedera track Day-2 real x402-gated content purchase" },
    session: "broker-operator",
  });

  const record = getCapabilityRecord(issued.capabilityId);
  if (record === undefined) {
    throw new Error(`payForGatedContent: capability ${issued.capabilityId} was issued but is not readable back`);
  }

  const task = getTask(taskHash);
  if (task === undefined) {
    throw new Error(`payForGatedContent: no task budget record for taskHash "${taskHash}"`);
  }

  const payment: PaymentAuthorizationRequest = {
    amount: record.capability.exactAmount,
    destination: record.capability.recipient,
    resource: record.capability.resourceId,
    taskHash: record.capability.taskHash,
    session: record.capability.session,
    paymentRequestHash: record.capability.paymentRequestHash,
  };

  const authResult = authorize({ payment, capability: record.capability, task });
  if (!authResult.authorized) {
    throw new Error(`payForGatedContent: Broker.authorize rejected this payment: ${authResult.reason}`);
  }

  const submitted = await submitPayment(authResult.state, resolveSigner());

  const brokerOperator = requireConfig();
  const x402Submitter = createX402Submitter({
    resourceUrl: url,
    payerAccountId: brokerOperator.accountId,
    payerPrivateKey: PrivateKey.fromStringDer(brokerOperator.privateKey),
  });

  let captured: HederaSubmissionResult | undefined;
  const x402Deps: SettlementDeps = {
    submitToHedera: async (s) => {
      captured = await x402Submitter(s);
      return captured;
    },
    queryHederaTransactionReceipt,
    logSettlementOutcome,
  };

  await settleAndRecord(submitted, x402Deps);

  if (captured === undefined) {
    throw new Error(
      "payForGatedContent: settleAndRecord returned without ever calling the x402 submitter — " +
        "isSettlementConfigured() must be false (HEDERA_TESTNET_ACCOUNT_ID/HEDERA_TESTNET_PRIVATE_KEY not set).",
    );
  }

  return { submitted, settlement: captured };
}

function main(): void {
  payForGatedContent()
    .then((result) => {
      console.log("Capability nonce:", result.submitted.capability.nonce);
      console.log("Settlement outcome:", result.settlement.outcome);
      console.log("Hedera transaction ID:", result.settlement.transactionId);
      console.log(`HashScan: https://hashscan.io/testnet/transaction/${result.settlement.transactionId}`);
    })
    .catch((err: unknown) => {
      console.error("payForGatedContent failed:", err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
