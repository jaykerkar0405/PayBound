import { AccountId, Hbar, TransactionId, TransactionReceiptQuery, TransferTransaction } from "@hashgraph/sdk";
import type { SubmittedPaymentState } from "@paybound/capability-spec";
import { requireConfig } from "./config.js";
import { getHederaClient } from "./hedera-client.js";

/**
 * Maps directly onto CAPABILITY_SPEC.md's "Triggering conditions for
 * RECOVERABLE and FAILED": `"settled"` (a `SUCCESS` receipt), `"failed"` (a
 * receipt with any other definitive status — a known, non-ambiguous
 * outcome), or `"unknown"` (no receipt could be confirmed at all — a
 * network/timeout error, not a Hedera-reported status). `apps/broker`'s
 * `settleAndRecord` (settlement.ts) passes this value straight into
 * `resolveSubmission`'s `SubmissionOutcome` parameter unchanged — the two
 * types intentionally share the same three string literals.
 */
export interface HederaSubmissionResult {
  readonly outcome: "settled" | "failed" | "unknown";
  readonly transactionId: string;
  /** The receipt's status string (e.g. "SUCCESS"), or `null` when `outcome` is `"unknown"` — no receipt was ever confirmed. */
  readonly status: string | null;
}

/**
 * Submits the payment described by a broker-produced SUBMITTED state as a
 * real Hedera Testnet transfer, using the configured operator account (see
 * docs/SETTLEMENT_INTEGRATION_PROPOSAL.md "Design A" — this is
 * intentionally a separate signing domain from the Broker's own
 * Ledger-backed capability signature; see that doc for why).
 *
 * Never throws once the transfer is actually dispatched (i.e. once a real
 * `transactionId` exists) — a receipt query failure (network drop,
 * timeout) resolves to `{ outcome: "unknown", transactionId, status: null
 * }` instead, so the caller always has the transaction ID needed to
 * reconcile later (`queryHederaTransactionReceipt`), even when this call
 * itself couldn't confirm the outcome. Can still throw if the transfer was
 * never dispatched at all (e.g. the initial `execute()` failed) — there is
 * no transaction ID to hand back in that case.
 */
export async function submitToHedera(
  submitted: SubmittedPaymentState,
): Promise<HederaSubmissionResult> {
  const { accountId } = requireConfig();
  const amount = Hbar.fromString(submitted.capability.exactAmount);
  const client = getHederaClient();

  const transactionResponse = await new TransferTransaction()
    .addHbarTransfer(AccountId.fromString(accountId), amount.negated())
    .addHbarTransfer(AccountId.fromString(submitted.capability.recipient), amount)
    .execute(client);

  const transactionId = transactionResponse.transactionId.toString();

  try {
    const receipt = await new TransactionReceiptQuery()
      .setTransactionId(transactionResponse.transactionId)
      // Return the receipt regardless of its status instead of throwing a
      // ReceiptStatusError for a non-SUCCESS status — a definitive failure
      // is data this function should return, not an exception to unwrap.
      .setValidateStatus(false)
      .execute(client);
    const status = receipt.status.toString();
    return { outcome: status === "SUCCESS" ? "settled" : "failed", transactionId, status };
  } catch {
    // Dispatched (we have a real transactionId) but the outcome couldn't
    // be confirmed — a network drop or timeout querying the receipt, not a
    // status Hedera actually reported. Exactly CAPABILITY_SPEC.md's
    // "unknown" case: reconciliation by transaction ID
    // (queryHederaTransactionReceipt) is the correct next step, not a
    // blind retry.
    return { outcome: "unknown", transactionId, status: null };
  }
}

/** Same shape as the definitive branches of {@link HederaSubmissionResult}; reconciliation either gets a definitive answer or throws (see doc comment below). */
export interface HederaReconciliationResult {
  readonly outcome: "settled" | "failed";
  readonly transactionId: string;
  readonly status: string;
}

/**
 * Reconciles a RECOVERABLE payment (CAPABILITY_SPEC.md: `submitToHedera`
 * returned/threw an "unknown" outcome) by re-querying that same
 * transaction's receipt directly from the network, by ID — the correct
 * recovery path per CAPABILITY_SPEC.md, not a blind retry (which would
 * risk double-submission).
 *
 * Throws if the network still can't produce a definitive answer (e.g. the
 * receipt hasn't propagated yet, or another timeout) — callers should
 * treat a throw here as "still unknown," not as a failure, and leave the
 * payment RECOVERABLE for a later attempt.
 */
export async function queryHederaTransactionReceipt(
  transactionId: string,
): Promise<HederaReconciliationResult> {
  const client = getHederaClient();
  const receipt = await new TransactionReceiptQuery()
    .setTransactionId(TransactionId.fromString(transactionId))
    .setValidateStatus(false)
    .execute(client);
  const status = receipt.status.toString();
  return { outcome: status === "SUCCESS" ? "settled" : "failed", transactionId, status };
}
