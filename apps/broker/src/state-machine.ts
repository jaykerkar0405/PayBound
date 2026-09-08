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

const insertSubmissionStatement = db.prepare<[string, string, string]>(
  "INSERT INTO payment_submissions (nonce, signature, submitted_at) VALUES (?, ?, ?)",
);

const updateSubmissionStatusStatement = db.prepare<[string, string]>(
  "UPDATE payment_submissions SET status = ? WHERE nonce = ?",
);

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
 * separate transition — it happens as part of" this one). `signer` should
 * be a stub signer in Phase 1 (see signer.ts); real Ledger signing is task
 * 3.1.
 */
export function submitPayment(
  reserved: ReservedPaymentState,
  signer: (payload: string) => string,
): SubmittedPaymentState {
  const payload = canonicalize(reserved.capability);
  const signature = signer(payload);
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
 * network, not a blind retry — reconciliation itself is out of scope here,
 * gated on real Hedera settlement, tasks 4.1/4.3). In Phase 1, with no real
 * settlement network, `outcome` is supplied by the caller rather than
 * derived from a real response.
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
