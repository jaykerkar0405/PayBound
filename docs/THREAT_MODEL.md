# Threat Model

This document formalizes the trusted/adversarial boundary that
[`SECURITY_INVARIANT.md`](./SECURITY_INVARIANT.md) is scoped against. It is
the authoritative statement of that boundary.

## Trusted

- **Task definer** — states the closed resource set before any untrusted
  content is read. There is no autonomous discovery agent in the MVP; the
  set of resources a task can ever pay for is fixed up front, by a trusted
  party, before the agent touches anything adversarial.
- **Resource registry** — the pre-vetted set of `resource_id -> recipient`
  bindings the task definer draws from.
- **Capability issuer** — the component that produces signed `Capability`
  objects from trusted task state.
- **Broker** — the sole authority behind `Broker.authorize(payment)`; the
  only component that constructs and signs a real payment.
- **Sandbox attestation** — **optional, off by default** (see "Sandbox
  attestation: what is actually enforced" below). When
  `ATTESTATION_ENABLED=true`, it authenticates the channel to the Broker
  via challenge-response before any individual payment is authorized. In
  the as-shipped and as-demoed default state, this control is not active
  — treat this entry as aspirational, not enforced, unless that flag is
  set.
- **Payment facilitator** (partially — see "explicitly out of scope" below).
- **Settlement network**.

## Adversarial

- Arbitrary web content.
- Tool outputs.
- Documents.
- The agent's own reasoning.

Nothing in this list is assumed benign. The entire design exists because any
of these can carry an instruction, directly or through a manipulated
context, that the agent will act on — whether from a deliberate prompt
injection, a hallucination, or ordinary flawed reasoning. The guarantee does
not depend on distinguishing these causes from one another.

## Sandbox attestation: what is actually enforced

The "Sandbox attestation" entry in the Trusted list above is conditional,
and this section states the condition plainly rather than leaving a reader
to infer it.

The channel handshake is **implemented** (task 2.3): the sandbox proves
live possession of its ephemeral Ed25519 identity to the Broker via
challenge-response, and the Broker rejects `/issue` and `/pay` for a
session that has not done so. See `PROTOCOL.md` §5.

It is **gated off by default** (`ATTESTATION_ENABLED`, unset or `false`),
and **off is the as-shipped and as-demoed configuration**. In that
default state:

- The Broker accepts the `session` value a caller supplies without
  requiring any proof that the caller holds the corresponding private
  key. Nothing about a `session` value is cryptographically verified.
- Consequently, the trust placed in "Sandbox attestation" above is, by
  default, **assumed rather than enforced**. Treat it as a documented
  limitation, not an active control, unless the deployment sets
  `ATTESTATION_ENABLED=true`.

What this does **not** change, in either state: the 9 invariant clauses in
[`SECURITY_INVARIANT.md`](./SECURITY_INVARIANT.md), which are what
`Broker.authorize(payment)` enforces and which are unaffected by
attestation being on or off. Clause 5 (`payment.session ==
capability.session`) is plain field equality in both cases; it ties a
capability to the session it was issued for, and never claimed to prove
who is presenting that session.

Even fully enabled, attestation does not defend against a **compromised
sandbox** (excluded below): such a sandbox can generate its own keypair
and attest with it legitimately. What it prevents is a third party
presenting a `session` value it cannot prove live possession of.

## Explicitly out of scope

- A **compromised issuer**.
- A **compromised sandbox**.
- A **compromised facilitator** altering settlement parameters after the
  Broker's signature.
- A **legitimately-vetted resource that later turns malicious**.

## Escalation is not one of the Broker's invariant clauses

Escalation — pausing and routing to human review when an agent attempts to
reference an out-of-registry/unlisted resource (the demo's Moment C) — is a
design decision at the agent/sandbox layer, not one of the 9 clauses in
[`SECURITY_INVARIANT.md`](./SECURITY_INVARIANT.md)'s `Broker.authorize(payment)`
invariant. The Broker's formal invariant has no `ESCALATED` state: its
clauses are a flat hard-fail conjunction, consistent with the payment state
machine's `ISSUED -> RESERVED -> SUBMITTED -> SETTLED`/`RECOVERABLE`/`FAILED`
structure (see `CAPABILITY_SPEC.md`) — every clause either holds or it
doesn't, and a failing clause hard-fails the payment, full stop. If an
out-of-registry resource request ever reached `Broker.authorize` anyway, it
would simply fail the resource-mismatch clause, not escalate.

Escalation sits above that boundary: it's a UX/product behavior for
out-of-scope requests, giving the system a designed "pause and ask" option
before an attempt ever reaches the Broker — not a weakening of the invariant
itself, and not a third outcome the invariant needs to formally represent.

## Sandbox network isolation: scope

The sandbox enforces a default-deny outbound policy with explicit allowances
for the Broker channel, DNS, loopback, and standard web ports (80/443) to
arbitrary hosts — arbitrary outbound reads are an intentional capability,
required so the agent can process untrusted web content (see the
prompt-injection attack scenarios, tasks 2.6-2.8).

On top of this baseline, the policy explicitly blocks the Docker host
gateway and a set of named, demo-enumerated payment-infrastructure
endpoints. This demonstrates that a compromised agent cannot reach a known
payment channel outside the Broker, even while it retains normal web-read
capability.

**Scope limitation:** this policy does not attempt to classify or block
arbitrary, previously-unknown payment infrastructure at the network layer.
Distinguishing "arbitrary untrusted content" from "arbitrary payment API" by
host/port alone is not generally solvable without deeper application-layer
inspection (e.g. a content-aware proxy), which is out of scope for this
build. The security guarantee this project makes does not depend on network
isolation catching unknown payment endpoints — it depends on the payment
tool itself having no fields for an attacker to redirect (see
`SECURITY_INVARIANT.md`). Network isolation is defense-in-depth on top of
that, not the primary guarantee.

## Why naming these exclusions is a strength, not a weakness

Naming these isn't a weakness — it's what makes everything inside the
boundary credible. A security boundary that claims to cover everything,
including the compromise of its own trusted components, isn't a stronger
guarantee; it's an unfalsifiable one, and unfalsifiable claims don't survive
scrutiny. By stating precisely which components are trusted, which inputs
are adversarial, and which failure modes are explicitly excluded, the
invariant in `SECURITY_INVARIANT.md` becomes a claim that can actually be
checked, attacked, and defended — rather than a vague assurance that
collapses the moment someone points at a scenario it never accounted for.
