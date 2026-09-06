# Open Questions

## Ledger signing curve mismatch (blocks task 3.1)

**Status:** Unresolved. Blocking.

`docs/TECH_STACK_ADR.md` specifies `@ledgerhq/hw-app-eth` for the Ledger
integration (`packages/ledger-signer`), which signs using secp256k1
(Ethereum-style signing). Hedera, however, natively uses the Ed25519 curve
for account keys and transaction signing.

This is a real mismatch, not just a naming detail: `hw-app-eth` cannot
produce Ed25519 signatures, and a Ledger device signs with whichever app
(Ethereum app vs. a curve-appropriate alternative) matches the target
curve. If the broker's signer is expected to produce signatures Hedera will
accept, the Ledger-side app/library chosen in task 3.1 needs to match
Hedera's curve, not necessarily `hw-app-eth`.

**Why this matters now, not just at task 3.1:** the Phase 1 stub signer
(tasks 1.5/1.6) needs to produce payment signatures in the same
shape/curve that the real Ledger-backed signer (task 3.1) will eventually
produce. If the curve is decided only when task 3.1 starts, the stub
signer and any code built against its output (state machine transitions,
`Broker.authorize` checks, property tests) may need to be reworked.

**What needs to happen:** whoever picks up Ledger research should confirm,
before 1.5/1.6 are implemented:
- Which curve/signature scheme the settlement path actually requires
  (this may depend on whether settlement is on Hedera directly, or via an
  EVM-compatible path such as Hedera's JSON-RPC relay, which would bring
  secp256k1 back into play).
- Which Ledger app and library support that curve (e.g. a Hedera-specific
  Ledger app, or a generic curve app, if `hw-app-eth` doesn't apply).

This question is intentionally left open here — no resolution is proposed,
only the conflict and its downstream impact.

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

## RECOVERABLE / FAILED transition triggers are not specified in the source

**Status:** Unresolved. Non-blocking for Phase 0, but relevant to task 1.5.

The source's state machine diagram shows `RESERVED -> RECOVERABLE` and
`SUBMITTED -> FAILED` as branches, but never states the specific conditions
that cause either transition (e.g., what makes a reservation abandoned or
recoverable, versus a submission outright failing). `CAPABILITY_SPEC.md`
describes these transitions in general terms consistent with their position
in the diagram, without inventing specific triggering conditions beyond
that. Whoever implements task 1.5 (the state machine) will need to define
the actual triggering conditions for each branch — that's an implementation
decision, not something this documentation pass should have guessed at.

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
