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
 * Reconciles a RECOVERABLE payment by re-querying the transaction receipt,
 * using a two-stage fallback:
 *
 * Throws if the network still can't produce a definitive answer (e.g. the
 * receipt hasn't propagated yet, or another timeout) — callers should
 * treat a throw here as "still unknown," not as a failure, and leave the
 * payment RECOVERABLE for a later attempt.
 * Stage 1 — consensus-node `TransactionReceiptQuery` (fast, same-session):
 *   Works reliably within ~3 minutes of consensus. After that, the receipt
 *   expires from the node's cache and the query throws `RECEIPT_NOT_FOUND`
 *   regardless of whether the transaction succeeded — confirmed empirically
 *   against real testnet (see issue that introduced this change).
 *
 * Stage 2 — Hedera mirror-node REST API (permanent, no expiry):
 *   Falls back here on any throw from Stage 1. The mirror node indexes
 *   every transaction permanently. This is the only mechanism that can
 *   resolve a crash-recovered RECOVERABLE payment (CAPABILITY_SPEC.md's
 *   named motivating case) when the broker restarts more than ~3 minutes
 *   after the original submission.
 *
 * Still throws if both stages fail — callers treat a throw as "still
 * unknown" and leave the payment RECOVERABLE for a later sweep attempt.
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
  // Stage 1: consensus node (fast path, short receipt window)
  try {
    const client = getHederaClient();
    const receipt = await new TransactionReceiptQuery()
      .setTransactionId(TransactionId.fromString(transactionId))
      .setValidateStatus(false)
      .execute(client);
    const status = receipt.status.toString();
    return { outcome: status === "SUCCESS" ? "settled" : "failed", transactionId, status };
  } catch {
    // Receipt not found on consensus node — either expired from cache or
    // not yet propagated. Fall through to the permanent mirror-node record.
  }

  // Stage 2: mirror-node REST API (permanent record, no expiry window)
  return queryHederaMirrorNode(transactionId);
}

/**
 * Queries the Hedera Testnet mirror-node REST API for the outcome of a
 * transaction by ID. Mirror-node records are permanent — unlike the
 * consensus-node receipt cache, they do not expire. This is the correct
 * mechanism for reconciling RECOVERABLE payments when the broker restarts
 * long after the original submission.
 *
 * Transaction ID format accepted: either the standard SDK format
 * (`0.0.XXXXX@seconds.nanos`) or the mirror-node dash format
 * (`0.0.XXXXX-seconds-nanos`) — both are normalised internally.
 *
 * Throws if the mirror node returns a non-2xx response or no transaction
 * record is found — callers should treat this as "still unknown."
 */
export async function queryHederaMirrorNode(
  transactionId: string,
): Promise<HederaReconciliationResult> {
  // Convert SDK format (0.0.XXXXX@seconds.nanos) to mirror-node dash format
  // (0.0.XXXXX-seconds-nanos). Already-dashed IDs pass through unchanged.
  const mirrorId = transactionId.includes("@")
    ? (() => {
        const atIdx = transactionId.indexOf("@");
        const account = transactionId.slice(0, atIdx);
        const timestamp = transactionId.slice(atIdx + 1);
        const dotIdx = timestamp.indexOf(".");
        const seconds = dotIdx >= 0 ? timestamp.slice(0, dotIdx) : timestamp;
        const nanos = dotIdx >= 0 ? timestamp.slice(dotIdx + 1) : "0";
        return `${account}-${seconds}-${nanos}`;
      })()
    : transactionId;

  const url = `https://testnet.mirrornode.hedera.com/api/v1/transactions/${encodeURIComponent(mirrorId)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Mirror node query failed: HTTP ${response.status} for transaction ${transactionId}`,
    );
  }

  const data = (await response.json()) as { transactions?: Array<{ result: string }> };
  const tx = data.transactions?.[0];

  if (tx === undefined) {
    throw new Error(`Mirror node: no transaction record found for ID ${transactionId}`);
  }

  const status = tx.result;
  return { outcome: status === "SUCCESS" ? "settled" : "failed", transactionId, status };
}
