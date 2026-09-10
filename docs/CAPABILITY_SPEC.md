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
  Short-lived by default: capabilities are issued with a **5-minute (300
  second)** expiry from issuance time. This is short enough to limit the
  window an intercepted-but-unused capability could be replayed within
  (relevant to the `STALE_NONCE` clause in `SECURITY_INVARIANT.md`), while
  long enough for a normal agent task to complete without the capability
  expiring mid-task. Checked in the invariant as `now < capability.expiry`.
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
  capabilities issued against it **for the single resource the task is
  bound to** (see "One resource per task" below).
- **`spent_so_far`** — the running total spent against this task,
  Broker-maintained and atomically updated. Checked in the invariant as
  `(task.spent_so_far + payment.amount) ≤ task.max_total_spend`.

### One resource per task (deliberate scope decision)

**A task's budget is bound to a single resource.** Many capabilities can
be issued against the same `task_hash` *and* the same `resource_id` over
the task's lifetime — that's the "many capabilities, one shared budget"
model `max_total_spend` describes. A single `task_hash` cannot span
*multiple different* resources: the first `resource_id` ever issued
against a given `task_hash` binds that task to that resource for good.

This is a deliberate scope decision, not a limitation to be lifted later.
`max_total_spend` is a single decimal value, derived from one resource's
registry price (see below) — it has no principled way to size itself for
multiple different resource prices sharing one task without picking a
number that's simply wrong for at least one of them. An earlier version
of the implementation didn't enforce this and let a second `/issue` call
for a different resource silently succeed while leaving `max_total_spend`
frozen at whatever the *first* resource's price happened to be — an
investigation into that behavior found this produces confusing,
order-dependent `BUDGET_EXCEEDED` rejections of otherwise perfectly valid,
correctly-priced capabilities (a capability for a pricier resource, issued
second under a task whose budget was frozen at a cheaper resource's price,
can never be paid at all — even completely fresh, with nothing else ever
spent against the task). `apps/broker/src/routes/issue.ts` now rejects
such a request outright (`409 task_resource_mismatch`), before issuing
anything, rather than allowing it to silently succeed and fail later at
`/pay` with a misleading `BUDGET_EXCEEDED`.

### How a `Task` row actually gets created

`POST /issue` (`apps/broker/src/routes/issue.ts`, task 6.x) creates the
`Task` row synchronously, in the same request as capability issuance, the
first time a given `task_hash` is issued against — closing the gap where
an issued capability had no budget row to reserve against at `/pay` time.

`max_total_spend` is set to the resource registry's own `price` for the
capability's `resource_id` (`registry.ts`'s `getResourceById`) — never
from the request body's `exact_amount` field directly, even though
`issueCapability()` already guarantees the two are equal by this point.
Since the registry is closed and immutable at runtime (no seeding
endpoint, no runtime mutation), this means a caller of `/issue` has no way
to name or influence its own spending cap: the value is entirely
registry-derived.

Idempotent by design, within the one-resource-per-task constraint above: a
`Task` is meant to have multiple capabilities issued against it over its
lifetime, all for the same resource. `/issue` only creates the `Task` row
when none exists yet for that `task_hash`; a second `/issue` call for the
same task definition *and the same resource* issues another capability
against the already-funded task rather than erroring or re-funding it. A
task's budget, sized to exactly one resource's price, is naturally
exhausted by the first payment against it — a second capability issued
against the same task (for the same resource) will correctly hit
`BUDGET_EXCEEDED` (clause 9) at `/pay` time, not a bug.

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

## Sandbox attestation handshake (optional, off by default)

The sandbox attestation channel handshake (task 2.3,
`apps/broker/src/routes/attest.ts`, `docs/PROTOCOL.md` §5) is **gated and
off by default**, and — like the Chainlink CRE check below — is
**defense-in-depth, not one of the 9 invariant clauses**:

- **What it does when enabled** (`ATTESTATION_ENABLED=true`): the sandbox
  proves live possession of the ephemeral Ed25519 key behind its `session`
  value, via a single-use Broker-issued challenge. `/issue` and `/pay`
  then reject any session without a live verified attestation, with
  `401 attestation_required`. A handshake that is attempted and refused
  returns `401 attestation_failed`.

- **Fail-closed when enabled** — deliberately unlike the CRE check's
  fail-open behaviour. CRE fails open because a third-party gateway can be
  unreachable; attestation verification is a local check with no external
  dependency, so failing open would make the flag meaningless.

- **Off is the shipped default**, including for the demo. With
  `ATTESTATION_ENABLED` unset or `false`, `/issue` and `/pay` behave
  exactly as they do without any of this, and `/attest/*` returns
  `404 attestation_not_enabled` so a sandbox can detect that no handshake
  is required and proceed.

- **The 9 clauses are untouched either way.** `Broker.authorize()` does
  not consult attestation state. Clause 5
  (`payment.session == capability.session`) remains plain field equality:
  it ties a capability to the session it was issued for, and has never
  claimed to prove who is presenting that session. Removing the
  handshake entirely would not weaken any clause in
  `SECURITY_INVARIANT.md`.

- **Scope limit:** even enabled, this does not defend against a
  compromised sandbox (`THREAT_MODEL.md` excludes that) — such a sandbox
  can generate its own keypair and attest legitimately. It prevents a
  third party presenting a `session` value it cannot prove possession of.

## Chainlink CRE optional policy check

The Chainlink CRE confidential spend-policy check (task 5.2,
`apps/broker/src/cre-policy.ts`) is **explicitly optional** and
**non-load-bearing**:

- It is a **defense-in-depth** pre-issuance gate, not a security invariant.
  The 9 invariant clauses in `SECURITY_INVARIANT.md` (replay protection,
  nonce burn, field matching, budget check, destination immutability, etc.)
  are checked by `Broker.authorize()` against the capability's committed
  fields — all of which are set by `issueCapability()`, which the CRE check
  runs _before_. The CRE check has no influence on what `authorize()` checks
  or how it checks it.

- **Fail-open semantics**: if the CRE gateway is unreachable, the URL is
  not configured, or any error occurs, `checkSpendPolicy()` returns
  `{ allowed: true }` and issuance continues exactly as if the check had
  never run. A broken CRE gateway cannot take `/issue` offline.

- **Removal is safe**: deleting `checkSpendPolicy` from `issue.ts` (or
  setting `CRE_ENABLED=false`) removes the check entirely. No other code
  path depends on it. None of the 9 invariant clauses are weakened.

- **What it does**: when enabled (`CRE_ENABLED=true`) and a gateway
  responds with `{ allowed: false }`, issuance is blocked with HTTP 403
  `spend_policy_exceeded`. This is the only code path where the CRE check
  has any effect on issuance. See `docs/CHAINLINK_CRE_DESIGN.md` for the
  policy question, integration point, and gateway protocol.

This framing matches the pattern established in `THREAT_MODEL.md`'s
network-isolation scope correction (PR #62): an optional, defence-in-depth
control is documented as such so its presence or absence is never
ambiguous.
