/**
 * Runtime validation entry point for PayBound.
 *
 * `@paybound/types` is now the single source of truth for both shape and
 * validation: every schema is defined there as a Zod schema, with the
 * TypeScript type derived from it via `z.infer`. This package no longer
 * defines a parallel set of schemas — it is a thin consumption layer that
 * re-exports those schemas for use at actual runtime-validation call sites
 * (e.g. wiring a schema into `@hono/zod-validator` in `apps/broker`).
 *
 * @see ../../types/src/index.ts for every schema's field-level JSDoc and its
 *   citation back to docs/CAPABILITY_SPEC.md, docs/SECURITY_INVARIANT.md,
 *   docs/THREAT_MODEL.md, and docs/TASKS.md.
 */
export {
  capabilitySchema,
  taskSchema,
  resourceRegistryEntrySchema,
  issuedPaymentStateSchema,
  reservedPaymentStateSchema,
  recoverablePaymentStateSchema,
  submittedPaymentStateSchema,
  settledPaymentStateSchema,
  failedPaymentStateSchema,
  paymentStateSchema,
  capabilityIdSchema,
  payRequestSchema,
  payResponseSchema,
  paymentAuthorizationRequestSchema,
  authorizePaymentInputSchema,
  authorizationFailureReasonSchema,
  authorizationResultSchema,
  type Capability,
  type Task,
  type ResourceRegistryEntry,
  type IssuedPaymentState,
  type ReservedPaymentState,
  type RecoverablePaymentState,
  type SubmittedPaymentState,
  type SettledPaymentState,
  type FailedPaymentState,
  type PaymentState,
  type CapabilityId,
  type PayRequest,
  type PayResponse,
  type PaymentAuthorizationRequest,
  type AuthorizePaymentInput,
  type AuthorizationFailureReason,
  type AuthorizationResult,
} from "@paybound/types";
