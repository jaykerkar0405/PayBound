/**
 * Shared types AND runtime schemas for PayBound, defined strictly from the
 * project's Phase 0 specification docs:
 *
 * @see ../../../docs/CAPABILITY_SPEC.md    Capability/Task objects, state machine
 * @see ../../../docs/SECURITY_INVARIANT.md Broker.authorize(payment) invariant
 * @see ../../../docs/THREAT_MODEL.md       trust boundary (resource registry, etc.)
 * @see ../../../docs/ARCHITECTURE.md       component map, Broker<->Sandbox pay() flow
 * @see ../../../docs/TASKS.md              task 1.2 (resource registry), 1.3 (issuance)
 * @see ../../../docs/OPEN_QUESTIONS.md     interpretive gaps flagged/resolved during drafting
 *
 * SOURCE OF TRUTH FOR SHAPE AND VALIDATION: every schema below is a Zod
 * schema, and it alone determines field names, field types, and runtime
 * validation behavior (including `.readonly()` freezing). Schemas are never
 * hand-duplicated elsewhere — `@paybound/capability-spec` no longer defines
 * its own schemas, it imports and re-exports the ones below for use at
 * actual runtime-validation call sites (e.g. `@hono/zod-validator`).
 *
 * SOURCE OF TRUTH FOR THE EXPORTED TYPE: for simple field-level primitives
 * (`Hash`, `Uuid`, `Address`, `Decimal`, `PublicKey`, `UniqueId`,
 * `Timestamp`) the exported type is still `z.infer<typeof xSchema>` — there
 * is no per-field documentation to lose on a bare string alias. For every
 * object/union type a teammate is meant to read field-by-field (Capability,
 * Task, ResourceRegistryEntry, the payment-state types, PayRequest,
 * PayResponse, CapabilityId, and the authorization types), the exported type
 * is instead a **hand-written `interface`/`type`** carrying its own
 * "field-level JSDoc, copied verbatim from the schema's field comments. This
 * is deliberate: TypeScript does not propagate a `.describe()`/JSDoc pair
 * written above a `z.object({...})` field into hover tooltips for the
 * `z.infer`-derived type's properties, so a purely `z.infer`-based export
 * regresses documentation quality even though the JSDoc still exists in this
 * file. Editors show interface field JSDoc on hover; they do not show
 * `z.infer` field JSDoc on hover. Hence: two representations, kept in sync
 * on purpose.
 *
 * KEEPING THE TWO IN SYNC: each hand-written interface/type is immediately
 * followed by an unexported `_assertXShape` function whose parameter is
 * typed as `z.infer<typeof xSchema>` and whose return type is the
 * hand-written type. Because parameter and return types are always
 * type-checked, this function fails to compile the moment the schema and
 * the hand-written type diverge — a real, enforced check, unlike an earlier
 * pattern in this file (`_AssertX = z.infer<...> extends X ? true : never`)
 * that silently no-op'd because the resulting type alias was never consumed
 * anywhere.
 *
 * Every schema is `.readonly()` and nested object schemas are built from
 * other `.readonly()` schemas; every hand-written interface mirrors that
 * with `readonly` on every field. Capability and Task objects must be
 * structurally tamper-proof to the type system, not just by convention,
 * since the core security claim ("the agent cannot construct a payment") is
 * partly a type-system claim (see docs/TECH_STACK_ADR.md "Language/runtime").
 * Do not loosen this pattern.
 */
import { z, $brand } from "zod";

// ---------------------------------------------------------------------------
// Field-level primitive schemas
//
// Each corresponds to one of the field-type annotations shown directly in
// CAPABILITY_SPEC.md's `Capability`/`Task` pseudocode blocks (`hash`, `uuid`,
// `address`, `decimal`, `public_key`, `unique_id`, `timestamp`).
// ---------------------------------------------------------------------------

/**
 * An opaque content hash, e.g. `H(canonical task definition)`.
 * @see CAPABILITY_SPEC.md Capability field types: `task_hash: hash`, `payment_request_hash: hash`
 */
export const hashSchema = z
  .string()
  .describe("An opaque content hash (CAPABILITY_SPEC.md field type: hash).");
export type Hash = z.infer<typeof hashSchema>;

/**
 * A UUID identifying an entry in the trusted resource registry.
 * @see CAPABILITY_SPEC.md Capability field: `resource_id: uuid`
 */
export const uuidSchema = z
  .string()
  .describe("A UUID identifying a trusted resource registry entry (CAPABILITY_SPEC.md field type: uuid).");
export type Uuid = z.infer<typeof uuidSchema>;

/**
 * A payment destination address, fixed at vetting time.
 * @see CAPABILITY_SPEC.md Capability field: `recipient: address`
 */
export const addressSchema = z
  .string()
  .describe("A payment destination address, fixed at vetting time (CAPABILITY_SPEC.md field type: address).");
export type Address = z.infer<typeof addressSchema>;

/**
 * An exact decimal amount. Represented as a string (not `number`) to avoid
 * floating-point drift in a value that a `Broker.authorize` equality check
 * depends on.
 * @see CAPABILITY_SPEC.md Capability field: `exact_amount: decimal`
 * @see CAPABILITY_SPEC.md Task fields: `max_total_spend: decimal`, `spent_so_far: decimal`
 */
export const decimalSchema = z
  .string()
  .describe(
    "An exact decimal amount, encoded as a string to avoid floating-point drift (CAPABILITY_SPEC.md field type: decimal).",
  );
export type Decimal = z.infer<typeof decimalSchema>;

/**
 * The sandbox's attested workload identity, established before the agent is
 * exposed to any untrusted content. Authenticates the Broker channel; does
 * not by itself authorize any individual payment.
 * @see CAPABILITY_SPEC.md Capability field: `session: public_key`
 * @see THREAT_MODEL.md "Sandbox attestation"
 */
export const publicKeySchema = z
  .string()
  .describe(
    "The sandbox's attested workload identity public key (CAPABILITY_SPEC.md field type: public_key).",
  );
export type PublicKey = z.infer<typeof publicKeySchema>;

/**
 * A single-use identifier, burned atomically on use. Internal to the
 * Broker's replay-defense mechanism — see the `CapabilityId` section below
 * for why this is never the same value as the sandbox-facing lookup handle.
 * @see CAPABILITY_SPEC.md Capability field: `nonce: unique_id`
 * @see SECURITY_INVARIANT.md clause: `capability.nonce is unconsumed`
 */
export const uniqueIdSchema = z
  .string()
  .describe(
    "A single-use identifier burned atomically on use (CAPABILITY_SPEC.md field type: unique_id).",
  );
export type UniqueId = z.infer<typeof uniqueIdSchema>;

/**
 * An ISO 8601 timestamp.
 * @see CAPABILITY_SPEC.md Capability field: `expiry: timestamp`
 * @see SECURITY_INVARIANT.md clause: `now < capability.expiry`
 */
export const timestampSchema = z
  .string()
  .describe("An ISO 8601 timestamp (CAPABILITY_SPEC.md field type: timestamp).");
export type Timestamp = z.infer<typeof timestampSchema>;

// ---------------------------------------------------------------------------
// Capability / Task
// ---------------------------------------------------------------------------

/**
 * A trusted, unforgeable, single-use grant of exactly one payment, issued by
 * the Broker before the agent touches any untrusted input.
 *
 * All 9 fields below are taken directly from CAPABILITY_SPEC.md's
 * `Capability` object definition — no fields have been added or removed.
 *
 * @see CAPABILITY_SPEC.md "The `Capability` object"
 */
export const capabilitySchema = z
  .object({
    /**
     * Hash of the canonical task definition. Not a version number — a
     * content hash, so any change to the task's meaning changes the hash.
     * Scopes the capability to a specific task.
     * @see CAPABILITY_SPEC.md field: `task_hash`
     * @see SECURITY_INVARIANT.md clause: `payment.task_hash == capability.task_hash`
     */
    taskHash: hashSchema.describe(
      "Hash of the canonical task definition (CAPABILITY_SPEC.md: task_hash). Scopes the capability to one task.",
    ),

    /**
     * UUID bound to an entry in the trusted resource registry. Scopes the
     * capability to one specific, pre-vetted resource.
     * @see CAPABILITY_SPEC.md field: `resource_id`
     * @see SECURITY_INVARIANT.md clause: `payment.resource == capability.resource_id`
     * @see THREAT_MODEL.md "Resource registry"
     */
    resourceId: uuidSchema.describe(
      "UUID of the resource registry entry this capability is bound to (CAPABILITY_SPEC.md: resource_id).",
    ),

    /**
     * Destination address, fixed at vetting time and immutable thereafter.
     * @see CAPABILITY_SPEC.md field: `recipient`
     * @see SECURITY_INVARIANT.md clause: `payment.destination == capability.recipient`
     */
    recipient: addressSchema.describe(
      "Destination address, fixed at vetting time and immutable thereafter (CAPABILITY_SPEC.md: recipient).",
    ),

    /**
     * The exact amount to be paid. Exact, not "up to" — there is no dynamic
     * pricing in the MVP, so this is a fixed value, not a ceiling.
     * @see CAPABILITY_SPEC.md field: `exact_amount`
     * @see SECURITY_INVARIANT.md clause: `payment.amount == capability.exact_amount`
     */
    exactAmount: decimalSchema.describe(
      "The exact amount to be paid; not a ceiling (CAPABILITY_SPEC.md: exact_amount).",
    ),

    /**
     * Hash binding *what* this payment is for, distinct from where it goes
     * or how much it costs.
     * @see CAPABILITY_SPEC.md field: `payment_request_hash`
     * @see SECURITY_INVARIANT.md clause: `payment.payment_request_hash == capability.payment_request_hash`
     */
    paymentRequestHash: hashSchema.describe(
      "Hash binding what this payment is for, distinct from destination/amount (CAPABILITY_SPEC.md: payment_request_hash).",
    ),

    /**
     * The sandbox's attested workload identity this capability is bound to.
     * @see CAPABILITY_SPEC.md field: `session`
     * @see SECURITY_INVARIANT.md clause: `payment.session == capability.session`
     */
    session: publicKeySchema.describe(
      "The sandbox's attested workload identity this capability is bound to (CAPABILITY_SPEC.md: session).",
    ),

    /**
     * Unique identifier burned atomically on use. Burning it is what makes
     * reuse (replay) structurally impossible, per CAPABILITY_SPEC.md's
     * atomicity note on the `RESERVED` state. Internal to the Broker; never
     * exposed to or handled by the untrusted sandbox domain (that domain
     * uses `CapabilityId` instead — see below).
     * @see CAPABILITY_SPEC.md field: `nonce`
     * @see SECURITY_INVARIANT.md clause: `capability.nonce is unconsumed`
     */
    nonce: uniqueIdSchema.describe(
      "Single-use identifier burned atomically on use; the Broker's internal replay-defense token (CAPABILITY_SPEC.md: nonce).",
    ),

    /**
     * Timestamp after which the capability is no longer valid. Short-lived
     * by default.
     * @see CAPABILITY_SPEC.md field: `expiry`
     * @see SECURITY_INVARIANT.md clause: `now < capability.expiry`
     */
    expiry: timestampSchema.describe(
      "Timestamp after which the capability is no longer valid (CAPABILITY_SPEC.md: expiry).",
    ),

    /**
     * Fixed at 1 unless explicitly justified otherwise: capabilities are
     * single-use.
     * @see CAPABILITY_SPEC.md field: `max_uses`
     */
    maxUses: z
      .literal(1)
      .describe("Fixed at 1; capabilities are single-use unless explicitly justified otherwise (CAPABILITY_SPEC.md: max_uses)."),
  })
  .readonly()
  .describe("A trusted, unforgeable, single-use grant of exactly one payment (CAPABILITY_SPEC.md: the Capability object).");

/**
 * A trusted, unforgeable, single-use grant of exactly one payment, issued by
 * the Broker before the agent touches any untrusted input.
 *
 * All 9 fields below are taken directly from CAPABILITY_SPEC.md's
 * `Capability` object definition — no fields have been added or removed.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `capabilitySchema` by `_assertCapabilityShape` below.
 * @see CAPABILITY_SPEC.md "The `Capability` object"
 */
export interface Capability {
  /**
   * Hash of the canonical task definition. Not a version number — a
   * content hash, so any change to the task's meaning changes the hash.
   * Scopes the capability to a specific task.
   * @see CAPABILITY_SPEC.md field: `task_hash`
   * @see SECURITY_INVARIANT.md clause: `payment.task_hash == capability.task_hash`
   */
  readonly taskHash: Hash;

  /**
   * UUID bound to an entry in the trusted resource registry. Scopes the
   * capability to one specific, pre-vetted resource.
   * @see CAPABILITY_SPEC.md field: `resource_id`
   * @see SECURITY_INVARIANT.md clause: `payment.resource == capability.resource_id`
   * @see THREAT_MODEL.md "Resource registry"
   */
  readonly resourceId: Uuid;

  /**
   * Destination address, fixed at vetting time and immutable thereafter.
   * @see CAPABILITY_SPEC.md field: `recipient`
   * @see SECURITY_INVARIANT.md clause: `payment.destination == capability.recipient`
   */
  readonly recipient: Address;

  /**
   * The exact amount to be paid. Exact, not "up to" — there is no dynamic
   * pricing in the MVP, so this is a fixed value, not a ceiling.
   * @see CAPABILITY_SPEC.md field: `exact_amount`
   * @see SECURITY_INVARIANT.md clause: `payment.amount == capability.exact_amount`
   */
  readonly exactAmount: Decimal;

  /**
   * Hash binding *what* this payment is for, distinct from where it goes
   * or how much it costs.
   * @see CAPABILITY_SPEC.md field: `payment_request_hash`
   * @see SECURITY_INVARIANT.md clause: `payment.payment_request_hash == capability.payment_request_hash`
   */
  readonly paymentRequestHash: Hash;

  /**
   * The sandbox's attested workload identity this capability is bound to.
   * @see CAPABILITY_SPEC.md field: `session`
   * @see SECURITY_INVARIANT.md clause: `payment.session == capability.session`
   */
  readonly session: PublicKey;

  /**
   * Unique identifier burned atomically on use. Burning it is what makes
   * reuse (replay) structurally impossible, per CAPABILITY_SPEC.md's
   * atomicity note on the `RESERVED` state. Internal to the Broker; never
   * exposed to or handled by the untrusted sandbox domain (that domain
   * uses `CapabilityId` instead — see below).
   * @see CAPABILITY_SPEC.md field: `nonce`
   * @see SECURITY_INVARIANT.md clause: `capability.nonce is unconsumed`
   */
  readonly nonce: UniqueId;

  /**
   * Timestamp after which the capability is no longer valid. Short-lived
   * by default.
   * @see CAPABILITY_SPEC.md field: `expiry`
   * @see SECURITY_INVARIANT.md clause: `now < capability.expiry`
   */
  readonly expiry: Timestamp;

  /**
   * Fixed at 1 unless explicitly justified otherwise: capabilities are
   * single-use.
   * @see CAPABILITY_SPEC.md field: `max_uses`
   */
  readonly maxUses: 1;
}

/** Compile-time check that `capabilitySchema` and `Capability` stay in sync. */
function _assertCapabilityShape(x: z.infer<typeof capabilitySchema>): Capability {
  return x;
}

/**
 * Broker-maintained spend budget for a single task, scoped by `taskHash`.
 *
 * All 3 fields below are taken directly from CAPABILITY_SPEC.md's `Task`
 * object definition.
 *
 * @see CAPABILITY_SPEC.md "The `Task` object"
 */
export const taskSchema = z
  .object({
    /**
     * The same canonical task hash referenced by every capability issued
     * against this task.
     * @see CAPABILITY_SPEC.md field: `task_hash`
     */
    taskHash: hashSchema.describe(
      "The canonical task hash shared by every capability issued against this task (CAPABILITY_SPEC.md: task_hash).",
    ),

    /**
     * The task's declared spending ceiling, across all capabilities issued
     * against it.
     * @see CAPABILITY_SPEC.md field: `max_total_spend`
     * @see SECURITY_INVARIANT.md clause: `(task.spent_so_far + payment.amount) <= task.max_total_spend`
     */
    maxTotalSpend: decimalSchema.describe(
      "The task's declared spending ceiling across all capabilities issued against it (CAPABILITY_SPEC.md: max_total_spend).",
    ),

    /**
     * Running total spent against this task. Broker-maintained and
     * atomically updated together with nonce-burning at the `RESERVED`
     * transition.
     * @see CAPABILITY_SPEC.md field: `spent_so_far`
     * @see CAPABILITY_SPEC.md "Atomicity note"
     */
    spentSoFar: decimalSchema.describe(
      "Running total spent against this task, Broker-maintained and atomically updated (CAPABILITY_SPEC.md: spent_so_far).",
    ),
  })
  .readonly()
  .describe("Broker-maintained spend budget for a single task (CAPABILITY_SPEC.md: the Task object).");

/**
 * Broker-maintained spend budget for a single task, scoped by `taskHash`.
 *
 * All 3 fields below are taken directly from CAPABILITY_SPEC.md's `Task`
 * object definition.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `taskSchema` by `_assertTaskShape` below.
 * @see CAPABILITY_SPEC.md "The `Task` object"
 */
export interface Task {
  /**
   * The same canonical task hash referenced by every capability issued
   * against this task.
   * @see CAPABILITY_SPEC.md field: `task_hash`
   */
  readonly taskHash: Hash;

  /**
   * The task's declared spending ceiling, across all capabilities issued
   * against it.
   * @see CAPABILITY_SPEC.md field: `max_total_spend`
   * @see SECURITY_INVARIANT.md clause: `(task.spent_so_far + payment.amount) <= task.max_total_spend`
   */
  readonly maxTotalSpend: Decimal;

  /**
   * Running total spent against this task. Broker-maintained and
   * atomically updated together with nonce-burning at the `RESERVED`
   * transition.
   * @see CAPABILITY_SPEC.md field: `spent_so_far`
   * @see CAPABILITY_SPEC.md "Atomicity note"
   */
  readonly spentSoFar: Decimal;
}

/** Compile-time check that `taskSchema` and `Task` stay in sync. */
function _assertTaskShape(x: z.infer<typeof taskSchema>): Task {
  return x;
}

// ---------------------------------------------------------------------------
// Resource registry
// ---------------------------------------------------------------------------

/**
 * A resource registry entry: the pre-vetted `resource_id -> recipient/price`
 * binding a Capability's `resourceId`/`recipient`/`exactAmount` are checked
 * against.
 *
 * @see THREAT_MODEL.md "Resource registry — the pre-vetted set of
 *   `resource_id -> recipient` bindings the task definer draws from."
 * @see ARCHITECTURE.md "Broker ... maintains the resource registry"
 * @see TASKS.md task 1.2: "closed, pre-vetted set of resource_id ->
 *   recipient/price entries"
 */
export const resourceRegistryEntrySchema = z
  .object({
    /**
     * Matches the `resourceId` on any Capability issued against this entry.
     * @see CAPABILITY_SPEC.md field: `resource_id`
     */
    resourceId: uuidSchema.describe(
      "Matches the resourceId on any Capability issued against this entry (CAPABILITY_SPEC.md: resource_id).",
    ),

    /**
     * Matches the `recipient` on any Capability issued against this entry.
     * @see CAPABILITY_SPEC.md field: `recipient`
     */
    recipient: addressSchema.describe(
      "Matches the recipient on any Capability issued against this entry (CAPABILITY_SPEC.md: recipient).",
    ),

    /**
     * The resource's known/expected price. Distinct from a Capability's
     * `exactAmount`: this field lives on the registry entry itself (set when
     * the resource is vetted), not on any individual capability.
     *
     * Intended usage (task 1.3, not yet implemented): at capability
     * issuance time, the Broker should validate that a requested
     * `exactAmount` is consistent with this price, as a defense-in-depth
     * check that is separate from — and happens earlier than —
     * `Broker.authorize(payment)`'s payment-time invariant
     * (SECURITY_INVARIANT.md). `Broker.authorize` never reads this field: it
     * only compares `payment.amount` to `capability.exactAmount`, which is
     * already fixed by the time authorization runs. This field exists to
     * catch a bad `exactAmount` before a capability carrying it is ever
     * issued.
     * @see TASKS.md task 1.2: "closed, pre-vetted set of resource_id ->
     *   recipient/price entries"
     * @see TASKS.md task 1.3: "produces a signed Capability object ...
     *   with max_uses=1 and short expiry"
     */
    price: decimalSchema.describe(
      "The resource's known/expected price, used at issuance time (task 1.3) to validate a requested exact_amount against — not read by Broker.authorize (TASKS.md task 1.2).",
    ),
  })
  .readonly()
  .describe(
    "A pre-vetted resource registry entry: resource_id -> recipient/price (TASKS.md task 1.2; THREAT_MODEL.md Resource registry).",
  );

/**
 * A resource registry entry: the pre-vetted `resource_id -> recipient/price`
 * binding a Capability's `resourceId`/`recipient`/`exactAmount` are checked
 * against.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `resourceRegistryEntrySchema` by `_assertResourceRegistryEntryShape` below.
 * @see THREAT_MODEL.md "Resource registry — the pre-vetted set of
 *   `resource_id -> recipient` bindings the task definer draws from."
 * @see ARCHITECTURE.md "Broker ... maintains the resource registry"
 * @see TASKS.md task 1.2: "closed, pre-vetted set of resource_id ->
 *   recipient/price entries"
 */
export interface ResourceRegistryEntry {
  /**
   * Matches the `resourceId` on any Capability issued against this entry.
   * @see CAPABILITY_SPEC.md field: `resource_id`
   */
  readonly resourceId: Uuid;

  /**
   * Matches the `recipient` on any Capability issued against this entry.
   * @see CAPABILITY_SPEC.md field: `recipient`
   */
  readonly recipient: Address;

  /**
   * The resource's known/expected price. Distinct from a Capability's
   * `exactAmount`: this field lives on the registry entry itself (set when
   * the resource is vetted), not on any individual capability.
   *
   * Intended usage (task 1.3, not yet implemented): at capability
   * issuance time, the Broker should validate that a requested
   * `exactAmount` is consistent with this price, as a defense-in-depth
   * check that is separate from — and happens earlier than —
   * `Broker.authorize(payment)`'s payment-time invariant
   * (SECURITY_INVARIANT.md). `Broker.authorize` never reads this field: it
   * only compares `payment.amount` to `capability.exactAmount`, which is
   * already fixed by the time authorization runs. This field exists to
   * catch a bad `exactAmount` before a capability carrying it is ever
   * issued.
   * @see TASKS.md task 1.2: "closed, pre-vetted set of resource_id ->
   *   recipient/price entries"
   * @see TASKS.md task 1.3: "produces a signed Capability object ...
   *   with max_uses=1 and short expiry"
   */
  readonly price: Decimal;
}

/** Compile-time check that `resourceRegistryEntrySchema` and `ResourceRegistryEntry` stay in sync. */
function _assertResourceRegistryEntryShape(
  x: z.infer<typeof resourceRegistryEntrySchema>,
): ResourceRegistryEntry {
  return x;
}

// ---------------------------------------------------------------------------
// Payment state machine
// ---------------------------------------------------------------------------

/**
 * The `ISSUED` state: the capability issuer has produced a signed
 * `Capability` object from trusted task state. No payment has been
 * attempted yet.
 * @see CAPABILITY_SPEC.md "The payment state machine" — `ISSUED`
 */
export const issuedPaymentStateSchema = z
  .object({
    status: z.literal("ISSUED"),
    /** The capability this payment state is for. */
    capability: capabilitySchema,
  })
  .readonly()
  .describe("ISSUED: a signed Capability exists; no payment attempted yet (CAPABILITY_SPEC.md state machine).");
/**
 * The `ISSUED` state: the capability issuer has produced a signed
 * `Capability` object from trusted task state. No payment has been
 * attempted yet.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `issuedPaymentStateSchema` by `_assertIssuedPaymentStateShape` below.
 * @see CAPABILITY_SPEC.md "The payment state machine" — `ISSUED`
 */
export interface IssuedPaymentState {
  readonly status: "ISSUED";
  /** The capability this payment state is for. */
  readonly capability: Capability;
}

/** Compile-time check that `issuedPaymentStateSchema` and `IssuedPaymentState` stay in sync. */
function _assertIssuedPaymentStateShape(
  x: z.infer<typeof issuedPaymentStateSchema>,
): IssuedPaymentState {
  return x;
}

/**
 * The `RESERVED` state: the Broker has accepted a payment attempt against
 * the capability. Nonce-burning and aggregate-budget-checking happen
 * atomically at this transition. Requires an `issuedFrom` state so a
 * `RESERVED` payment cannot be constructed without having first passed
 * through `ISSUED`.
 * @see CAPABILITY_SPEC.md "The payment state machine" — `RESERVED`
 * @see CAPABILITY_SPEC.md "Atomicity note"
 */
export const reservedPaymentStateSchema = z
  .object({
    status: z.literal("RESERVED"),
    capability: capabilitySchema,
    /** The ISSUED state this RESERVED state transitioned from. */
    issuedFrom: issuedPaymentStateSchema,
  })
  .readonly()
  .describe(
    "RESERVED: nonce burned and budget checked atomically, in the same transaction (CAPABILITY_SPEC.md state machine).",
  );
/**
 * The `RESERVED` state: the Broker has accepted a payment attempt against
 * the capability. Nonce-burning and aggregate-budget-checking happen
 * atomically at this transition. Requires an `issuedFrom` state so a
 * `RESERVED` payment cannot be constructed without having first passed
 * through `ISSUED`.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `reservedPaymentStateSchema` by `_assertReservedPaymentStateShape` below.
 * @see CAPABILITY_SPEC.md "The payment state machine" — `RESERVED`
 * @see CAPABILITY_SPEC.md "Atomicity note"
 */
export interface ReservedPaymentState {
  readonly status: "RESERVED";
  readonly capability: Capability;
  /** The ISSUED state this RESERVED state transitioned from. */
  readonly issuedFrom: IssuedPaymentState;
}

/** Compile-time check that `reservedPaymentStateSchema` and `ReservedPaymentState` stay in sync. */
function _assertReservedPaymentStateShape(
  x: z.infer<typeof reservedPaymentStateSchema>,
): ReservedPaymentState {
  return x;
}

/**
 * The `SUBMITTED` state: the Broker has constructed and signed the canonical
 * payment request and submitted it for settlement. Requires a `reservedFrom`
 * state so a `SUBMITTED` payment cannot be constructed without having first
 * passed through `RESERVED`.
 * @see CAPABILITY_SPEC.md "The payment state machine" — `SUBMITTED`
 */
export const submittedPaymentStateSchema = z
  .object({
    status: z.literal("SUBMITTED"),
    capability: capabilitySchema,
    /** The RESERVED state this SUBMITTED state transitioned from. */
    reservedFrom: reservedPaymentStateSchema,
  })
  .readonly()
  .describe("SUBMITTED: the signed payment request has been submitted for settlement (CAPABILITY_SPEC.md state machine).");
/**
 * The `SUBMITTED` state: the Broker has constructed and signed the canonical
 * payment request and submitted it for settlement. Requires a `reservedFrom`
 * state so a `SUBMITTED` payment cannot be constructed without having first
 * passed through `RESERVED`.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `submittedPaymentStateSchema` by `_assertSubmittedPaymentStateShape`
 * below.
 * @see CAPABILITY_SPEC.md "The payment state machine" — `SUBMITTED`
 */
export interface SubmittedPaymentState {
  readonly status: "SUBMITTED";
  readonly capability: Capability;
  /** The RESERVED state this SUBMITTED state transitioned from. */
  readonly reservedFrom: ReservedPaymentState;
}

/** Compile-time check that `submittedPaymentStateSchema` and `SubmittedPaymentState` stay in sync. */
function _assertSubmittedPaymentStateShape(
  x: z.infer<typeof submittedPaymentStateSchema>,
): SubmittedPaymentState {
  return x;
}

/**
 * The `SETTLED` state: the settlement network has confirmed the payment.
 * Requires a `submittedFrom` state so a `SETTLED` payment cannot be
 * constructed without having first passed through `SUBMITTED` — illegal
 * states (e.g. `SETTLED` with no prior `SUBMITTED`) are unrepresentable.
 * @see CAPABILITY_SPEC.md "The payment state machine" — `SETTLED`
 */
export const settledPaymentStateSchema = z
  .object({
    status: z.literal("SETTLED"),
    capability: capabilitySchema,
    /** The SUBMITTED state this SETTLED state transitioned from. */
    submittedFrom: submittedPaymentStateSchema,
  })
  .readonly()
  .describe("SETTLED: the settlement network has confirmed the payment (CAPABILITY_SPEC.md state machine).");
/**
 * The `SETTLED` state: the settlement network has confirmed the payment.
 * Requires a `submittedFrom` state so a `SETTLED` payment cannot be
 * constructed without having first passed through `SUBMITTED` — illegal
 * states (e.g. `SETTLED` with no prior `SUBMITTED`) are unrepresentable.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `settledPaymentStateSchema` by `_assertSettledPaymentStateShape` below.
 * @see CAPABILITY_SPEC.md "The payment state machine" — `SETTLED`
 */
export interface SettledPaymentState {
  readonly status: "SETTLED";
  readonly capability: Capability;
  /** The SUBMITTED state this SETTLED state transitioned from. */
  readonly submittedFrom: SubmittedPaymentState;
}

/** Compile-time check that `settledPaymentStateSchema` and `SettledPaymentState` stay in sync. */
function _assertSettledPaymentStateShape(
  x: z.infer<typeof settledPaymentStateSchema>,
): SettledPaymentState {
  return x;
}

/** Schema for the RECOVERABLE state; see the `RecoverablePaymentState` type below for the full doc. */
export const recoverablePaymentStateSchema = z
  .object({
    status: z.literal("RECOVERABLE"),
    capability: capabilitySchema,
    /** The SUBMITTED state this RECOVERABLE state transitioned from. */
    submittedFrom: submittedPaymentStateSchema,
  })
  .readonly()
  .describe(
    "RECOVERABLE: reachable only from SUBMITTED; an unknown settlement outcome requiring reconciliation by transaction ID (CAPABILITY_SPEC.md 'Triggering conditions for RECOVERABLE and FAILED').",
  );

/**
 * The `RECOVERABLE` state, reachable only from `SUBMITTED`: the outcome of
 * the submission is unknown at the time of transition — caused by a network
 * timeout, a connection failure, a Broker crash mid-flight, or any case
 * where no confirmation was received from the settlement network. This is
 * explicitly **not** the same as `FAILED`: the payment may or may not have
 * actually settled.
 *
 * Moving to `RECOVERABLE` means the correct next step is to query the
 * settlement network directly, by transaction ID, to determine the actual
 * outcome — not to blindly retry submitting a new payment (which risks
 * double-submission) and not to assume success or failure either way. Once
 * reconciliation completes, the state machine transitions to the
 * appropriate final state (`SETTLED` if the query confirms it actually
 * settled, `FAILED` if it confirms it didn't). Requires a `submittedFrom`
 * state so a `RECOVERABLE` payment cannot be constructed without having
 * first passed through `SUBMITTED` — matching the same pattern
 * `FailedPaymentState` uses.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `recoverablePaymentStateSchema` by `_assertRecoverablePaymentStateShape`
 * below.
 * @see CAPABILITY_SPEC.md "Triggering conditions for `RECOVERABLE` and `FAILED`"
 */
export interface RecoverablePaymentState {
  readonly status: "RECOVERABLE";
  readonly capability: Capability;
  /** The SUBMITTED state this RECOVERABLE state transitioned from. */
  readonly submittedFrom: SubmittedPaymentState;
}

/** Compile-time check that `recoverablePaymentStateSchema` and `RecoverablePaymentState` stay in sync. */
function _assertRecoverablePaymentStateShape(
  x: z.infer<typeof recoverablePaymentStateSchema>,
): RecoverablePaymentState {
  return x;
}

/**
 * The `FAILED` state, reachable only from `SUBMITTED`: the submitted payment
 * did not settle.
 *
 * TODO: the specific triggering conditions for this transition are not
 * specified by the source docs — see docs/OPEN_QUESTIONS.md "RECOVERABLE /
 * FAILED transition triggers are not specified in the source" (relevant to
 * task 1.5). This schema only encodes the transition's reachability
 * (SUBMITTED -> FAILED), not its triggering condition.
 * @see CAPABILITY_SPEC.md "The payment state machine" — `FAILED`
 */
export const failedPaymentStateSchema = z
  .object({
    status: z.literal("FAILED"),
    capability: capabilitySchema,
    /** The SUBMITTED state this FAILED state transitioned from. */
    submittedFrom: submittedPaymentStateSchema,
  })
  .readonly()
  .describe("FAILED: reachable only from SUBMITTED; triggering conditions still open (see docs/OPEN_QUESTIONS.md).");
/**
 * The `FAILED` state, reachable only from `SUBMITTED`: the submitted payment
 * did not settle.
 *
 * TODO: the specific triggering conditions for this transition are not
 * specified by the source docs — see docs/OPEN_QUESTIONS.md "RECOVERABLE /
 * FAILED transition triggers are not specified in the source" (relevant to
 * task 1.5). This type only encodes the transition's reachability
 * (SUBMITTED -> FAILED), not its triggering condition.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `failedPaymentStateSchema` by `_assertFailedPaymentStateShape` below.
 * @see CAPABILITY_SPEC.md "The payment state machine" — `FAILED`
 */
export interface FailedPaymentState {
  readonly status: "FAILED";
  readonly capability: Capability;
  /** The SUBMITTED state this FAILED state transitioned from. */
  readonly submittedFrom: SubmittedPaymentState;
}

/** Compile-time check that `failedPaymentStateSchema` and `FailedPaymentState` stay in sync. */
function _assertFailedPaymentStateShape(
  x: z.infer<typeof failedPaymentStateSchema>,
): FailedPaymentState {
  return x;
}

/** Schema for the full payment state machine; see the `PaymentState` type below for the full doc. */
export const paymentStateSchema = z.discriminatedUnion("status", [
  issuedPaymentStateSchema,
  reservedPaymentStateSchema,
  submittedPaymentStateSchema,
  settledPaymentStateSchema,
  recoverablePaymentStateSchema,
  failedPaymentStateSchema,
]);

/**
 * The full payment state machine, as a discriminated union on `status`.
 *
 * Each later state nests the state it must have transitioned from
 * (`issuedFrom` / `reservedFrom` / `submittedFrom`), so a state like
 * `SETTLED` is not constructible without having passed through `SUBMITTED`
 * (and transitively `RESERVED` and `ISSUED`) — matching CAPABILITY_SPEC.md's
 * diagram exactly:
 *
 * ```
 * ISSUED -> RESERVED -> SUBMITTED -> SETTLED
 *               |            |
 *               v            v
 *         RECOVERABLE      FAILED
 * ```
 *
 * Defined as a union of the six hand-written per-state interfaces above, so
 * it inherits their field-level JSDoc directly and needs no assert function
 * of its own — it is already fully derived from types each individually
 * checked against their schema.
 * @see CAPABILITY_SPEC.md "The payment state machine"
 */
export type PaymentState =
  | IssuedPaymentState
  | ReservedPaymentState
  | SubmittedPaymentState
  | SettledPaymentState
  | RecoverablePaymentState
  | FailedPaymentState;

// ---------------------------------------------------------------------------
// Broker <-> Sandbox protocol
// ---------------------------------------------------------------------------

/** Schema for the sandbox-facing capability lookup key; see the `CapabilityId` type below for the full doc. */
export const capabilityIdSchema = z
  .string()
  .brand<"CapabilityId">()
  .describe(
    "Opaque, non-security-bearing lookup key for pay(capability_id); distinct from Capability.nonce.",
  );

/**
 * Opaque, non-security-bearing lookup key the sandbox/agent uses to
 * reference a capability when calling `pay(capability_id)`.
 *
 * Deliberately a distinct, branded type from `UniqueId`/`nonce`: THREAT_MODEL.md
 * frames the sandbox's only handle on a payment as an "opaque capability
 * reference," and CAPABILITY_SPEC.md's `nonce` is a replay-defense token
 * that is internal to the Broker. Collapsing the two into one value would
 * mean the untrusted sandbox domain handles the same token the Broker uses
 * to prevent replay — an opaque reference and a replay-defense token should
 * never be the same value. `capability_id` is purely a lookup handle: even
 * if an attacker learns it, that alone must not let them forge, replay, or
 * redirect a payment, since none of the SECURITY_INVARIANT.md clauses are
 * checked against it.
 *
 * Hand-written (using Zod's own exported `$brand` symbol, so the nominal
 * brand matches `capabilityIdSchema`'s `.brand<"CapabilityId">()` exactly)
 * to preserve hover JSDoc; kept in sync by `_assertCapabilityIdShape` below.
 * @see ARCHITECTURE.md "Agent Sandbox ... can only call `pay(capability_id)`"
 * @see THREAT_MODEL.md "opaque capability reference"
 * @see README.md "Signing Model" — "Its only available action is `pay(capability_id)`"
 */
export type CapabilityId = string & { readonly [$brand]: { readonly CapabilityId: true } };

/** Compile-time check that `capabilityIdSchema` and `CapabilityId` stay in sync. */
function _assertCapabilityIdShape(x: z.infer<typeof capabilityIdSchema>): CapabilityId {
  return x;
}

/** Schema for the sandbox's payment tool call request; see the `PayRequest` type below for the full doc. */
export const payRequestSchema = z
  .object({
    capabilityId: capabilityIdSchema,
  })
  .readonly()
  .describe("The sandbox's single payment tool call: capability_id only, no destination/amount.");

/**
 * Request shape for the sandbox's single payment tool call. Exactly one
 * field, matching the design principle that the tool "has exactly one
 * parameter" and exposes no `destination`/`amount` field for untrusted text
 * to populate.
 *
 * This shape is provisional: CAPABILITY_SPEC.md task 0.4 (Broker<->Sandbox
 * wire protocol, including error codes) has not been completed yet per
 * docs/TASKS.md — only the single-parameter constraint itself, and the use
 * of `capabilityId` rather than `nonce`, are settled decisions.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `payRequestSchema` by `_assertPayRequestShape` below.
 * @see ARCHITECTURE.md "Its payment tool has exactly one parameter"
 * @see README.md "Design Principle"
 */
export interface PayRequest {
  /** The opaque lookup handle identifying which capability to pay against. */
  readonly capabilityId: CapabilityId;
}

/** Compile-time check that `payRequestSchema` and `PayRequest` stay in sync. */
function _assertPayRequestShape(x: z.infer<typeof payRequestSchema>): PayRequest {
  return x;
}

/** Schema for the sandbox's payment tool call response; see the `PayResponse` type below for the full doc. */
export const payResponseSchema = z
  .object({
    state: paymentStateSchema,
  })
  .readonly()
  .describe("The resulting payment state after the Broker processed a PayRequest.");

/**
 * Response shape for the sandbox's single payment tool call: the resulting
 * payment state after the Broker processed the request.
 *
 * This shape is provisional pending task 0.4 (Broker<->Sandbox wire
 * protocol, including error codes and response envelope), which has not been
 * completed yet per docs/TASKS.md.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `payResponseSchema` by `_assertPayResponseShape` below.
 * @see ARCHITECTURE.md "Broker↔Sandbox protocol" (`packages/protocol`)
 */
export interface PayResponse {
  /** The resulting payment state after the Broker processed the request. */
  readonly state: PaymentState;
}

/** Compile-time check that `payResponseSchema` and `PayResponse` stay in sync. */
function _assertPayResponseShape(x: z.infer<typeof payResponseSchema>): PayResponse {
  return x;
}

// ---------------------------------------------------------------------------
// Authorization (Broker.authorize(payment))
// ---------------------------------------------------------------------------

/** Schema for the Broker.authorize(payment) payment object; see the `PaymentAuthorizationRequest` type below for the full doc. */
export const paymentAuthorizationRequestSchema = z
  .object({
    amount: decimalSchema.describe("Checked against capability.exactAmount (SECURITY_INVARIANT.md)."),
    destination: addressSchema.describe("Checked against capability.recipient (SECURITY_INVARIANT.md)."),
    resource: uuidSchema.describe("Checked against capability.resourceId (SECURITY_INVARIANT.md)."),
    taskHash: hashSchema.describe("Checked against capability.taskHash (SECURITY_INVARIANT.md)."),
    session: publicKeySchema.describe("Checked against capability.session (SECURITY_INVARIANT.md)."),
    paymentRequestHash: hashSchema.describe(
      "Checked against capability.paymentRequestHash (SECURITY_INVARIANT.md).",
    ),
  })
  .readonly()
  .describe("The payment object Broker.authorize(payment) checks against a Capability (SECURITY_INVARIANT.md).");

/**
 * The `payment` object that SECURITY_INVARIANT.md's clauses compare against
 * a `Capability`'s fields. Distinct from `Capability` itself: this is the
 * payment actually being authorized, which must match the capability's
 * fields exactly for `Broker.authorize` to succeed.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `paymentAuthorizationRequestSchema` by
 * `_assertPaymentAuthorizationRequestShape` below.
 * @see SECURITY_INVARIANT.md "The invariant"
 */
export interface PaymentAuthorizationRequest {
  /** @see SECURITY_INVARIANT.md clause: `payment.amount == capability.exact_amount` */
  readonly amount: Decimal;
  /** @see SECURITY_INVARIANT.md clause: `payment.destination == capability.recipient` */
  readonly destination: Address;
  /** @see SECURITY_INVARIANT.md clause: `payment.resource == capability.resource_id` */
  readonly resource: Uuid;
  /** @see SECURITY_INVARIANT.md clause: `payment.task_hash == capability.task_hash` */
  readonly taskHash: Hash;
  /** @see SECURITY_INVARIANT.md clause: `payment.session == capability.session` */
  readonly session: PublicKey;
  /** @see SECURITY_INVARIANT.md clause: `payment.payment_request_hash == capability.payment_request_hash` */
  readonly paymentRequestHash: Hash;
}

/** Compile-time check that `paymentAuthorizationRequestSchema` and `PaymentAuthorizationRequest` stay in sync. */
function _assertPaymentAuthorizationRequestShape(
  x: z.infer<typeof paymentAuthorizationRequestSchema>,
): PaymentAuthorizationRequest {
  return x;
}

/** Schema for the full Broker.authorize(payment) input; see the `AuthorizePaymentInput` type below for the full doc. */
export const authorizePaymentInputSchema = z
  .object({
    payment: paymentAuthorizationRequestSchema,
    capability: capabilitySchema,
    task: taskSchema,
  })
  .readonly()
  .describe("Full input to Broker.authorize(payment): payment, capability, and task (SECURITY_INVARIANT.md).");

/**
 * The full set of trusted state `Broker.authorize(payment)` evaluates a
 * `PaymentAuthorizationRequest` against: the capability the payment claims
 * to be spending, and the task budget it would be charged against.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `authorizePaymentInputSchema` by `_assertAuthorizePaymentInputShape` below.
 * @see SECURITY_INVARIANT.md "The invariant"
 */
export interface AuthorizePaymentInput {
  /** The payment being authorized. */
  readonly payment: PaymentAuthorizationRequest;
  /** The capability the payment claims to be spending. */
  readonly capability: Capability;
  /** The task budget the payment would be charged against. */
  readonly task: Task;
}

/** Compile-time check that `authorizePaymentInputSchema` and `AuthorizePaymentInput` stay in sync. */
function _assertAuthorizePaymentInputShape(
  x: z.infer<typeof authorizePaymentInputSchema>,
): AuthorizePaymentInput {
  return x;
}

/** Schema for the invariant-clause failure reason; see the `AuthorizationFailureReason` type below for the full doc. */
export const authorizationFailureReasonSchema = z.enum([
  "AMOUNT_MISMATCH",
  "SUBSTITUTION",
  "RESOURCE_MISMATCH",
  "TASK_HASH_MISMATCH",
  "SESSION_MISMATCH",
  "REQUEST_FORGERY",
  "REPLAY",
  "STALE_NONCE",
  "BUDGET_EXCEEDED",
]);

/**
 * Which specific invariant clause failed. Named after
 * `SECURITY_INVARIANT.md`'s resolved 9 clause names (task 0.3.1a) — these
 * were previously named directly after each clause's own terms (e.g.
 * `DESTINATION_MISMATCH`, `PAYMENT_REQUEST_HASH_MISMATCH`, `NONCE_CONSUMED`,
 * `CAPABILITY_EXPIRED`) to sidestep the then-unresolved ambiguity between
 * the spec's 7 named violation types and the invariant's 9 formal clauses
 * (task 0.3.1, see docs/OPEN_QUESTIONS.md "Resolved: violation-type
 * labeling in SECURITY_INVARIANT.md (task 0.3.1)"). Task 0.3.1a has since
 * resolved that mapping, and this type now uses its final names directly.
 *
 * @see SECURITY_INVARIANT.md "1. Amount mismatch" — `payment.amount == capability.exact_amount`
 * @see SECURITY_INVARIANT.md "2. Substitution" — `payment.destination == capability.recipient`
 * @see SECURITY_INVARIANT.md "3. Resource mismatch" — `payment.resource == capability.resource_id`
 * @see SECURITY_INVARIANT.md "4. Task_hash mismatch" — `payment.task_hash == capability.task_hash`
 * @see SECURITY_INVARIANT.md "5. Session mismatch" — `payment.session == capability.session`
 * @see SECURITY_INVARIANT.md "6. Request forgery" — `payment.payment_request_hash == capability.payment_request_hash`
 * @see SECURITY_INVARIANT.md "7. Replay" — `capability.nonce is unconsumed`
 * @see SECURITY_INVARIANT.md "8. Stale nonce" — `now < capability.expiry`
 * @see SECURITY_INVARIANT.md "9. Over-budget" — `(task.spent_so_far + payment.amount) <= task.max_total_spend`
 *
 * Hand-written to preserve hover JSDoc; kept in sync with
 * `authorizationFailureReasonSchema` by
 * `_assertAuthorizationFailureReasonShape` below.
 * @see SECURITY_INVARIANT.md "Each clause, and what violating it means"
 */
export type AuthorizationFailureReason =
  /** @see SECURITY_INVARIANT.md "1. Amount mismatch" — `payment.amount == capability.exact_amount` */
  | "AMOUNT_MISMATCH"
  /** @see SECURITY_INVARIANT.md "2. Substitution" — `payment.destination == capability.recipient` */
  | "SUBSTITUTION"
  /** @see SECURITY_INVARIANT.md "3. Resource mismatch" — `payment.resource == capability.resource_id` (distinct from escalation — see THREAT_MODEL.md) */
  | "RESOURCE_MISMATCH"
  /** @see SECURITY_INVARIANT.md "4. Task_hash mismatch" — `payment.task_hash == capability.task_hash` */
  | "TASK_HASH_MISMATCH"
  /** @see SECURITY_INVARIANT.md "5. Session mismatch" — `payment.session == capability.session` */
  | "SESSION_MISMATCH"
  /** @see SECURITY_INVARIANT.md "6. Request forgery" — `payment.payment_request_hash == capability.payment_request_hash` (distinct from substitution) */
  | "REQUEST_FORGERY"
  /** @see SECURITY_INVARIANT.md "7. Replay" — `capability.nonce is unconsumed` (distinct from stale nonce by attack timing) */
  | "REPLAY"
  /** @see SECURITY_INVARIANT.md "8. Stale nonce" — `now < capability.expiry` (distinct from replay by attack timing) */
  | "STALE_NONCE"
  /** @see SECURITY_INVARIANT.md "9. Over-budget" — `(task.spent_so_far + payment.amount) <= task.max_total_spend` */
  | "BUDGET_EXCEEDED";

/** Compile-time check that `authorizationFailureReasonSchema` and `AuthorizationFailureReason` stay in sync. */
function _assertAuthorizationFailureReasonShape(
  x: z.infer<typeof authorizationFailureReasonSchema>,
): AuthorizationFailureReason {
  return x;
}

const authorizationSucceededSchema = z
  .object({
    authorized: z.literal(true),
  })
  .readonly();

const authorizationFailedSchema = z
  .object({
    authorized: z.literal(false),
    /** Which single invariant clause failed. */
    reason: authorizationFailureReasonSchema,
  })
  .readonly();

/** Schema for the Broker.authorize(payment) result; see the `AuthorizationResult` type below for the full doc. */
export const authorizationResultSchema = z.discriminatedUnion("authorized", [
  authorizationSucceededSchema,
  authorizationFailedSchema,
]);

/**
 * The result of `Broker.authorize(payment)`: either every clause of the
 * invariant held, or one specific clause failed. There is no partial
 * authorization — SECURITY_INVARIANT.md is explicit that "If any conjunct is
 * false, the Broker must not authorize the payment."
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `authorizationResultSchema` by `_assertAuthorizationResultShape` below.
 * @see SECURITY_INVARIANT.md "The invariant"
 */
export type AuthorizationResult =
  | Readonly<{ authorized: true }>
  | Readonly<{
      authorized: false;
      /** Which single invariant clause failed. */
      reason: AuthorizationFailureReason;
    }>;

/** Compile-time check that `authorizationResultSchema` and `AuthorizationResult` stay in sync. */
function _assertAuthorizationResultShape(
  x: z.infer<typeof authorizationResultSchema>,
): AuthorizationResult {
  return x;
}
