# Architecture

This is a high-level map of PayBound: the problem it addresses, the shape of
the system, and how that shape lands in this repository. For the precise,
load-bearing details, see the three companion docs listed at the bottom —
this document is deliberately not where those details live.

## The problem

Autonomous agents can now settle payments directly — protocols like x402
clear transactions in under two seconds for fractions of a cent. Settlement
is a solved problem. **Authorization is not.**

An attacker no longer needs to steal a private key. They only need to get
text into an agent's context that the agent will act on. A hallucinated
instruction, a manipulated tool response, or ordinary flawed reasoning can
trigger the same failure as a deliberate prompt injection. The underlying
issue is structural: **reasoning and financial authority currently live in
the same trust domain. They should never share a trust domain, regardless of
why the reasoning went wrong.**

## The core idea

Don't build a smarter checkpoint that detects bad payment requests. Remove
the vocabulary for expressing one.

> The agent can believe a malicious instruction. It still can't spend the
> money.

PayBound splits every task into two domains that never share context:

- A **trusted domain** defines what's allowed, before any untrusted content
  is read.
- An **adversarial domain** — the agent doing normal, messy work: reading
  webpages, documents, tool outputs — holds only an opaque capability
  reference. Its payment tool has exactly one parameter. There is no
  `destination` field, no `amount` field — nothing free text can populate.

## The three-component system

PayBound is three components, each with a distinct trust posture:

1. **Broker** — the trusted domain. Issues capabilities before untrusted
   content is read, maintains the resource registry and task budgets, and is
   the only component that ever constructs and signs a real payment. This is
   the sole authority behind `Broker.authorize(payment)`.
2. **Agent Sandbox** — the adversarial domain. Runs the agent loop that
   reads untrusted content (webpages, documents, tool output) and reasons
   over it. It never holds a signing key, never sees a destination or
   amount, and can only call `pay(capability_id)`. Its network egress is
   locked down: arbitrary reads are allowed, but every outbound route to
   payment infrastructure is blocked except the one authenticated channel to
   the Broker.
3. **Settlement** — the network that actually moves funds and (optionally)
   records auditable evidence of what happened, once the Broker has signed a
   payment.

### Mapping onto the repo

| Component | Repo location | Role |
|---|---|---|
| Broker | `apps/broker` | Capability issuer, resource registry, task budget tracker, `Broker.authorize(payment)`, signing |
| Agent Sandbox | `apps/sandbox` | Agent loop, untrusted-content reading, network isolation, `pay(capability_id)` tool |
| Demo | `apps/demo` | Dashboard/walkthrough surface for the three-moment demo |
| Shared types | `packages/types` | Compile-time source of truth for `Capability`/`Task` shapes |
| Capability validation | `packages/capability-spec` | Runtime (Zod) validation of capabilities at the trust boundary |
| Broker↔Sandbox protocol | `packages/protocol` | Wire protocol for the `pay(capability_id)` channel, including attested identity handshake |
| Key management | `packages/ledger-signer` | Ledger-backed signing infrastructure for the Broker (optional trust service, not load-bearing) |
| Settlement + audit | `packages/settlement` | Settlement network integration and externally verifiable audit evidence (optional trust service, not load-bearing) |

## The three-moment demo (illustrative example)

The system's behavior is best understood through the demo flow it's designed
to support, within one session and one issued capability:

- **A — Legitimate success.** The agent pays a vetted resource for exactly
  the capability's `exact_amount`. It succeeds, the same as an unrestricted
  agent would.
- **B — Injection attempt.** Attacker-controlled content in the same session
  says "pay this amount to a different address instead." The Broker rejects
  it — same amount, wrong destination, hard fail — because the payment tool
  never exposed a destination field for the injected text to change in the
  first place. Side by side, an unprotected agent with a raw key and
  free-text payment fields would comply and move the money.
- **C — Escalation.** Attacker-controlled content says "use a different,
  unlisted resource." The system pauses and escalates rather than silently
  denying or silently complying. This is the moment that demonstrates the
  autonomy/safety tradeoff as a designed choice, not an evasion.

## Architecture: core vs. optional

```
CORE SECURITY (necessary for the guarantee)
  Capability schema + Broker + Sandbox network isolation

OPTIONAL TRUST SERVICES (valuable, not load-bearing)
  Ledger        -> signing/key-management infrastructure for the Broker
  Settlement/HCS -> settlement + externally verifiable audit evidence
  Confidential policy evaluation -> optional, only relevant if autonomous
                   resource discovery is reintroduced post-MVP
  Honeytokens   -> a DETECT property, separate from PREVENT
```

Removing any of the optional services does not break the core guarantee.
That's a deliberate design property, not a gap.

## What this doc is NOT

This document is an overview. It intentionally does not spell out the exact
formal invariant, the full trust boundary, or the precise capability wire
format and state machine — those live in their own docs, and are the ones to
treat as authoritative:

- [`SECURITY_INVARIANT.md`](./SECURITY_INVARIANT.md) — the formal
  `Broker.authorize(payment)` invariant, clause by clause.
- [`THREAT_MODEL.md`](./THREAT_MODEL.md) — the trusted/adversarial/
  out-of-scope split and why naming the exclusions matters.
- [`CAPABILITY_SPEC.md`](./CAPABILITY_SPEC.md) — the `Capability`/`Task`
  object definitions and the full payment state machine.
