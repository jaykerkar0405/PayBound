import type { AuthorizePaymentInput, AuthorizationResult } from "@paybound/capability-spec";
import { getCapabilityIdByNonce, reservePayment } from "./state-machine.js";

/**
 * Broker.authorize(payment) — the single invariant from SECURITY_INVARIANT.md,
 * enforced as a flat conjunction of 9 clauses. There is no partial
 * authorization: any failing clause hard-fails the payment with its
 * specific named reason, and no later clause can "fix" an earlier failure.
 *
 * Clauses 1-6 (amount, destination, resource, task_hash, session,
 * payment_request_hash) are pure field comparisons between `payment` and
 * `capability`, checked here directly, in this fixed order, before any
 * state is touched — so a payment doomed by clause 1-6 never burns a nonce
 * or touches a budget.
 *
 * Clauses 7-9 (replay, stale nonce, over-budget) are inherently tied to the
 * atomic RESERVED transition (CAPABILITY_SPEC.md) and are delegated to
 * state-machine.ts's reservePayment, only once clauses 1-6 have all passed.
 * On success, the real ReservedPaymentState reservePayment produced is
 * returned as part of AuthorizationResult (packages/types) rather than
 * discarded — callers (e.g. the pay() route, task 1.7) use it directly
 * instead of reconstructing an equivalent value from a second lookup.
 */
export function authorize(input: AuthorizePaymentInput): AuthorizationResult {
  const { payment, capability, task } = input;

  if (payment.amount !== capability.exactAmount) {
    return { authorized: false, reason: "AMOUNT_MISMATCH" };
  }
  if (payment.destination !== capability.recipient) {
    return { authorized: false, reason: "SUBSTITUTION" };
  }
  if (payment.resource !== capability.resourceId) {
    return { authorized: false, reason: "RESOURCE_MISMATCH" };
  }
  if (payment.taskHash !== capability.taskHash) {
    return { authorized: false, reason: "TASK_HASH_MISMATCH" };
  }
  if (payment.session !== capability.session) {
    return { authorized: false, reason: "SESSION_MISMATCH" };
  }
  if (payment.paymentRequestHash !== capability.paymentRequestHash) {
    return { authorized: false, reason: "REQUEST_FORGERY" };
  }

  const capabilityId = getCapabilityIdByNonce(capability.nonce);
  if (capabilityId === undefined) {
    throw new Error(`authorize: no issued capability record found for nonce "${capability.nonce}"`);
  }

  const reservation = reservePayment(capabilityId, task.taskHash, payment.amount);
  if (!reservation.ok) {
    return { authorized: false, reason: reservation.reason };
  }

  return { authorized: true, state: reservation.state };
}
