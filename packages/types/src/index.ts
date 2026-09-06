/**
 * Placeholder shared types for PayBound. Field lists are NOT final — they will
 * be locked down when docs/TASKS.md task 0.3 (CAPABILITY_SPEC.md) is written.
 *
 * The pattern established here (every field `readonly`, nested objects wrapped
 * in `Readonly<...>`) is the point of this package right now: Capability and
 * Task objects must be structurally tamper-proof to the type system, not just
 * by convention, once Broker code (tasks 1.3, 1.5, 1.6) starts consuming them.
 */

/** A trusted, unforgeable, single-use grant of exactly one payment. */
export type Capability = Readonly<{
  taskHash: string;
  resourceId: string;
  recipient: string;
  exactAmount: string;
  paymentRequestHash: string;
  session: string;
  nonce: string;
  expiry: string;
  maxUses: 1;
}>;

/** Broker-maintained spend budget for a single task. */
export type Task = Readonly<{
  taskHash: string;
  maxTotalSpend: string;
  spentSoFar: string;
}>;

/** Payment state machine states (see README § Payment State Machine). */
export type PaymentState =
  "ISSUED" | "RESERVED" | "SUBMITTED" | "SETTLED" | "RECOVERABLE" | "FAILED";

/** Placeholder Broker<->sandbox protocol message shape (finalized in task 0.4). */
export type PayRequest = Readonly<{
  capabilityId: string;
}>;

export type PayResponse = Readonly<{
  state: PaymentState;
  paymentId: string;
}>;
