/**
 * Wires @paybound/settlement into the payment state machine's
 * SUBMITTED -> SETTLED/FAILED/RECOVERABLE transition (task 4.1/4.2,
 * docs/SETTLEMENT_INTEGRATION_PROPOSAL.md "Design A"). Called fire-and-
 * forget from routes/pay.ts, after the HTTP response for SUBMITTED has
 * already been built — settlement confirmation is deliberately decoupled
 * from the request/response cycle (docs/PROTOCOL.md §1): nothing here
 * should ever be awaited by a route handler.
 *
 * Deliberately a separate signing domain from the Broker's own
 * Ledger-backed capability signature (signer.ts) — see the proposal doc
 * for why Design A keeps these two concerns apart rather than routing
 * real settlement through the Ledger.
 */
import {
  submitToHedera,
  queryHederaTransactionReceipt,
  logSettlementOutcome,
  type HederaSubmissionResult,
  type HederaReconciliationResult,
  type SettlementOutcomeEvent,
} from "@paybound/settlement";
import type { SubmittedPaymentState } from "@paybound/capability-spec";
import { resolveSubmission, type SubmissionOutcome } from "./state-machine.js";

export interface SettlementDeps {
  readonly submitToHedera: (submitted: SubmittedPaymentState) => Promise<HederaSubmissionResult>;
  readonly queryHederaTransactionReceipt: (transactionId: string) => Promise<HederaReconciliationResult>;
  readonly logSettlementOutcome: (event: SettlementOutcomeEvent) => Promise<{ transactionId: string }>;
}

const defaultDeps: SettlementDeps = {
  submitToHedera,
  queryHederaTransactionReceipt,
  logSettlementOutcome,
};

/**
 * True once real Hedera Testnet credentials are configured
 * (HEDERA_TESTNET_ACCOUNT_ID / HEDERA_TESTNET_PRIVATE_KEY). Reads
 * `process.env` lazily rather than the frozen `config` snapshot (config.ts)
 * — the same reasoning as `packages/settlement/src/config.ts`'s
 * `requireTopicId`: it lets tests toggle this per case without needing to
 * re-import the module. Until both are set, `settleAndRecord` leaves a
 * payment at SUBMITTED rather than manufacturing a RECOVERABLE outcome for
 * every payment in every environment that hasn't provisioned Hedera yet —
 * see docs/SETTLEMENT_INTEGRATION_PROPOSAL.md ("Design A").
 */
export function isSettlementConfigured(): boolean {
  return (
    process.env.HEDERA_TESTNET_ACCOUNT_ID !== undefined &&
    process.env.HEDERA_TESTNET_PRIVATE_KEY !== undefined
  );
}

/**
 * Settles a SUBMITTED payment on Hedera and resolves it to
 * SETTLED/FAILED/RECOVERABLE via state-machine.ts's `resolveSubmission`
 * (its own transition logic is untouched — this only supplies the real
 * `SubmissionOutcome`), then logs the outcome to HCS — including the real
 * Hedera transaction ID, when one exists, so it's independently verifiable
 * on a public testnet explorer (e.g. HashScan).
 *
 * Outcome mapping, per CAPABILITY_SPEC.md's "Triggering conditions for
 * RECOVERABLE and FAILED":
 *  - `submitToHedera` resolves with a definitive receipt status ->
 *    "settled" (SUCCESS) or "failed" (any other status) directly.
 *  - `submitToHedera` resolves "unknown" (dispatched, but no receipt could
 *    be confirmed) -> one immediate reconciliation attempt by transaction
 *    ID (`queryHederaTransactionReceipt`) — not a blind retry — before
 *    accepting "unknown" for real.
 *  - `submitToHedera` throws outright (never dispatched, no transaction ID
 *    exists at all) -> "unknown", nothing to reconcile against yet.
 *
 * `deps` defaults to the real @paybound/settlement functions; tests pass a
 * fake object directly, with no module mocking required.
 */
export async function settleAndRecord(
  submitted: SubmittedPaymentState,
  deps: SettlementDeps = defaultDeps,
): Promise<void> {
  if (!isSettlementConfigured()) return;

  let outcome: SubmissionOutcome;
  let transactionId: string | undefined;
  let status: string | undefined;

  try {
    const result = await deps.submitToHedera(submitted);
    transactionId = result.transactionId;
    status = result.status ?? undefined;
    outcome = result.outcome;

    if (outcome === "unknown") {
      try {
        const reconciled = await deps.queryHederaTransactionReceipt(result.transactionId);
        outcome = reconciled.outcome;
        status = reconciled.status;
      } catch {
        // Still unknown — resolveSubmission below correctly leaves this
        // RECOVERABLE for a later reconciliation attempt, per
        // CAPABILITY_SPEC.md (no blind retry, no premature resolution).
      }
    }
  } catch (error) {
    outcome = "unknown";
    console.error(
      `[AUDIT] settlement: submitToHedera threw for capability nonce ${submitted.capability.nonce}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  resolveSubmission(submitted, outcome);

  if (transactionId !== undefined) {
    try {
      await deps.logSettlementOutcome({
        eventType: "settlement_outcome",
        timestamp: new Date().toISOString(),
        taskHash: submitted.capability.taskHash,
        hederaTransactionId: transactionId,
        status: status ?? outcome,
      });
    } catch (error) {
      console.error(
        `[AUDIT] settlement: logSettlementOutcome failed for tx ${transactionId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
