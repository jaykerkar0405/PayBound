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
  .regex(/^[0-9a-f]{64}$/, "must be a 64-character lowercase hex SHA-256 digest")
  .describe("An opaque content hash (CAPABILITY_SPEC.md field type: hash) — a lowercase hex SHA-256 digest, per hash.ts's hashCanonical, the sole producer of this field.");
export type Hash = z.infer<typeof hashSchema>;

/**
 * A UUID identifying an entry in the trusted resource registry.
 * @see CAPABILITY_SPEC.md Capability field: `resource_id: uuid`
 */
export const uuidSchema = z
  .string()
  .uuid()
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
  .regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal number string (e.g. \"0.01\", \"10\")")
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
  .uuid()
  .describe(
    "A single-use identifier burned atomically on use (CAPABILITY_SPEC.md field type: unique_id) — a UUID, per issuer.ts's sole producer (randomUUID()).",
  );
export type UniqueId = z.infer<typeof uniqueIdSchema>;

/**
 * An ISO 8601 timestamp.
 * @see CAPABILITY_SPEC.md Capability field: `expiry: timestamp`
 * @see SECURITY_INVARIANT.md clause: `now < capability.expiry`
 */
export const timestampSchema = z
  .string()
  .datetime()
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
const capabilityObjectSchema = z.object({
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
  .describe("A trusted, unforgeable, single-use grant of exactly one payment (CAPABILITY_SPEC.md: the Capability object).");

/**
 * A trusted, unforgeable, single-use grant of exactly one payment, issued by
 * the Broker before the agent touches any untrusted input.
 *
 * All 9 fields below are taken directly from CAPABILITY_SPEC.md's
 * `Capability` object definition — no fields have been added or removed.
 *
 * Built from `capabilityObjectSchema` (kept unexported, pre-`.readonly()`)
 * so `publicCapabilitySchema` below can derive from the same shape via
 * `.omit()` rather than a hand-duplicated object, and can never drift from
 * this definition.
 * @see CAPABILITY_SPEC.md "The `Capability` object"
 */
export const capabilitySchema = capabilityObjectSchema.readonly();

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
 * `Capability` with `nonce` omitted. `nonce` is the Broker's internal
 * replay-defense token and must never reach the untrusted sandbox domain
 * (THREAT_MODEL.md; docs/OPEN_QUESTIONS.md "Resolved: capability_id vs.
 * nonce" — "The nonce stays internal to the Broker's replay-defense
 * mechanism; the sandbox never sees or handles it."). Derived via Zod's
 * `.omit()` from `capabilityObjectSchema` — the same object schema
 * `capabilitySchema` itself is built from — so this can never drift from
 * the real `Capability` definition by hand-duplicating its shape.
 * @see CAPABILITY_SPEC.md "The `Capability` object"
 * @see docs/OPEN_QUESTIONS.md "Resolved: nonce omitted from PayResponse via a dedicated public payment-state type"
 */
export const publicCapabilitySchema = capabilityObjectSchema.omit({ nonce: true }).readonly();

/**
 * `Capability` with `nonce` omitted. `nonce` is the Broker's internal
 * replay-defense token, burned atomically at the `RESERVED` transition
 * (CAPABILITY_SPEC.md "Atomicity note") — it must never reach the
 * untrusted sandbox/agent domain (THREAT_MODEL.md's trust boundary;
 * docs/OPEN_QUESTIONS.md "Resolved: capability_id vs. nonce" — "the
 * sandbox never sees or handles it"). This is the shape actually safe to
 * put on the sandbox-facing wire (see `PublicPaymentState`/`PayResponse`
 * below).
 *
 * Hand-written (rather than `Omit<Capability, "nonce">`) to preserve
 * field-level hover JSDoc, following this file's established pattern;
 * kept in sync with `publicCapabilitySchema` by
 * `_assertPublicCapabilityShape` below.
 * @see CAPABILITY_SPEC.md "The `Capability` object"
 * @see THREAT_MODEL.md "Adversarial" (trust boundary)
 * @see docs/OPEN_QUESTIONS.md "Resolved: capability_id vs. nonce"
 */
export interface PublicCapability {
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

/** Compile-time check that `publicCapabilitySchema` and `PublicCapability` stay in sync. */
function _assertPublicCapabilityShape(
  x: z.infer<typeof publicCapabilitySchema>,
): PublicCapability {
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
 * Triggering condition (resolved, task 0.3.1b — see
 * docs/OPEN_QUESTIONS.md "Resolved: RECOVERABLE / FAILED transition
 * triggers"): the settlement network returns a definitive negative result
 * for the submitted transaction — a known, unambiguous outcome, requiring
 * no reconciliation.
 * @see CAPABILITY_SPEC.md "Triggering conditions for `RECOVERABLE` and `FAILED`"
 */
export const failedPaymentStateSchema = z
  .object({
    status: z.literal("FAILED"),
    capability: capabilitySchema,
    /** The SUBMITTED state this FAILED state transitioned from. */
    submittedFrom: submittedPaymentStateSchema,
  })
  .readonly()
  .describe("FAILED: reachable only from SUBMITTED, on a definitive negative settlement result (see CAPABILITY_SPEC.md).");
/**
 * The `FAILED` state, reachable only from `SUBMITTED`: the submitted payment
 * did not settle.
 *
 * Triggering condition (resolved, task 0.3.1b — see
 * docs/OPEN_QUESTIONS.md "Resolved: RECOVERABLE / FAILED transition
 * triggers"): the settlement network returns a definitive negative result
 * for the submitted transaction — a known, unambiguous outcome, requiring
 * no reconciliation.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `failedPaymentStateSchema` by `_assertFailedPaymentStateShape` below.
 * @see CAPABILITY_SPEC.md "Triggering conditions for `RECOVERABLE` and `FAILED`"
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
// Public (nonce-omitted) payment state machine
//
// Mirrors the six states above field-for-field, except every nested
// Capability is `PublicCapability` (nonce omitted) instead of `Capability`.
// This is the sandbox-facing wire shape: PayResponse (below) uses
// PublicPaymentState, not PaymentState, so it is structurally impossible
// to serialize a nonce into a pay() response — enforced by the type
// system, not a runtime strip step. See docs/OPEN_QUESTIONS.md "Resolved:
// nonce omitted from PayResponse via a dedicated public payment-state
// type".
// ---------------------------------------------------------------------------

/** Schema for the sandbox-facing ISSUED state; see `PublicIssuedPaymentState` below for the full doc. */
export const publicIssuedPaymentStateSchema = z
  .object({
    status: z.literal("ISSUED"),
    capability: publicCapabilitySchema,
  })
  .readonly()
  .describe("Sandbox-facing ISSUED state: same as IssuedPaymentState, nonce omitted (CAPABILITY_SPEC.md state machine).");

/**
 * Sandbox-facing mirror of `IssuedPaymentState`. Its nested capability is
 * `PublicCapability`, not `Capability`: `nonce` is the Broker's internal
 * replay-defense token and must never reach the untrusted sandbox/agent
 * domain (THREAT_MODEL.md trust boundary; docs/OPEN_QUESTIONS.md
 * "Resolved: capability_id vs. nonce" — "the sandbox never sees or
 * handles it"), so this type has no field for one to occupy.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `publicIssuedPaymentStateSchema` by
 * `_assertPublicIssuedPaymentStateShape` below.
 * @see CAPABILITY_SPEC.md "The payment state machine" — `ISSUED`
 * @see docs/OPEN_QUESTIONS.md "Resolved: nonce omitted from PayResponse via a dedicated public payment-state type"
 */
export interface PublicIssuedPaymentState {
  readonly status: "ISSUED";
  /** The capability this payment state is for, nonce omitted. */
  readonly capability: PublicCapability;
}

/** Compile-time check that `publicIssuedPaymentStateSchema` and `PublicIssuedPaymentState` stay in sync. */
function _assertPublicIssuedPaymentStateShape(
  x: z.infer<typeof publicIssuedPaymentStateSchema>,
): PublicIssuedPaymentState {
  return x;
}

/** Schema for the sandbox-facing RESERVED state; see `PublicReservedPaymentState` below for the full doc. */
export const publicReservedPaymentStateSchema = z
  .object({
    status: z.literal("RESERVED"),
    capability: publicCapabilitySchema,
    issuedFrom: publicIssuedPaymentStateSchema,
  })
  .readonly()
  .describe("Sandbox-facing RESERVED state: same as ReservedPaymentState, nonce omitted (CAPABILITY_SPEC.md state machine).");

/**
 * Sandbox-facing mirror of `ReservedPaymentState`. Its nested capabilities
 * — `capability`, and transitively `issuedFrom.capability` — are
 * `PublicCapability`, not `Capability`: `nonce` is the Broker's internal
 * replay-defense token and must never reach the untrusted sandbox/agent
 * domain (THREAT_MODEL.md trust boundary; docs/OPEN_QUESTIONS.md
 * "Resolved: capability_id vs. nonce" — "the sandbox never sees or
 * handles it"), so this type has no field for one to occupy at any
 * nesting level.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `publicReservedPaymentStateSchema` by
 * `_assertPublicReservedPaymentStateShape` below.
 * @see CAPABILITY_SPEC.md "The payment state machine" — `RESERVED`
 * @see docs/OPEN_QUESTIONS.md "Resolved: nonce omitted from PayResponse via a dedicated public payment-state type"
 */
export interface PublicReservedPaymentState {
  readonly status: "RESERVED";
  readonly capability: PublicCapability;
  /** The ISSUED state this RESERVED state transitioned from, nonce omitted. */
  readonly issuedFrom: PublicIssuedPaymentState;
}

/** Compile-time check that `publicReservedPaymentStateSchema` and `PublicReservedPaymentState` stay in sync. */
function _assertPublicReservedPaymentStateShape(
  x: z.infer<typeof publicReservedPaymentStateSchema>,
): PublicReservedPaymentState {
  return x;
}

/** Schema for the sandbox-facing SUBMITTED state; see `PublicSubmittedPaymentState` below for the full doc. */
export const publicSubmittedPaymentStateSchema = z
  .object({
    status: z.literal("SUBMITTED"),
    capability: publicCapabilitySchema,
    reservedFrom: publicReservedPaymentStateSchema,
  })
  .readonly()
  .describe("Sandbox-facing SUBMITTED state: same as SubmittedPaymentState, nonce omitted (CAPABILITY_SPEC.md state machine).");

/**
 * Sandbox-facing mirror of `SubmittedPaymentState` — the shape
 * `PayResponse` actually carries on a successful `pay()` call
 * (docs/PROTOCOL.md §3). Its nested capabilities, at every level
 * (`capability`, `reservedFrom.capability`,
 * `reservedFrom.issuedFrom.capability`), are `PublicCapability`, not
 * `Capability`: `nonce` is the Broker's internal replay-defense token and
 * must never reach the untrusted sandbox/agent domain (THREAT_MODEL.md
 * trust boundary; docs/OPEN_QUESTIONS.md "Resolved: capability_id vs.
 * nonce" — "the sandbox never sees or handles it"). Using this type for
 * `PayResponse.state` is what makes that a structural, compile-time
 * guarantee rather than something the `pay()` route has to remember to
 * strip at the HTTP boundary.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `publicSubmittedPaymentStateSchema` by
 * `_assertPublicSubmittedPaymentStateShape` below.
 * @see CAPABILITY_SPEC.md "The payment state machine" — `SUBMITTED`
 * @see docs/PROTOCOL.md §3 "Response shape — success"
 * @see docs/OPEN_QUESTIONS.md "Resolved: nonce omitted from PayResponse via a dedicated public payment-state type"
 */
export interface PublicSubmittedPaymentState {
  readonly status: "SUBMITTED";
  readonly capability: PublicCapability;
  /** The RESERVED state this SUBMITTED state transitioned from, nonce omitted. */
  readonly reservedFrom: PublicReservedPaymentState;
}

/** Compile-time check that `publicSubmittedPaymentStateSchema` and `PublicSubmittedPaymentState` stay in sync. */
function _assertPublicSubmittedPaymentStateShape(
  x: z.infer<typeof publicSubmittedPaymentStateSchema>,
): PublicSubmittedPaymentState {
  return x;
}

/** Schema for the sandbox-facing SETTLED state; see `PublicSettledPaymentState` below for the full doc. */
export const publicSettledPaymentStateSchema = z
  .object({
    status: z.literal("SETTLED"),
    capability: publicCapabilitySchema,
    submittedFrom: publicSubmittedPaymentStateSchema,
  })
  .readonly()
  .describe("Sandbox-facing SETTLED state: same as SettledPaymentState, nonce omitted (CAPABILITY_SPEC.md state machine).");

/**
 * Sandbox-facing mirror of `SettledPaymentState`. Its nested capabilities,
 * at every level, are `PublicCapability`, not `Capability`: `nonce` is the
 * Broker's internal replay-defense token and must never reach the
 * untrusted sandbox/agent domain (THREAT_MODEL.md trust boundary;
 * docs/OPEN_QUESTIONS.md "Resolved: capability_id vs. nonce" — "the
 * sandbox never sees or handles it"), so this type has no field for one to
 * occupy at any nesting level.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `publicSettledPaymentStateSchema` by
 * `_assertPublicSettledPaymentStateShape` below.
 * @see CAPABILITY_SPEC.md "The payment state machine" — `SETTLED`
 * @see docs/OPEN_QUESTIONS.md "Resolved: nonce omitted from PayResponse via a dedicated public payment-state type"
 */
export interface PublicSettledPaymentState {
  readonly status: "SETTLED";
  readonly capability: PublicCapability;
  /** The SUBMITTED state this SETTLED state transitioned from, nonce omitted. */
  readonly submittedFrom: PublicSubmittedPaymentState;
}

/** Compile-time check that `publicSettledPaymentStateSchema` and `PublicSettledPaymentState` stay in sync. */
function _assertPublicSettledPaymentStateShape(
  x: z.infer<typeof publicSettledPaymentStateSchema>,
): PublicSettledPaymentState {
  return x;
}

/** Schema for the sandbox-facing RECOVERABLE state; see `PublicRecoverablePaymentState` below for the full doc. */
export const publicRecoverablePaymentStateSchema = z
  .object({
    status: z.literal("RECOVERABLE"),
    capability: publicCapabilitySchema,
    submittedFrom: publicSubmittedPaymentStateSchema,
  })
  .readonly()
  .describe("Sandbox-facing RECOVERABLE state: same as RecoverablePaymentState, nonce omitted (CAPABILITY_SPEC.md 'Triggering conditions for RECOVERABLE and FAILED').");

/**
 * Sandbox-facing mirror of `RecoverablePaymentState`. Its nested
 * capabilities, at every level, are `PublicCapability`, not `Capability`:
 * `nonce` is the Broker's internal replay-defense token and must never
 * reach the untrusted sandbox/agent domain (THREAT_MODEL.md trust
 * boundary; docs/OPEN_QUESTIONS.md "Resolved: capability_id vs. nonce" —
 * "the sandbox never sees or handles it"), so this type has no field for
 * one to occupy at any nesting level.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `publicRecoverablePaymentStateSchema` by
 * `_assertPublicRecoverablePaymentStateShape` below.
 * @see CAPABILITY_SPEC.md "Triggering conditions for `RECOVERABLE` and `FAILED`"
 * @see docs/OPEN_QUESTIONS.md "Resolved: nonce omitted from PayResponse via a dedicated public payment-state type"
 */
export interface PublicRecoverablePaymentState {
  readonly status: "RECOVERABLE";
  readonly capability: PublicCapability;
  /** The SUBMITTED state this RECOVERABLE state transitioned from, nonce omitted. */
  readonly submittedFrom: PublicSubmittedPaymentState;
}

/** Compile-time check that `publicRecoverablePaymentStateSchema` and `PublicRecoverablePaymentState` stay in sync. */
function _assertPublicRecoverablePaymentStateShape(
  x: z.infer<typeof publicRecoverablePaymentStateSchema>,
): PublicRecoverablePaymentState {
  return x;
}

/** Schema for the sandbox-facing FAILED state; see `PublicFailedPaymentState` below for the full doc. */
export const publicFailedPaymentStateSchema = z
  .object({
    status: z.literal("FAILED"),
    capability: publicCapabilitySchema,
    submittedFrom: publicSubmittedPaymentStateSchema,
  })
  .readonly()
  .describe("Sandbox-facing FAILED state: same as FailedPaymentState, nonce omitted (see docs/OPEN_QUESTIONS.md).");

/**
 * Sandbox-facing mirror of `FailedPaymentState`. Its nested capabilities,
 * at every level, are `PublicCapability`, not `Capability`: `nonce` is the
 * Broker's internal replay-defense token and must never reach the
 * untrusted sandbox/agent domain (THREAT_MODEL.md trust boundary;
 * docs/OPEN_QUESTIONS.md "Resolved: capability_id vs. nonce" — "the
 * sandbox never sees or handles it"), so this type has no field for one to
 * occupy at any nesting level.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `publicFailedPaymentStateSchema` by
 * `_assertPublicFailedPaymentStateShape` below.
 * @see CAPABILITY_SPEC.md "The payment state machine" — `FAILED`
 * @see docs/OPEN_QUESTIONS.md "Resolved: nonce omitted from PayResponse via a dedicated public payment-state type"
 */
export interface PublicFailedPaymentState {
  readonly status: "FAILED";
  readonly capability: PublicCapability;
  /** The SUBMITTED state this FAILED state transitioned from, nonce omitted. */
  readonly submittedFrom: PublicSubmittedPaymentState;
}

/** Compile-time check that `publicFailedPaymentStateSchema` and `PublicFailedPaymentState` stay in sync. */
function _assertPublicFailedPaymentStateShape(
  x: z.infer<typeof publicFailedPaymentStateSchema>,
): PublicFailedPaymentState {
  return x;
}

/** Schema for the full sandbox-facing payment state machine; see `PublicPaymentState` below for the full doc. */
export const publicPaymentStateSchema = z.discriminatedUnion("status", [
  publicIssuedPaymentStateSchema,
  publicReservedPaymentStateSchema,
  publicSubmittedPaymentStateSchema,
  publicSettledPaymentStateSchema,
  publicRecoverablePaymentStateSchema,
  publicFailedPaymentStateSchema,
]);

/**
 * The sandbox-facing mirror of `PaymentState`: the same discriminated
 * union on `status`, with `nonce` omitted from every nested capability.
 * `nonce` is the Broker's internal replay-defense token and must never
 * reach the untrusted sandbox/agent domain (THREAT_MODEL.md trust
 * boundary; docs/OPEN_QUESTIONS.md "Resolved: capability_id vs. nonce" —
 * "the sandbox never sees or handles it"). This is what `PayResponse`
 * actually carries — passing a real `PaymentState` (with `nonce`) through
 * one of `publicXPaymentStateSchema`'s `.parse()` calls strips the nonce
 * automatically (Zod's default unknown-key handling drops keys not
 * present in the target shape), which is the type-level enforcement
 * mechanism: there is no field on this type for a nonce to occupy.
 *
 * Defined as a union of the six hand-written per-state interfaces above,
 * so it inherits their field-level JSDoc directly and needs no assert
 * function of its own.
 * @see CAPABILITY_SPEC.md "The payment state machine"
 * @see THREAT_MODEL.md "Adversarial" (trust boundary)
 * @see docs/OPEN_QUESTIONS.md "Resolved: capability_id vs. nonce"
 * @see docs/OPEN_QUESTIONS.md "Resolved: nonce omitted from PayResponse via a dedicated public payment-state type"
 */
export type PublicPaymentState =
  | PublicIssuedPaymentState
  | PublicReservedPaymentState
  | PublicSubmittedPaymentState
  | PublicSettledPaymentState
  | PublicRecoverablePaymentState
  | PublicFailedPaymentState;

// ---------------------------------------------------------------------------
// Broker <-> Sandbox protocol
// ---------------------------------------------------------------------------

/** Schema for the sandbox-facing capability lookup key; see the `CapabilityId` type below for the full doc. */
export const capabilityIdSchema = z
  .string()
  .uuid()
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

// ---------------------------------------------------------------------------
// POST /issue — capability issuance request
// ---------------------------------------------------------------------------

/**
 * Schema for the POST /issue request body: the fields needed to call
 * `issueCapability()` in apps/broker/src/issuer.ts. Built from the
 * same field-level primitives used elsewhere in this file (uuidSchema,
 * decimalSchema, publicKeySchema). `taskDefinition` and `paymentRequest`
 * are kept as `z.unknown()` — their shapes are hashed, not validated,
 * per issuer.ts's `IssueCapabilityInput` interface.
 * @see apps/broker/src/issuer.ts `IssueCapabilityInput`
 */
export const issueRequestSchema = z
  .object({
    /**
     * The canonical task definition; hashed into `taskHash` by the issuer.
     * Accepted as unknown — its content is opaque to the broker.
     */
    taskDefinition: z.unknown(),
    /**
     * Must correspond to an entry already seeded in the resource registry.
     * @see CAPABILITY_SPEC.md field: `resource_id`
     */
    resourceId: uuidSchema.describe(
      "UUID of the resource registry entry to issue against (issuer.ts: IssueCapabilityInput.resourceId).",
    ),
    /**
     * Must exactly match the registry entry's price — no dynamic pricing.
     * @see CAPABILITY_SPEC.md field: `exact_amount`
     */
    exactAmount: decimalSchema.describe(
      "Exact amount; must match the registry price for resourceId (issuer.ts: IssueCapabilityInput.exactAmount).",
    ),
    /**
     * The specific payment request being vetted; hashed into
     * `paymentRequestHash` by the issuer. Accepted as unknown.
     */
    paymentRequest: z.unknown(),
    /**
     * The sandbox's attested workload identity.
     * @see CAPABILITY_SPEC.md field: `session`
     */
    session: publicKeySchema.describe(
      "The sandbox's attested workload identity (issuer.ts: IssueCapabilityInput.session).",
    ),
  })
  .readonly()
  .describe("POST /issue request body — the fields required to issue a new Capability.");

/**
 * Request body for the POST /issue endpoint.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `issueRequestSchema` by `_assertIssueRequestShape` below.
 * @see apps/broker/src/issuer.ts `IssueCapabilityInput`
 */
export interface IssueRequest {
  /** The canonical task definition; hashed (not stored) into taskHash. */
  readonly taskDefinition: unknown;
  /** UUID of the resource registry entry to issue against. */
  readonly resourceId: Uuid;
  /** Exact amount; must match the registry price for resourceId. */
  readonly exactAmount: Decimal;
  /** The specific payment request; hashed (not stored) into paymentRequestHash. */
  readonly paymentRequest: unknown;
  /** The sandbox's attested workload identity. */
  readonly session: PublicKey;
}

/** Compile-time check that `issueRequestSchema` and `IssueRequest` stay in sync. */
function _assertIssueRequestShape(x: z.infer<typeof issueRequestSchema>): IssueRequest {
  return x;
}

// ---------------------------------------------------------------------------
// Attestation channel handshake (docs/PROTOCOL.md §5, task 2.3)
//
// Wire shapes only. The structural type for a proof and the verification
// logic itself live in `@paybound/protocol` (`AttestationProof`,
// `verifyAttestationProof`) — both apps need those, and neither app can
// import the other. These schemas are the runtime-validation half, kept
// here alongside every other wire shape per this file's own convention.
// ---------------------------------------------------------------------------

/**
 * Schema for the `POST /attest/challenge` request body: the sandbox asks
 * the Broker for a single-use challenge to sign, naming the workload
 * identity it intends to prove possession of.
 * @see docs/PROTOCOL.md §5
 * @see docs/ATTESTATION_HANDSHAKE_DESIGN.md §1
 */
export const attestationChallengeRequestSchema = z
  .object({
    /** The sandbox's attested workload identity — the same value that becomes `session` on any capability issued for it. */
    publicKey: publicKeySchema.describe(
      "The sandbox's attested workload identity, hex-encoded Ed25519 SPKI DER (docs/PROTOCOL.md §5).",
    ),
  })
  .readonly()
  .describe("POST /attest/challenge request body — names the workload identity requesting a challenge.");

/**
 * Request body for `POST /attest/challenge`.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `attestationChallengeRequestSchema` by `_assertAttestationChallengeRequestShape` below.
 */
export interface AttestationChallengeRequest {
  /** The sandbox's attested workload identity. */
  readonly publicKey: PublicKey;
}

/** Compile-time check that `attestationChallengeRequestSchema` and `AttestationChallengeRequest` stay in sync. */
function _assertAttestationChallengeRequestShape(
  x: z.infer<typeof attestationChallengeRequestSchema>,
): AttestationChallengeRequest {
  return x;
}

/**
 * Schema for the `POST /attest/challenge` success response: the
 * single-use, high-entropy challenge the sandbox must sign, and when it
 * stops being accepted.
 * @see docs/PROTOCOL.md §5
 */
export const attestationChallengeResponseSchema = z
  .object({
    /** Single-use, high-entropy random challenge the sandbox signs to prove live key possession. */
    challenge: z
      .string()
      .describe("Single-use, high-entropy challenge string to be signed (docs/PROTOCOL.md §5)."),
    /** ISO 8601 timestamp after which this challenge is no longer accepted. */
    expiresAt: timestampSchema.describe(
      "ISO 8601 timestamp after which this challenge is no longer accepted.",
    ),
  })
  .readonly()
  .describe("POST /attest/challenge response body — the challenge to sign, and its expiry.");

/**
 * Response body for `POST /attest/challenge`.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `attestationChallengeResponseSchema` by `_assertAttestationChallengeResponseShape` below.
 */
export interface AttestationChallengeResponse {
  /** Single-use challenge string to sign. */
  readonly challenge: string;
  /** ISO 8601 timestamp after which the challenge is no longer accepted. */
  readonly expiresAt: Timestamp;
}

/** Compile-time check that `attestationChallengeResponseSchema` and `AttestationChallengeResponse` stay in sync. */
function _assertAttestationChallengeResponseShape(
  x: z.infer<typeof attestationChallengeResponseSchema>,
): AttestationChallengeResponse {
  return x;
}

/**
 * Schema for the `POST /attest/verify` request body — the attestation
 * proof itself, exactly as `createProof` (apps/sandbox/src/attestation.ts)
 * produces it.
 *
 * The structural type for this shape is `AttestationProof` in
 * `@paybound/protocol`, which is also what `verifyAttestationProof`
 * accepts; this schema is deliberately kept structurally identical to it.
 * There is no duplicate hand-written interface here because that type
 * already exists (and is the one both sides of the handshake are defined
 * against) — the Broker parses with this schema and hands the result
 * straight to `verifyAttestationProof`, so the two are checked against
 * each other at that call site.
 * @see docs/PROTOCOL.md §5
 */
export const attestationProofSchema = z
  .object({
    /** The workload identity being proven — must match the publicKey the challenge was issued to. */
    publicKey: publicKeySchema.describe(
      "The workload identity being proven (docs/PROTOCOL.md §5).",
    ),
    /** The exact challenge string previously issued by the Broker. */
    challenge: z.string().describe("The exact challenge string previously issued by the Broker."),
    /** Hex-encoded Ed25519 signature over `challenge`. */
    signature: z.string().describe("Hex-encoded Ed25519 signature over `challenge`."),
  })
  .readonly()
  .describe("POST /attest/verify request body — the attestation proof { publicKey, challenge, signature }.");

/**
 * Schema for the `POST /attest/verify` success response: confirmation
 * that the channel is attested, and for how long.
 * @see docs/ATTESTATION_HANDSHAKE_DESIGN.md §2
 */
export const attestationVerifyResponseSchema = z
  .object({
    /** Always `true` on a 200 — a failed verification is a 401, not a `false` here. */
    attested: z.literal(true).describe("Always true on success; failure is a 401, not attested:false."),
    /** ISO 8601 timestamp after which this session must re-attest. */
    expiresAt: timestampSchema.describe(
      "ISO 8601 timestamp after which this session must re-attest.",
    ),
  })
  .readonly()
  .describe("POST /attest/verify response body — the attested window established by a valid proof.");

/**
 * Response body for `POST /attest/verify`.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `attestationVerifyResponseSchema` by `_assertAttestationVerifyResponseShape` below.
 */
export interface AttestationVerifyResponse {
  /** Always `true` on success. */
  readonly attested: true;
  /** ISO 8601 timestamp after which this session must re-attest. */
  readonly expiresAt: Timestamp;
}

/** Compile-time check that `attestationVerifyResponseSchema` and `AttestationVerifyResponse` stay in sync. */
function _assertAttestationVerifyResponseShape(
  x: z.infer<typeof attestationVerifyResponseSchema>,
): AttestationVerifyResponse {
  return x;
}

/** Schema for the sandbox's payment tool call response; see the `PayResponse` type below for the full doc. */
export const payResponseSchema = z
  .object({
    state: publicPaymentStateSchema,
  })
  .readonly()
  .describe("The resulting payment state (nonce omitted) after the Broker processed a PayRequest.");

/**
 * Response shape for the sandbox's single payment tool call: the resulting
 * payment state after the Broker processed the request.
 *
 * Deliberately typed as `PublicPaymentState`, not `PaymentState`: the
 * sandbox must never receive `nonce` (docs/OPEN_QUESTIONS.md "Resolved:
 * capability_id vs. nonce"), and using the nonce-omitted type here makes
 * that a structural, compile-time guarantee rather than something an
 * implementation has to remember to strip at the HTTP boundary.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `payResponseSchema` by `_assertPayResponseShape` below.
 * @see docs/PROTOCOL.md §3 "Response shape — success"
 * @see ARCHITECTURE.md "Broker↔Sandbox protocol" (`packages/protocol`)
 * @see docs/OPEN_QUESTIONS.md "Resolved: nonce omitted from PayResponse via a dedicated public payment-state type"
 */
export interface PayResponse {
  /** The resulting payment state after the Broker processed the request, nonce omitted. */
  readonly state: PublicPaymentState;
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
    /** The reservation this successful authorization produced. */
    state: reservedPaymentStateSchema,
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
 * On success, carries the `ReservedPaymentState` that authorization
 * actually produced: clauses 7-9 (replay, stale nonce, over-budget) are
 * enforced by performing the atomic `RESERVED` transition itself
 * (CAPABILITY_SPEC.md "Atomicity note") — a successful `authorize()` call
 * has already burned the nonce and reserved the budget, so the resulting
 * `ReservedPaymentState` is real, produced state, not something a caller
 * should have to reconstruct from a second lookup.
 *
 * Hand-written to preserve field-level hover JSDoc; kept in sync with
 * `authorizationResultSchema` by `_assertAuthorizationResultShape` below.
 * @see SECURITY_INVARIANT.md "The invariant"
 * @see CAPABILITY_SPEC.md "The payment state machine" — `RESERVED`
 */
export type AuthorizationResult =
  | Readonly<{
      authorized: true;
      /** The reservation this successful authorization produced. */
      state: ReservedPaymentState;
    }>
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
