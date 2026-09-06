# Security Invariant

This document formalizes the single invariant that `Broker.authorize(payment)`
must enforce. It is the authoritative statement of the invariant — the README
summarizes it, this document is where every clause is spelled out.

## The invariant

```
Broker.authorize(payment) ⟹
  payment.amount == capability.exact_amount ∧
  payment.destination == capability.recipient ∧
  payment.resource == capability.resource_id ∧
  payment.task_hash == capability.task_hash ∧
  payment.session == capability.session ∧
  payment.payment_request_hash == capability.payment_request_hash ∧
  capability.nonce is unconsumed ∧
  now < capability.expiry ∧
  (task.spent_so_far + payment.amount) ≤ task.max_total_spend
```

If any conjunct is false, the Broker must not authorize the payment. There is
no partial authorization and no clause the Broker is permitted to waive.

## Each clause, and what violating it means

### `payment.amount == capability.exact_amount`

The payment must move exactly the amount fixed on the capability — not "up
to," not a dynamically re-priced amount. A payment that satisfies every other
clause but differs in amount is a **substitution**: the attacker didn't
change where the money goes, they changed how much, and that is just as much
a break of the guarantee as changing the destination.

### `payment.destination == capability.recipient`

The payment must go to the recipient fixed at vetting time. A payment that
satisfies every other clause but names a different destination is the
canonical **substitution** attack — e.g. injected content telling the agent
to "pay this amount to a different address instead." Because the agent's
payment tool never has a destination field to populate, this clause is
mostly a backstop against a compromised or buggy Broker construction path,
not against the agent itself.

### `payment.resource == capability.resource_id`

The payment must be for the specific, pre-vetted resource registry entry the
capability was bound to. A payment that targets a different resource,
including an unlisted one, is an **escalation** attempt — e.g. injected
content telling the agent to "use a different, unlisted resource." This is
the clause the demo's escalation moment (Moment C) exercises directly.

### `payment.task_hash == capability.task_hash`

The payment must be for the exact canonical task the capability was issued
against. A mismatch here means the capability is being used outside the task
it was scoped to — a **task_hash mismatch** — which would let a capability
issued for one task authorize spending against a different task's context or
budget. `task_hash` is a hash of the canonical task definition, not a version
number, so any change to the task's meaning changes the hash.

### `payment.session == capability.session`

The payment must originate from the same sandbox workload identity the
capability was bound to. A payment presented from a different session is a
**session mismatch** — e.g. a capability leaked or replayed from one sandbox
instance being used by another. The session's attested key authenticates the
channel; this clause is what ties a specific capability to a specific
authenticated channel.

### `payment.payment_request_hash == capability.payment_request_hash`

The payment must match the exact hash binding *what* the payment is for, not
merely where it goes or how much it costs. This clause exists precisely
because destination and amount alone are not sufficient to describe a
payment's purpose — two payments to the same recipient for the same amount
can still be for different things, and this hash is what prevents that gap
from being exploited.

### `capability.nonce is unconsumed`

The capability's nonce must not have already been burned by a prior use.
Reusing a capability whose nonce is already consumed is a **replay** —
resubmitting a previously authorized (or previously attempted) payment to
extract value twice from a single-use grant.

### `now < capability.expiry`

The capability must not have expired. A capability presented after its
expiry is a **stale nonce** condition: even if the nonce itself hasn't been
consumed, a capability's short-lived-by-default window is a distinct
input-freshness guarantee from consumption, so it is checked as a separate
conjunct.

### `(task.spent_so_far + payment.amount) ≤ task.max_total_spend`

The task's cumulative spend, including this payment, must not exceed the
task's declared budget. Exceeding it is going **over-budget** — the failure
mode this clause exists to prevent regardless of whether any individual
payment's amount, destination, or resource is otherwise valid.

## Atomicity note

Per the capability spec's state machine, nonce-burning and this budget check
happen together, atomically, at the `RESERVED` transition — in the same
transaction, with no gap between checking a constraint and consuming it. This
matters for the invariant because "nonce is unconsumed" and the budget
inequality are both evaluated against state that must not be allowed to
change between the check and the commit; without atomicity, a concurrent
payment against the same task could pass both checks before either consumes
its share of the budget or its nonce, defeating the invariant despite every
individual clause being satisfied at the instant it was checked.

## Within the TCB

Stated precisely: **within the stated trust boundary, untrusted agent
context cannot cause the Broker to authorize a payment violating these
invariants.** Not "cannot, period" — cannot, within the trusted computing
base (TCB).

This qualifier is load-bearing, not a hedge. The invariant says nothing about
what happens if a component inside the trust boundary itself is compromised
— a compromised issuer, a compromised sandbox, a compromised facilitator
altering settlement parameters after the Broker's signature, or a
legitimately-vetted resource that later turns malicious are all explicitly
out of scope for this guarantee. See [`THREAT_MODEL.md`](./THREAT_MODEL.md)
for the full trusted/adversarial/out-of-scope boundary this invariant is
scoped against.
