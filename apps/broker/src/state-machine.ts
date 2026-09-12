import {
  capabilityIdSchema,
  issuedPaymentStateSchema,
  reservedPaymentStateSchema,
  submittedPaymentStateSchema,
  settledPaymentStateSchema,
  recoverablePaymentStateSchema,
  failedPaymentStateSchema,
  type Capability,
  type CapabilityId,
  type IssuedPaymentState,
  type ReservedPaymentState,
  type SubmittedPaymentState,
  type SettledPaymentState,
  type RecoverablePaymentState,
  type FailedPaymentState,
  type Task,
} from "@paybound/capability-spec";
import { db } from "./db.js";
import { tryReserveBudget } from "./budget.js";
import { canonicalize } from "./hash.js";

// ---------------------------------------------------------------------------
// Reads/writes on the `capabilities` table (created by issuer.ts, task 1.3).
// ---------------------------------------------------------------------------

interface CapabilityRow {
  capability_id: string;
  task_hash: string;
  resource_id: string;
  recipient: string;
  exact_amount: string;
  payment_request_hash: string;
  session: string;
  nonce: string;
  expiry: string;
  max_uses: number;
  signature: string;
  consumed: number;
}

function rowToCapability(row: CapabilityRow): Capability {
  return {
    taskHash: row.task_hash,
    resourceId: row.resource_id,
    recipient: row.recipient,
    exactAmount: row.exact_amount,
    paymentRequestHash: row.payment_request_hash,
    session: row.session,
    nonce: row.nonce,
    expiry: row.expiry,
    maxUses: 1,
  };
}

const selectCapabilityStatement = db.prepare<[string], CapabilityRow>(
  "SELECT * FROM capabilities WHERE capability_id = ?",
);

const markConsumedStatement = db.prepare<[string]>(
  "UPDATE capabilities SET consumed = 1 WHERE capability_id = ?",
);

const selectCapabilityIdByNonceStatement = db.prepare<[string], { capability_id: string }>(
  "SELECT capability_id FROM capabilities WHERE nonce = ?",
);

/**
 * Looks up the externally-facing capabilityId for a given nonce. Used by
 * Broker.authorize (task 1.6), whose AuthorizePaymentInput carries the full
 * Capability (and thus its nonce) but not the opaque capabilityId
 * reservePayment is keyed by — nonce is unique in the capabilities table,
 * so this bridges the two.
 */
export function getCapabilityIdByNonce(nonce: Capability["nonce"]): CapabilityId | undefined {
  const row = selectCapabilityIdByNonceStatement.get(nonce);
  return row === undefined ? undefined : capabilityIdSchema.parse(row.capability_id);
}

// ---------------------------------------------------------------------------
// Submitted payments: persists the SUBMITTED transition's stub signature and
// (once resolved) its SETTLED/FAILED/RECOVERABLE outcome. Keyed by the
// capability's nonce, since ReservedPaymentState/SubmittedPaymentState carry
// the Capability (which has a nonce) but not the externally-facing
// capabilityId.
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS payment_submissions (
    nonce         TEXT PRIMARY KEY,
    signature     TEXT NOT NULL,
    submitted_at  TEXT NOT NULL,
    status        TEXT
  )
`);

// Gap 1 fix: persist the Hedera transaction ID so a future reconciliation
// sweep has something to query against. ALTER TABLE ADD COLUMN is a safe
// no-op migration — SQLite never throws on a new column with NULL default,
// but WILL throw if the column already exists, so we catch that case.
try {
  db.exec("ALTER TABLE payment_submissions ADD COLUMN hedera_transaction_id TEXT");
} catch {
  // Column already exists (subsequent broker startups) — safe to ignore.
}

const insertSubmissionStatement = db.prepare<[string, string, string]>(
  "INSERT INTO payment_submissions (nonce, signature, submitted_at) VALUES (?, ?, ?)",
);

const updateSubmissionStatusStatement = db.prepare<[string, string]>(
  "UPDATE payment_submissions SET status = ? WHERE nonce = ?",
);

const updateHederaTxIdStatement = db.prepare<[string, string]>(
  "UPDATE payment_submissions SET hedera_transaction_id = ? WHERE nonce = ?",
);

/**
 * Persists the real Hedera transaction ID on a payment_submissions row so
 * the startup reconciliation sweep (`sweepRecoverablePayments` in
 * settlement.ts) can query it later — even after a broker crash/restart,
 * when in-memory state is gone. Called by `settleAndRecord` as soon as a
 * `transactionId` is returned by `submitToHedera`, before any attempt to
 * confirm the receipt.
 */
export function persistHederaTxId(nonce: string, hederaTxId: string): void {
  updateHederaTxIdStatement.run(hederaTxId, nonce);
}

interface RecoverableRow {
  nonce: string;
  hedera_transaction_id: string;
}

const selectRecoverableStatement = db.prepare<[], RecoverableRow>(
  "SELECT nonce, hedera_transaction_id FROM payment_submissions WHERE status = 'RECOVERABLE' AND hedera_transaction_id IS NOT NULL",
);

/**
 * Returns all RECOVERABLE payment rows that have a persisted Hedera
 * transaction ID — i.e. payments that were dispatched to Hedera (so we
 * have something to reconcile against) but whose outcome was never
 * confirmed. Used by `sweepRecoverablePayments` on broker startup.
 */
export function getRecoverableSubmissions(): { nonce: string; hederaTxId: string }[] {
  return selectRecoverableStatement.all().map((r) => ({
    nonce: r.nonce,
    hederaTxId: r.hedera_transaction_id,
  }));
}

/**
 * Resolves a RECOVERABLE payment directly by nonce, without needing a full
 * `SubmittedPaymentState` object. Used by `sweepRecoverablePayments` during
 * startup reconciliation, where the in-memory state is gone and only the
 * DB row remains.
 */
export function resolveRecoverableByNonce(
  nonce: string,
  outcome: "settled" | "failed",
): void {
  updateSubmissionStatusStatement.run(outcome === "settled" ? "SETTLED" : "FAILED", nonce);
}

/**
 * Crash-recovery gap fix: writes a provisional `RECOVERABLE` status onto a
 * just-submitted payment's row, called by settlement.ts's `settleAndRecord`
 * BEFORE it attempts the real settlement dispatch — not after. Without
 * this, a broker crash any time between `submitPayment` inserting this row
 * (status starts `NULL`) and `resolveSubmission` below writing the real
 * final status leaves that row at `status = NULL` forever. `NULL` is not
 * the string `'RECOVERABLE'`, so `getRecoverableSubmissions()`'s own query
 * (`WHERE status = 'RECOVERABLE'`) can never find it on any future startup
 * sweep — even in the case where a real Hedera transaction ID was already
 * persisted via `persistHederaTxId()` moments before the crash, and a real
 * transaction genuinely exists to reconcile against. This was confirmed
 * empirically: killing the broker process 3 seconds after a real `/pay`
 * call (after signing completed, before the settlement continuation ran)
 * leaves exactly this row shape, permanently invisible to reconciliation.
 *
 * Why this is safe and doesn't introduce a new race:
 * - In the normal (non-crash) path, `resolveSubmission` always runs
 *   synchronously afterward, in the same single-threaded execution as this
 *   call — it unconditionally overwrites this provisional value with the
 *   real final status (`SETTLED`/`FAILED`/`RECOVERABLE`) before
 *   `settleAndRecord` returns. There is no window in which a caller can
 *   observe this provisional value as if it were final.
 * - If the process crashes AFTER a payment actually settles but BEFORE
 *   `resolveSubmission`'s write lands, the row is left showing
 *   `RECOVERABLE` even though the payment succeeded. This is not a new
 *   problem — it is exactly the scenario `sweepRecoverablePayments`
 *   already exists to correctly resolve on the next startup, by querying
 *   Hedera directly by the persisted transaction ID rather than trusting
 *   the DB's last-known status.
 * - Only ever called once `isSettlementConfigured()` has already returned
 *   true (see settlement.ts) — a payment where Hedera isn't configured at
 *   all must keep its `NULL` status, its intentional, permanent "stays at
 *   SUBMITTED" terminal state (docs/SETTLEMENT_INTEGRATION_PROPOSAL.md
 *   "Design A"), rather than being marked RECOVERABLE for a settlement
 *   attempt that was never going to be made.
 * - A crash before ANY dispatch was ever attempted (no transaction ID
 *   exists yet) still leaves `hedera_transaction_id` NULL on this row,
 *   which `getRecoverableSubmissions()` correctly continues to exclude —
 *   there is nothing to reconcile against without a transaction ID. That
 *   narrower case (also: a crash during Ledger signing itself, before this
 *   row exists at all) is not fixed by this change; see the audit's Fix 3
 *   report for why that residual gap is out of this fix's scope.
 */
export function markProvisionallyRecoverable(nonce: string): void {
  updateSubmissionStatusStatement.run("RECOVERABLE", nonce);
}

// ---------------------------------------------------------------------------
// RESERVED
// ---------------------------------------------------------------------------

/**
 * The 3 invariant clauses (SECURITY_INVARIANT.md) inherently tied to the
 * RESERVED transition's atomicity — the remaining 6 field-matching clauses
 * are Broker.authorize's job (task 1.6), checked before reservePayment is
 * ever called.
 */
export type ReservationFailureReason = "REPLAY" | "STALE_NONCE" | "BUDGET_EXCEEDED";

export type ReservePaymentResult =
  | { readonly ok: true; readonly state: ReservedPaymentState }
  | { readonly ok: false; readonly reason: ReservationFailureReason };

/**
 * Atomically reserves a payment against an issued capability: burns the
 * nonce and checks/reserves the task budget together, in one transaction,
 * with no gap between checking either constraint and consuming it
 * (CAPABILITY_SPEC.md "Atomicity note"). Neither takes effect unless both
 * succeed.
 *
 * Throws if no capability with `capabilityId` exists — a lookup miss is a
 * routing-layer concern (404, per docs/PROTOCOL.md §6), not one of the 9
 * invariant clauses.
 */
const reservePaymentTransaction = db.transaction(
  (capabilityId: CapabilityId, taskHash: Task["taskHash"], amount: Task["maxTotalSpend"]): ReservePaymentResult => {
    const row = selectCapabilityStatement.get(capabilityId);
    if (row === undefined) {
      throw new Error(`reservePayment: no capability with capabilityId "${capabilityId}"`);
    }

    if (row.consumed !== 0) {
      return { ok: false, reason: "REPLAY" };
    }

    if (new Date(row.expiry).getTime() <= Date.now()) {
      return { ok: false, reason: "STALE_NONCE" };
    }

    const budgetReserved = tryReserveBudget(taskHash, amount);
    if (!budgetReserved) {
      return { ok: false, reason: "BUDGET_EXCEEDED" };
    }

    markConsumedStatement.run(capabilityId);

    const capability = rowToCapability(row);
    const issuedFrom: IssuedPaymentState = issuedPaymentStateSchema.parse({
      status: "ISSUED",
      capability,
    });
    const state: ReservedPaymentState = reservedPaymentStateSchema.parse({
      status: "RESERVED",
      capability,
      issuedFrom,
    });

    return { ok: true, state };
  },
);

export function reservePayment(
  capabilityId: CapabilityId,
  taskHash: Task["taskHash"],
  amount: Task["maxTotalSpend"],
): ReservePaymentResult {
  return reservePaymentTransaction(capabilityId, taskHash, amount);
}

// ---------------------------------------------------------------------------
// SUBMITTED
// ---------------------------------------------------------------------------

/**
 * Constructs and signs the canonical payment request as part of the
 * RESERVED -> SUBMITTED transition (docs/PROTOCOL.md §1: "signing is not a
 * separate transition — it happens as part of" this one). `signer` may be
 * the Phase 1 stub (synchronous) or the real Ledger-backed signer (async —
 * its device I/O runs off the main thread; see signer.ts's `ledgerSign`),
 * selected via signer.ts's `resolveSigner`.
 */
export async function submitPayment(
  reserved: ReservedPaymentState,
  signer: (payload: string) => string | Promise<string>,
): Promise<SubmittedPaymentState> {
  const payload = canonicalize(reserved.capability);
  const signature = await signer(payload);
  const submittedAt = new Date().toISOString();

  insertSubmissionStatement.run(reserved.capability.nonce, signature, submittedAt);

  return submittedPaymentStateSchema.parse({
    status: "SUBMITTED",
    capability: reserved.capability,
    reservedFrom: reserved,
  });
}

// ---------------------------------------------------------------------------
// SETTLED / RECOVERABLE / FAILED
// ---------------------------------------------------------------------------

export type SubmissionOutcome = "settled" | "failed" | "unknown";

/**
 * Resolves a SUBMITTED payment per CAPABILITY_SPEC.md's "Triggering
 * conditions for RECOVERABLE and FAILED": "settled" -> SETTLED (confirmed),
 * "failed" -> FAILED (a definitive negative result, no reconciliation
 * needed), "unknown" -> RECOVERABLE (no confirmation received; the correct
 * next step is reconciliation by transaction ID against the settlement
 * network, not a blind retry). This function only maps `outcome` to the
 * right transition — it doesn't talk to Hedera or decide what `outcome`
 * is itself; `outcome` is always supplied by the caller.
 *
 * As of task 4.1 (docs/SETTLEMENT_INTEGRATION_PROPOSAL.md "Design A"),
 * that caller is `apps/broker/src/settlement.ts`'s `settleAndRecord`,
 * called fire-and-forget from routes/pay.ts after a payment reaches
 * SUBMITTED — it calls `packages/settlement`'s `submitToHedera` (and, for
 * "unknown", one immediate `queryHederaTransactionReceipt` reconciliation
 * attempt) and passes the real derived outcome in here. This function's
 * own transition logic is unchanged by that wiring.
 */
export function resolveSubmission(
  submitted: SubmittedPaymentState,
  outcome: SubmissionOutcome,
): SettledPaymentState | FailedPaymentState | RecoverablePaymentState {
  if (outcome === "settled") {
    updateSubmissionStatusStatement.run("SETTLED", submitted.capability.nonce);
    return settledPaymentStateSchema.parse({
      status: "SETTLED",
      capability: submitted.capability,
      submittedFrom: submitted,
    });
  }

  if (outcome === "failed") {
    updateSubmissionStatusStatement.run("FAILED", submitted.capability.nonce);
    return failedPaymentStateSchema.parse({
      status: "FAILED",
      capability: submitted.capability,
      submittedFrom: submitted,
    });
  }

  updateSubmissionStatusStatement.run("RECOVERABLE", submitted.capability.nonce);
  return recoverablePaymentStateSchema.parse({
    status: "RECOVERABLE",
    capability: submitted.capability,
    submittedFrom: submitted,
  });
}
