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
- **Sandbox attestation** — the sandbox's attested workload identity,
  established before the agent is exposed to any untrusted content. It
  authenticates the channel to the Broker; it does not by itself authorize
  any individual payment.
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

## Explicitly out of scope

- A **compromised issuer**.
- A **compromised sandbox**.
- A **compromised facilitator** altering settlement parameters after the
  Broker's signature.
- A **legitimately-vetted resource that later turns malicious**.

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
