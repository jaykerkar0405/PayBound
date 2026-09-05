# PayBound

**Capability-based payment isolation for autonomous AI agents.**

PayBound separates an agent's reasoning from its financial authority. An agent that reads untrusted content, such as webpages, documents, or tool output, never holds a signing key and never sees a destination or amount. It can only invoke a single opaque capability reference. A trusted broker constructs and authorizes every payment before any untrusted content is ever read.

> The agent can believe a malicious instruction. It still can't spend the money.

---

## Table of Contents

- [Motivation](#motivation)
- [Design Principle](#design-principle)
- [How It Works](#how-it-works)
  - [The Capability Object](#the-capability-object)
  - [Payment State Machine](#payment-state-machine)
  - [Signing Model](#signing-model)
  - [Network Boundary](#network-boundary)
- [Security Model](#security-model)
  - [Formal Invariant](#formal-invariant)
  - [Trust Boundary](#trust-boundary)
- [Architecture](#architecture)
- [Project Status](#project-status)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Motivation

Autonomous agents can now settle payments directly. Protocols like x402 clear transactions in under two seconds for fractions of a cent. Settlement is a solved problem. **Authorization is not.**

An attacker no longer needs to steal a private key. They only need to get text into an agent's context that the agent will act on. Several real-world incidents, including exploits against Bankr, Kelp DAO/Drift Protocol, and Step Finance, follow an identical pattern: the same context window that lets an agent reason about the world also authorizes its payments. Whoever controls what the agent reads effectively controls what it can pay for.

This isn't a problem unique to prompt injection. A hallucinated instruction, a manipulated tool response, or ordinary flawed reasoning can trigger the same failure. The underlying issue is structural:

> Reasoning and financial authority currently live in the same trust domain. They should never share a trust domain, regardless of why the reasoning went wrong.

## Design Principle

Rather than building a smarter filter to detect malicious payment requests, PayBound removes the vocabulary needed to express one.

Every task is split into two domains that never share context:

- **Trusted domain**: defines what is allowed, before any untrusted content is read.
- **Adversarial domain**: the agent's normal, messy work, such as reading pages, parsing documents, and calling tools. This domain holds only an opaque capability reference. Its payment tool accepts exactly one parameter; there is no `destination` field and no `amount` field for untrusted text to populate.

## How It Works

### The Capability Object

A capability is an unforgeable, single-use grant of exactly one payment, issued by a trusted broker before the agent touches any untrusted input.

```text
Capability {
  task_hash: hash                 // H(canonical task definition)
  resource_id: uuid                // bound to a trusted resource registry entry
  recipient: address               // fixed at vetting time, immutable
  exact_amount: decimal            // exact, not "up to" - no dynamic pricing
  payment_request_hash: hash       // binds what the payment is for
  session: public_key              // sandbox's attested workload identity
  nonce: unique_id                 // burned atomically on use
  expiry: timestamp                // short-lived by default
  max_uses: 1                      // single-use unless explicitly justified
}

Task {
  task_hash: hash
  max_total_spend: decimal
  spent_so_far: decimal            // broker-maintained, atomically updated
}
```

The current design constrains a session to exactly one active capability at a time, which keeps the core invariant simple to state and to verify.

### Payment State Machine

```text
ISSUED -> RESERVED -> SUBMITTED -> SETTLED
              |            |
              v            v
        RECOVERABLE      FAILED
```

Nonce-burning and budget checks happen atomically at `RESERVED`, in a single transaction. There is no gap between checking a constraint and consuming it, and no race between concurrent requests against the same task budget.

### Signing Model

The agent never holds a signing key and never invokes a signing primitive. Its only available action is `pay(capability_id)`. The broker alone constructs the canonical payment request from trusted state and signs it.

This closes off a whole class of attack, namely "inject an instruction telling the agent to sign arbitrary data," because there is no signing capability inside the agent's sandbox to hijack in the first place.

The sandbox has its own attested workload identity, established before the agent is exposed to any untrusted content. That identity authenticates the channel to the broker; it does not, by itself, authorize any individual payment. Only a valid capability does that.

### Network Boundary

```text
Agent
  X --> wallet
  X --> private key
  X --> facilitator
  X --> RPC
  |
  OK
  v
PayBound Broker
  |
  v
wallet
```

The sandbox's egress policy allows the agent to freely read untrusted content, but blocks every outbound route to payment infrastructure except a single authenticated channel to the broker. If any other path from agent to money exists, such as a direct call to a facilitator or an RPC node, the isolation guarantee no longer holds, regardless of what the capability schema says.

## Security Model

### Formal Invariant

```text
Broker.authorize(payment) implies
  payment.amount == capability.exact_amount AND
  payment.destination == capability.recipient AND
  payment.resource == capability.resource_id AND
  payment.task_hash == capability.task_hash AND
  payment.session == capability.session AND
  payment.payment_request_hash == capability.payment_request_hash AND
  capability.nonce is unconsumed AND
  now < capability.expiry AND
  (task.spent_so_far + payment.amount) <= task.max_total_spend
```

Stated precisely: within the trust boundary described below, untrusted agent context cannot cause the broker to authorize a payment that violates these conditions. This is a bounded guarantee, not an absolute one. It holds within the stated trusted computing base (TCB), not beyond it.

### Trust Boundary

**Trusted:** the task definer (which states a closed resource set before untrusted content is read), the resource registry, the capability issuer, the broker, sandbox attestation, the payment facilitator (partially, see below), and the settlement network.

**Adversarial:** arbitrary web content, tool outputs, documents, and the agent's own reasoning.

**Explicitly out of scope:** a compromised issuer, a compromised sandbox, a compromised facilitator that alters settlement parameters after the broker has signed, or a legitimately vetted resource that later turns malicious. These exclusions are stated explicitly because a security boundary is only meaningful when its limits are named.

## Architecture

```text
CORE (required for the security guarantee)
  Capability schema + Broker + Sandbox network isolation

SUPPORTING SERVICES (useful, not load-bearing for the core guarantee)
  Key/signing infrastructure for the broker
  Settlement plus externally verifiable audit evidence
  Optional confidential policy evaluation (relevant if autonomous
    resource discovery is introduced in the future)
  Anomaly / honeytoken detection (a detection property, distinct
    from the core prevention guarantee)
```

Removing any supporting service does not weaken the core guarantee. The capability schema, broker, and sandbox isolation are sufficient on their own.

## Project Status

PayBound is in early development. The specification (capability object, state machine, signing model, and formal invariant) is defined. The reference broker implementation, sandbox isolation, and agent integration are in progress.

## Roadmap

- [ ] `SECURITY_INVARIANT.md`: formal statement of the invariant
- [ ] `THREAT_MODEL.md`: full trusted/adversarial boundary definition
- [ ] `CAPABILITY_SPEC.md`: capability object and state machine reference
- [ ] Property tests against a broker stub covering replay, substitution, escalation, stale nonces, mismatched sessions, mismatched task hashes, concurrent payments, and malformed responses
- [ ] Reference broker implementation
- [ ] Sandbox network isolation layer
- [ ] Reference agent integration
- [ ] End-to-end example and walkthrough

## Contributing

Contributions, issues, and design discussion are welcome. If you're planning a non-trivial change, please open an issue first so it can be discussed against the security invariant before any implementation work begins.

## License

Licensed under the [MIT License](LICENSE).
