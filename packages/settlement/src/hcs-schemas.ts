/**
 * Zod schemas and hand-written interfaces for the three HCS audit-log event
 * types: capability issuance, authorization decisions, and settlement
 * outcomes. Every message logged to HCS must conform to one of these shapes.
 *
 * Pattern: Zod schema (runtime validation) + hand-written interface (hover
 * JSDoc), kept in sync by a `_assertXShape` function per
 * packages/types/src/index.ts's established convention.
 *
 * @see docs/ARCHITECTURE.md "Architecture: core vs. optional" (HCS is optional)
 * @see docs/SECURITY_INVARIANT.md for the 9 AuthorizationFailureReason values
 * @see docs/CAPABILITY_SPEC.md "The Capability object" and "The payment state machine"
 */
import { z } from "zod";
import { authorizationFailureReasonSchema, type AuthorizationFailureReason } from "@paybound/capability-spec";

// ---------------------------------------------------------------------------
// CapabilityIssuedEvent
// ---------------------------------------------------------------------------

/**
 * Schema for a capability-issuance audit event. Logged when the capability
 * issuer (task 1.3) produces a new Capability.
 *
 * Note: `nonce` is deliberately excluded — it is the Broker's internal
 * replay-defense token and must never appear in any externally-readable log.
 * This follows the same nonce-omission convention as `PublicCapability` in
 * packages/types/src/index.ts.
 */
export const capabilityIssuedEventSchema = z
  .object({
    /** Discriminator for this message type. */
    eventType: z.literal("capability_issued"),
    /** ISO 8601 timestamp of the issuance event. */
    timestamp: z.string(),
    /** Hash of the canonical task definition. @see CAPABILITY_SPEC.md field: task_hash */
    taskHash: z.string(),
    /** UUID of the pre-vetted resource registry entry. @see CAPABILITY_SPEC.md field: resource_id */
    resourceId: z.string(),
    /** Destination address, fixed at vetting time. @see CAPABILITY_SPEC.md field: recipient */
    recipient: z.string(),
    /** The exact amount to be paid as a decimal string. @see CAPABILITY_SPEC.md field: exact_amount */
    exactAmount: z.string(),
    /** Hash binding what this payment is for. @see CAPABILITY_SPEC.md field: payment_request_hash */
    paymentRequestHash: z.string(),
    /** The sandbox's attested workload identity. @see CAPABILITY_SPEC.md field: session */
    session: z.string(),
    /** ISO 8601 expiry timestamp. @see CAPABILITY_SPEC.md field: expiry */
    expiry: z.string(),
  })
  .readonly()
  .describe("HCS audit event: a capability was issued (nonce excluded — Broker-internal replay-defense token).");

/**
 * A capability-issuance audit event. Logged when the capability issuer
 * produces a new Capability. `nonce` is deliberately excluded — see
 * `PublicCapability` in packages/types/src/index.ts for the established
 * convention and rationale.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `capabilityIssuedEventSchema` by `_assertCapabilityIssuedEventShape` below.
 */
export interface CapabilityIssuedEvent {
  readonly eventType: "capability_issued";
  readonly timestamp: string;
  readonly taskHash: string;
  readonly resourceId: string;
  readonly recipient: string;
  readonly exactAmount: string;
  readonly paymentRequestHash: string;
  readonly session: string;
  readonly expiry: string;
}

function _assertCapabilityIssuedEventShape(
  x: z.infer<typeof capabilityIssuedEventSchema>,
): CapabilityIssuedEvent {
  return x;
}

// ---------------------------------------------------------------------------
// AuthorizationDecisionEvent
// ---------------------------------------------------------------------------

/**
 * Schema for an authorization-decision audit event. Logged on every
 * Broker.authorize(payment) call, whether it succeeds or fails.
 *
 * On success: `authorized: true`, `reason: null`.
 * On failure: `authorized: false`, `reason` is one of the 9 named clauses
 * from SECURITY_INVARIANT.md (imported from @paybound/capability-spec, not
 * redefined here).
 */
export const authorizationDecisionEventSchema = z
  .object({
    /** Discriminator for this message type. */
    eventType: z.literal("authorization_decision"),
    /** ISO 8601 timestamp of the authorization decision. */
    timestamp: z.string(),
    /** The taskHash being authorized against. */
    taskHash: z.string(),
    /** The resourceId being authorized against. */
    resourceId: z.string(),
    /** Whether the authorization succeeded. */
    authorized: z.boolean(),
    /**
     * Which invariant clause failed, or null on success.
     * Typed as AuthorizationFailureReason (9 values from SECURITY_INVARIANT.md)
     * or null — never redefined here.
     * @see docs/SECURITY_INVARIANT.md
     */
    reason: authorizationFailureReasonSchema.nullable(),
  })
  .readonly()
  .describe("HCS audit event: a Broker.authorize(payment) decision (success or failure with named clause).");

/**
 * An authorization-decision audit event. Logged on every
 * Broker.authorize(payment) call. `reason` is null on success and one of the
 * 9 `AuthorizationFailureReason` values (SECURITY_INVARIANT.md) on failure.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `authorizationDecisionEventSchema` by `_assertAuthorizationDecisionEventShape` below.
 */
export interface AuthorizationDecisionEvent {
  readonly eventType: "authorization_decision";
  readonly timestamp: string;
  readonly taskHash: string;
  readonly resourceId: string;
  readonly authorized: boolean;
  /** null on success; one of the 9 SECURITY_INVARIANT.md clause names on failure. */
  readonly reason: AuthorizationFailureReason | null;
}

function _assertAuthorizationDecisionEventShape(
  x: z.infer<typeof authorizationDecisionEventSchema>,
): AuthorizationDecisionEvent {
  return x;
}

// ---------------------------------------------------------------------------
// SettlementOutcomeEvent
// ---------------------------------------------------------------------------

/**
 * Schema for a settlement-outcome audit event. Logged after
 * `submitToHedera()` (task 4.1) resolves, recording the transaction ID and
 * receipt status returned by the Hedera network.
 */
export const settlementOutcomeEventSchema = z
  .object({
    /** Discriminator for this message type. */
    eventType: z.literal("settlement_outcome"),
    /** ISO 8601 timestamp of when the settlement outcome was observed. */
    timestamp: z.string(),
    /** The taskHash of the capability whose payment was settled. */
    taskHash: z.string(),
    /** The Hedera transaction ID returned by submitToHedera() (task 4.1). */
    hederaTransactionId: z.string(),
    /** The receipt status string returned by submitToHedera() (e.g. "SUCCESS"). */
    status: z.string(),
  })
  .readonly()
  .describe("HCS audit event: a Hedera settlement outcome (transactionId + receipt status).");

/**
 * A settlement-outcome audit event. Logged after task 4.1's
 * `submitToHedera()` resolves. `hederaTransactionId` and `status` come
 * directly from `submitToHedera()`'s return value.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `settlementOutcomeEventSchema` by `_assertSettlementOutcomeEventShape` below.
 */
export interface SettlementOutcomeEvent {
  readonly eventType: "settlement_outcome";
  readonly timestamp: string;
  readonly taskHash: string;
  readonly hederaTransactionId: string;
  readonly status: string;
}

function _assertSettlementOutcomeEventShape(
  x: z.infer<typeof settlementOutcomeEventSchema>,
): SettlementOutcomeEvent {
  return x;
}

// ---------------------------------------------------------------------------
// HcsEvent — discriminated union of all three
// ---------------------------------------------------------------------------

/**
 * Zod discriminated union over all three HCS event types, keyed on
 * `eventType`. Follows the same pattern as `paymentStateSchema` /
 * `PublicPaymentState` in packages/types/src/index.ts.
 *
 * Use this to parse/validate an arbitrary message read back from the HCS
 * mirror node.
 */
export const hcsEventSchema = z.discriminatedUnion("eventType", [
  capabilityIssuedEventSchema,
  authorizationDecisionEventSchema,
  settlementOutcomeEventSchema,
]);

/** Union of all three HCS audit event types. */
export type HcsEvent =
  | CapabilityIssuedEvent
  | AuthorizationDecisionEvent
  | SettlementOutcomeEvent;

