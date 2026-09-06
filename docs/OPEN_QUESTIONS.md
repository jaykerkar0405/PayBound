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

## Violation-type labeling in SECURITY_INVARIANT.md is an interpretation

**Status:** Unresolved. Non-blocking (documentation clarity only).

The spec (and `docs/TASKS.md` task 0.2) names exactly seven violation types
for the invariant's clauses: replay, substitution, escalation, stale nonce,
session mismatch, task_hash mismatch, and over-budget. The invariant itself
has nine conjuncts. `SECURITY_INVARIANT.md` had to make two judgment calls
that aren't settled by the source text:

- **`stale nonce`** was mapped to the `now < capability.expiry` clause,
  rather than to nonce reuse (which was mapped to `replay`). The source
  never states whether "stale nonce" means an expired capability or a
  consumed-nonce replay attempt — these are two different failure
  mechanisms sharing an ambiguous name.
- **`substitution`** was applied to both the amount clause
  (`payment.amount == capability.exact_amount`) and the destination clause
  (`payment.destination == capability.recipient`), since the source's
  three-moment demo (Moment B) describes a substitution attack that changes
  destination while holding amount fixed, but doesn't explicitly say whether
  an amount-only mismatch is also called "substitution" or is its own
  category.
- **`payment.resource == capability.resource_id`** was labeled
  `escalation`, matching Moment C ("use a different, unlisted resource").
  This one is fairly directly supported by the source, but is included here
  for completeness since it's part of the same mapping exercise.
- **`payment.payment_request_hash == capability.payment_request_hash`** does
  not map cleanly to any of the seven named violation types. It was
  described in `SECURITY_INVARIANT.md` without forcing it into one of the
  seven labels, rather than inventing an eighth name not present in the
  source.

None of this affects the invariant's enforcement (every clause is still
checked exactly as written); it only affects what to call a given violation
in logs, error messages, or test names. Worth settling — possibly as part of
task 0.4 (wire protocol error codes) or task 1.8 (property tests), where a
concrete list of test/error names will be needed anyway — before those names
get baked into code.

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
