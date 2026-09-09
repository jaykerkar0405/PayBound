# Open Questions

## Resolved: Attestation mechanism for the Broker<->Sandbox channel handshake (task 2.3)

**Status:** Resolved.

Previously: `docs/PROTOCOL.md` §5 specified the requirements (identity and
freshness/non-replay) but left the concrete mechanism open, tracking container
IDs or signed boot nonces as possible approaches.

Decision: The sandbox generates an ephemeral Ed25519 asymmetric keypair in memory
at startup before any untrusted content is read (per `THREAT_MODEL.md`). The
public key (SPKI DER hex) serves as `session: PublicKey` in `packages/types`.
Freshness/non-replay is enforced via challenge-response: the sandbox signs a
single-use Broker challenge with the in-memory private key. The private key is
never persisted to disk or logged. `docs/PROTOCOL.md` §5 and
`apps/sandbox/src/attestation.ts` implement this mechanism.

## Resolved: AuthorizationFailureReason names now match SECURITY_INVARIANT.md's resolved clause names

**Status:** Resolved.

Previously: `packages/types`' `AuthorizationFailureReason` (and
`authorizationFailureReasonSchema`) used 9 values named directly after each
clause's own terms (`DESTINATION_MISMATCH`, `PAYMENT_REQUEST_HASH_MISMATCH`,
`NONCE_CONSUMED`, `CAPABILITY_EXPIRED`), predating task 0.3.1a's resolution
of the 7-vs-9 violation-type mapping.

Decision: `packages/types` has been updated to use
`SECURITY_INVARIANT.md`'s resolved clause names directly —
`DESTINATION_MISMATCH` -> `SUBSTITUTION`, `PAYMENT_REQUEST_HASH_MISMATCH` ->
`REQUEST_FORGERY`, `NONCE_CONSUMED` -> `REPLAY`, `CAPABILITY_EXPIRED` ->
`STALE_NONCE` (the other 5 values were already correct). `docs/PROTOCOL.md`
§4 has been updated to match.

## Resolved: Ledger signing curve mismatch (task 3.1a)

**Status:** Resolved 2026-09-09.

Previously: `docs/TECH_STACK_ADR.md` specified `@ledgerhq/hw-app-eth` for
the Ledger integration (`packages/ledger-signer`), which signs using
secp256k1 (Ethereum-style signing). Hedera, however, natively uses the
Ed25519 curve for account keys and transaction signing — a real mismatch,
not just a naming detail, since `hw-app-eth` cannot produce Ed25519
signatures and a Ledger device signs with whichever app matches the
target curve. This mattered before task 3.1 itself, too: the Phase 1 stub
signer (tasks 1.5/1.6) needed to produce payment signatures in the same
shape/curve the real Ledger-backed signer would eventually produce, so the
curve couldn't be left undecided until 3.1 started without risking rework
of the stub signer and anything built against its output (state machine
transitions, `Broker.authorize` checks, property tests).

Decision: **ECDSA secp256k1**, not Ed25519 — Hedera now recommends
secp256k1 as the default curve for new accounts/apps (per
docs.hedera.com); Ed25519 remains legacy/supported but is not the
recommended default. `hw-app-eth` still isn't the right library, though:
`@ledgerhq/hw-app-eth` is deprecated and, more importantly, Hedera has its
own dedicated Ledger device app (`LedgerHQ/app-hedera`) that does not sign
through the Ethereum app. That device app defines a real signing
instruction, `INS_SIGN_TRANSACTION` (`0x04`), confirmed as a single-APDU
exchange (not a multi-step/streamed protocol) — see
`docs/LEDGER_HEDERA_RESEARCH.md` for the full investigation and evidence
(issue 3.1a). Task 3.1b implements a minimal custom APDU client against
this instruction rather than routing through `hw-app-eth` or the
incomplete `@ledgerhq/hw-app-hedera` JS wrapper.

## Resolved: violation-type labeling in SECURITY_INVARIANT.md (task 0.3.1)

**Status:** Resolved.

The spec's 7 named violation types (replay, substitution, escalation, stale
nonce, session mismatch, task_hash mismatch, over-budget) didn't cover the
invariant's 9 clauses without ambiguity — see the git history of this
section for the original analysis of exactly where they fell short.

Decision: each of the 9 clauses now has one explicit, unambiguous name,
spelled out in `SECURITY_INVARIANT.md` "Each clause, and what violating it
means" (1. Amount mismatch, 2. Substitution, 3. Resource mismatch, 4.
Task_hash mismatch, 5. Session mismatch, 6. Request forgery, 7. Replay, 8.
Stale nonce, 9. Over-budget). Two names are new relative to the original
seven — **resource mismatch** (distinct from escalation, which is a
sandbox/agent-layer UX decision, not a `Broker.authorize` outcome — see
`THREAT_MODEL.md` "Escalation is not one of the Broker's invariant
clauses") and **request forgery** (distinct from substitution: wrong
underlying request vs. wrong destination) — and "stale nonce" is now
expiry-only, distinct from "replay" (nonce reuse), by attack timing. See
`SECURITY_INVARIANT.md` for the full per-clause explanations and examples.

## Resolved: RECOVERABLE / FAILED transition triggers (task 0.3.1b)

**Status:** Resolved.

Previously: the source's state machine diagram showed `RECOVERABLE` and
`FAILED` as branches but never stated the specific conditions that cause
either transition.

Decision: both are reached from `SUBMITTED`, distinguished by what the
Broker actually knows at the moment of transition, not by severity —
`FAILED` is a definitive negative result from the settlement network
(known outcome, no reconciliation needed); `RECOVERABLE` is an unknown
outcome (timeout, connection failure, broker crash mid-flight — no
confirmation received), which requires querying the settlement network by
transaction ID to reconcile to `SETTLED` or `FAILED`, not a blind retry.
See `CAPABILITY_SPEC.md` "Triggering conditions for `RECOVERABLE` and
`FAILED`" for the full definitions.

## Resolved: capability_id vs. nonce

**Status:** Resolved.

Previously flagged as a `TODO(docs-gap)` in `packages/types` (not tracked
here): CAPABILITY_SPEC.md's 9 `Capability` fields don't define a
`capability_id` distinct from `nonce`, leaving it ambiguous whether
`pay(capability_id)` referenced the nonce directly.

Decision: `capability_id` is a separate, opaque, branded lookup key
(`CapabilityId` in `packages/types`), never the same value as `nonce`. The
nonce stays internal to the Broker's replay-defense mechanism; the sandbox
never sees or handles it. Rationale: an opaque reference and a
replay-defense token should never be the same value, per THREAT_MODEL.md's
framing of the sandbox's payment handle as an "opaque capability reference."
See the relevant PR/commit for the full reasoning.

## Resolved: ResourceRegistryEntry price field

**Status:** Resolved.

Previously flagged as a `TODO(docs-gap)` in `packages/types` (not tracked
here): THREAT_MODEL.md/ARCHITECTURE.md describe the resource registry as
only `resource_id -> recipient`, while `docs/TASKS.md` task 1.2 describes it
as `resource_id -> recipient/price`.

Decision: `docs/TASKS.md` task 1.2 is treated as authoritative on this
point. `ResourceRegistryEntry` now includes a `price: Decimal` field,
intended for a defense-in-depth check at capability issuance time (task
1.3, not yet implemented) — validating that a requested `exactAmount` is
consistent with the resource's known price. It is not read by
`Broker.authorize(payment)`, which only compares `payment.amount` to
`capability.exactAmount`. See the relevant PR/commit for the full reasoning.

## Resolved: nonce omitted from PayResponse via a dedicated public payment-state type

**Status:** Resolved.

Previously (found while implementing task 1.7, the `pay()` route): `docs/PROTOCOL.md`
§3 specifies that a successful response nests the full `ISSUED -> RESERVED
-> SUBMITTED` history, and `Capability` (`packages/types`) requires `nonce`
as a mandatory field — so the then-current `PayResponse`/`PaymentState`
types structurally included the nonce in every successful `pay()` response.
That directly conflicted with "Resolved: capability_id vs. nonce" above:
"The nonce stays internal to the Broker's replay-defense mechanism; the
sandbox never sees or handles it." The first fix for this (a runtime
`redactNonce()` step in `apps/broker/src/routes/pay.ts` that recursively
stripped any `nonce` key from the outgoing JSON) worked, but meant the
emitted response no longer matched what `PayResponse`'s own type claimed to
guarantee — a real, silent type/runtime gap.

Decision: `packages/types` now defines `PublicCapability` (`Capability`
with `nonce` omitted, derived via Zod's `.omit()` from the same object
schema `capabilitySchema` is built from, so it cannot drift from the real
`Capability` shape) and a full mirrored payment-state union —
`PublicIssuedPaymentState`, `PublicReservedPaymentState`,
`PublicSubmittedPaymentState`, `PublicSettledPaymentState`,
`PublicRecoverablePaymentState`, `PublicFailedPaymentState`, and
`PublicPaymentState` — each identical to its `PaymentState` counterpart
except every nested capability is `PublicCapability`. `PayResponse.state`
is now typed as `PublicPaymentState`, not `PaymentState`: it is
structurally impossible to represent a nonce in a `pay()` response, not
just conventionally avoided. `apps/broker/src/routes/pay.ts` builds its
success response via `publicSubmittedPaymentStateSchema.parse(submitted)`
— Zod's default object parsing drops keys outside the target shape, so
passing the real, nonce-carrying `SubmittedPaymentState` through this
schema validates the response and drops the nonce in one step; the
`redactNonce()` runtime stripper has been removed entirely. See the
relevant PR/commit for the full reasoning.

Also fixed alongside this: `AuthorizationResult`'s success case
(`{ authorized: true }`) previously discarded the real `ReservedPaymentState`
that a successful `Broker.authorize(payment)` call produces as a side
effect of its internal `reservePayment` call, forcing callers (the `pay()`
route) to reconstruct an equivalent value from a second database read.
`AuthorizationResult`'s success case is now `{ authorized: true, state:
ReservedPaymentState }`, and `apps/broker/src/routes/pay.ts` uses that real
state directly.

## Resolved: capability-spec drift-check pattern

**Status:** Resolved.

Previously observed (not tracked here as its own entry) while updating
`packages/types`: `packages/capability-spec`'s compile-time drift check
(`_AssertX = z.infer<...> extends X ? true : never`) did not actually
enforce anything, since the resulting type alias was never consumed
anywhere — TypeScript raises no diagnostic for an unused alias that resolves
to `never`. A real mismatch (in `PayResponse`) went undetected by this
mechanism.

Decision: eliminate the two-layer pattern instead of trying to fix the
check, but not by making the exported TypeScript types `z.infer`-derived.
An initial follow-up did that (Zod schema as sole source, type derived via
`z.infer`), but that regressed documentation quality: TypeScript does not
propagate a `.describe()`/JSDoc pair written above a `z.object({...})`
field into editor hover tooltips for the resulting `z.infer`-derived type's
properties, so field-level JSDoc that was clearly present in source stopped
showing up on hover. That regression was found and fixed as a further
follow-up.

The final mechanism, as `packages/types` now stands: Zod schemas remain
canonical for runtime validation and for field-level `.describe()`/JSDoc
authorship. The exported TypeScript types for object/union shapes
(`Capability`, `Task`, `ResourceRegistryEntry`, the payment-state types,
`PayRequest`, `PayResponse`, `CapabilityId`, and the authorization types)
are hand-written `interface`/`type` declarations instead, specifically to
preserve hover-tooltip JSDoc, with their field JSDoc copied verbatim from
the schema. Each hand-written type is paired with an unexported
`_assertXShape` function (e.g. `_assertCapabilityShape`) whose parameter is
typed as `z.infer<typeof xSchema>` and whose return type is the
hand-written type — since parameter and return types are always
type-checked, this fails to compile the moment the two diverge, unlike the
original broken assertion. `packages/capability-spec` still re-exports
these schemas/types rather than defining its own. See the relevant PR/commit
for the full reasoning.
