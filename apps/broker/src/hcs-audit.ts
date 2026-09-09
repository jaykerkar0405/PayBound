/**
 * Thin, fire-and-forget wrappers around @paybound/settlement's HCS logging
 * functions (task 4.2) for the two call sites that don't otherwise need
 * anything settlement-specific: capability issuance (issuer.ts) and
 * authorization decisions (routes/pay.ts). settlement.ts's `settleAndRecord`
 * handles its own settlement-outcome logging directly, since that call site
 * needs the real Hedera transaction ID threaded through — see that file.
 *
 * Each function never throws: a failure to reach HCS (missing
 * HEDERA_HCS_TOPIC_ID, network error, ...) is logged and swallowed, since
 * HCS audit logging is an optional trust service, not load-bearing for the
 * core security guarantee (docs/ARCHITECTURE.md). Callers should invoke
 * these fire-and-forget (`void auditXxx(...)`), never awaited in a
 * request/response path.
 *
 * The optional second parameter on each function exists purely for testing
 * — pass a fake in place of the real @paybound/settlement function to
 * assert on how it's called, with no module mocking required.
 */
import {
  logCapabilityIssued,
  logAuthorizationDecision,
  type CapabilityIssuedEvent,
  type AuthorizationDecisionEvent,
} from "@paybound/settlement";

export async function auditCapabilityIssued(
  event: CapabilityIssuedEvent,
  logFn: typeof logCapabilityIssued = logCapabilityIssued,
): Promise<void> {
  try {
    await logFn(event);
  } catch (error) {
    console.error(
      `[AUDIT] HCS logCapabilityIssued failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function auditAuthorizationDecision(
  event: AuthorizationDecisionEvent,
  logFn: typeof logAuthorizationDecision = logAuthorizationDecision,
): Promise<void> {
  try {
    await logFn(event);
  } catch (error) {
    console.error(
      `[AUDIT] HCS logAuthorizationDecision failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
