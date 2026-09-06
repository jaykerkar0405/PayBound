# Capability Spec

This document formalizes the `Capability` and `Task` object definitions and
the payment state machine. It is the authoritative reference for the object
shapes that [`SECURITY_INVARIANT.md`](./SECURITY_INVARIANT.md) checks fields
against, and for the transitions that
[`THREAT_MODEL.md`](./THREAT_MODEL.md)'s adversarial inputs are structurally
unable to influence.

## The `Capability` object

```
Capability {
  task_hash: hash                 // H(canonical task definition) — not a version number
  resource_id: uuid                // bound to a trusted resource registry entry
  recipient: address               // fixed at vetting time, immutable
  exact_amount: decimal            // exact, not "up to" — no dynamic pricing in MVP
  payment_request_hash: hash       // binds *what* this payment is for, not just where/how much
  session: public_key              // sandbox's attested workload identity
  nonce: unique_id                 // burned atomically on use
  expiry: timestamp                // short-lived by default
  max_uses: 1                      // single-use unless explicitly justified otherwise
}
```

Field by field:

- **`task_hash`** — a hash of the canonical task definition, `H(canonical
  task definition)`. This is explicitly not a version number: it is a
  content hash, so any change to the task's meaning changes the hash. It
  scopes the capability to a specific task and is checked against
  `payment.task_hash` in the invariant.
- **`resource_id`** — a UUID bound to an entry in the trusted resource
  registry. It scopes the capability to a specific, pre-vetted resource and
  is checked against `payment.resource` in the invariant.
- **`recipient`** — the destination address, fixed at vetting time and
  immutable thereafter. It is checked against `payment.destination` in the
  invariant.
- **`exact_amount`** — the exact decimal amount to be paid. Exact, not "up
  to": there is no dynamic pricing in the MVP, so this is a fixed value, not
  a ceiling. It is checked against `payment.amount` in the invariant.
- **`payment_request_hash`** — a hash binding *what* this payment is for,
  distinct from where it goes or how much it costs. It is checked against
  `payment.payment_request_hash` in the invariant, and exists because
  destination and amount alone don't fully describe a payment's purpose.
- **`session`** — the public key identifying the sandbox's attested workload
  identity. It ties the capability to a specific authenticated channel and
  is checked against `payment.session` in the invariant.
- **`nonce`** — a unique identifier burned atomically on use. Its consumption
  state is checked in the invariant (`capability.nonce is unconsumed`), and
  burning it is what makes reuse (replay) impossible.
- **`expiry`** — a timestamp after which the capability is no longer valid.
  Short-lived by default. Checked in the invariant as `now < capability.expiry`.
- **`max_uses`** — fixed at `1` unless explicitly justified otherwise:
  capabilities are single-use.

## The `Task` object

```
Task {
  task_hash: hash
  max_total_spend: decimal
  spent_so_far: decimal            // Broker-maintained, atomically updated
}
```

- **`task_hash`** — the same canonical task hash referenced by every
  capability issued against this task.
- **`max_total_spend`** — the task's declared spending ceiling, across all
  capabilities issued against it.
- **`spent_so_far`** — the running total spent against this task,
  Broker-maintained and atomically updated. Checked in the invariant as
  `(task.spent_so_far + payment.amount) ≤ task.max_total_spend`.

## MVP constraint: one active capability per session

Exactly one active capability may exist per session at any time. This isn't
a limitation to apologize for — it's what makes the demo unambiguous and the
invariant trivial to state: at any point in time, a given session has at
most one capability that could possibly be authorized, so there is never a
question of which capability a given payment attempt is being checked
against.

## The payment state machine

```
ISSUED → RESERVED → SUBMITTED → SETTLED
                         │
                   ┌─────┴─────┐
                   ↓           ↓
             RECOVERABLE    FAILED
```

- **`ISSUED`** — the capability issuer has produced a signed `Capability`
  object from trusted task state. No payment has been attempted yet.
- **`RESERVED`** — the Broker has accepted a payment attempt against the
  capability. This is where nonce-burning and aggregate-budget-checking
  happen atomically, in the same transaction: there is no gap between
  checking a constraint (unconsumed nonce, budget headroom) and consuming it
  (burning the nonce, incrementing `spent_so_far`), and no race between
  concurrent requests against the same task budget. A capability cannot
  reach `RESERVED` twice — the nonce burn at this step is exactly what
  prevents that.
- **`SUBMITTED`** — the Broker has constructed and signed the canonical
  payment request and submitted it for settlement.
- **`SETTLED`** — the settlement network has confirmed the payment.
- **`RECOVERABLE`** — reachable from `SUBMITTED`; see "Triggering conditions
  for `RECOVERABLE` and `FAILED`" below.
- **`FAILED`** — reachable from `SUBMITTED`; see "Triggering conditions for
  `RECOVERABLE` and `FAILED`" below.

### Triggering conditions for `RECOVERABLE` and `FAILED`

Both `RECOVERABLE` and `FAILED` are reached from `SUBMITTED`, and the
distinction between them is about what the Broker actually knows at the
moment of transition — not about severity.

- **`FAILED`** — the settlement network (Hedera) returns a definitive
  negative result for the submitted transaction (e.g. rejected, invalid).
  This is an unambiguous, known outcome: the payment definitely did not
  settle. No reconciliation is needed; the state machine can move directly
  to `FAILED`.

- **`RECOVERABLE`** — the outcome of the submission is *unknown* at the time
  of transition: caused by a network timeout, a connection failure, a
  Broker crash mid-flight, or any case where no confirmation was received
  from the settlement network. This is explicitly **not** the same as
  `FAILED` — the payment may or may not have actually settled.

  Moving to `RECOVERABLE` means the correct next step is to **query the
  settlement network directly, by transaction ID, to determine the actual
  outcome** — not to blindly retry submitting a new payment (which risks
  double-submission) and not to assume success or failure either way. Once
  reconciliation completes, the state machine transitions to the
  appropriate final state: `SETTLED` if the query confirms the payment
  actually settled, `FAILED` if it confirms the payment did not.

  Because of this, `RECOVERABLE` requires a genuine reconciliation
  mechanism against the settlement network as part of its implementation —
  a query-by-transaction-ID path, not merely a retry loop.

## Atomicity note

The atomicity of nonce-burning and budget-checking at `RESERVED` is the
mechanism that makes several of the invariant's clauses in
`SECURITY_INVARIANT.md` actually hold under concurrency, not just in the
single-request case:

- It is what makes replay structurally impossible rather than merely
  checked-for: once a nonce is burned as part of the same transaction that
  reserves the payment, no later attempt can find that nonce unconsumed.
- It is what makes the budget clause
  (`task.spent_so_far + payment.amount ≤ task.max_total_spend`) safe against
  concurrent payments against the same task: two simultaneous reservation
  attempts cannot both observe the same `spent_so_far` and both proceed,
  because the check and the update happen together, in one transaction, at
  `RESERVED`.
