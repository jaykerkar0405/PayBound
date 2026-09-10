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
- [Running It Locally](#running-it-locally)
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

The sandbox has its own attested workload identity, established before the agent is exposed to any untrusted content. That identity authenticates the channel to the broker when the attestation handshake is enabled; it does not, by itself, authorize any individual payment. Only a valid capability does that. The handshake is implemented (`ATTESTATION_ENABLED`, see [`docs/PROTOCOL.md`](./docs/PROTOCOL.md) §5) but **off by default**, including in the demo configuration — with it off, the broker accepts the `session` value a caller supplies without verifying possession of the corresponding key. The nine invariant clauses below are unaffected either way.

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

**Trusted:** the task definer (which states a closed resource set before untrusted content is read), the resource registry, the capability issuer, the broker, sandbox attestation (implemented but off by default — see [`THREAT_MODEL.md`](./docs/THREAT_MODEL.md) "Sandbox attestation: what is actually enforced"), the payment facilitator (partially, see below), and the settlement network.

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

## Running It Locally

Prerequisites: Node `>=24`, `pnpm@11.3.0` (see `package.json#packageManager`), and Docker (used by the sandbox's own container and by Speculos, below).

```bash
pnpm install
pnpm build
```

### Broker (`apps/broker`)

Copy `apps/broker/.env.example` to `.env.local` (or export the same variables) and adjust as needed. The most important one: `LEDGER_SIGNING_ENABLED` defaults to `true`, which routes every payment through the real Ledger-backed signer (`@paybound/ledger-signer`) against [Speculos](https://github.com/LedgerHQ/speculos), Ledger's device emulator — there is no physical Ledger in this project. Start Speculos first, in its own terminal (the wrapper script needs a TTY):

```bash
packages/ledger-signer/speculos/start.sh
```

Then, in another terminal:

```bash
pnpm --filter broker dev   # or: pnpm --filter broker build && pnpm --filter broker start
```

`GET /health` and `POST /pay` are the only two HTTP routes. **There is currently no HTTP route or CLI to seed the resource registry, create a task budget, or issue a capability** — `seedRegistry`/`createTask`/`issueCapability` (`apps/broker/src/registry.ts`, `budget.ts`, `issuer.ts`) are only ever invoked from the test suite today. To drive `/pay` manually, call those functions yourself from a one-off script pointed at the broker's `DB_PATH`, or read `apps/broker/src/__tests__/pay-route.test.ts` for a worked example.

Without a running Speculos instance (and with `LEDGER_SIGNING_ENABLED` left at its default `true`), both `pnpm --filter broker test` and any real `POST /pay` call will fail — the test suite fails fast with an explicit error; a live `/pay` call instead hangs until the signer's own timeout and then returns a 500. Set `LEDGER_SIGNING_ENABLED=false` to fall back to the Phase 1 stub signer if you don't need real signing.

### Sandbox (`apps/sandbox`)

Copy `apps/sandbox/.env.example` to `.env.local`. `BROKER_HOST` defaults to `host.docker.internal`, which only resolves when the sandbox runs inside its own Docker container (`apps/sandbox/Dockerfile`); point it at `127.0.0.1` (or wherever the broker is listening) when running the sandbox directly on the host.

```bash
pnpm --filter sandbox dev
```

Note: this entrypoint (`apps/sandbox/src/index.ts`'s `main()`) only establishes the sandbox's attested workload identity and logs it — it does not run the agent loop or make any payment. The actual agent loop (`runAgentLoop`/`runSandboxLifecycle` in `apps/sandbox/src/agent.ts`) is currently exercised only by the test suite and by `apps/sandbox/demo/network-boundary-demo.sh` (which demonstrates the network egress boundary, not a payment). To containerize and run the sandbox's egress isolation live, see that script and `apps/sandbox/Dockerfile`.

### Demo dashboard (`apps/demo`)

```bash
pnpm --filter demo dev
```

This is currently the unmodified SvelteKit scaffold — it does not yet render anything PayBound-specific or talk to the broker. Wiring it up is tracked as Phase 6 in `docs/TASKS.md`.

## Project Status

PayBound is **functionally complete** across all six implementation phases and has been verified end-to-end against a live running broker, real Hedera testnet settlement, and real HCS audit topics. The submission deadline is **September 13, 2026**.

### Phase completion

| Phase | Description | Status |
|---|---|---|
| **0** | Specification (THREAT_MODEL, SECURITY_INVARIANT, CAPABILITY_SPEC, ARCHITECTURE, PROTOCOL) | ✅ Complete |
| **1** | Broker & Capability Core (issuer, state machine, `authorize`, `POST /pay`, `POST /issue`, property tests) | ✅ Complete |
| **2** | Sandbox, Agent & Attack Scenarios (egress isolation, agent loop, 3 attack scenarios, network boundary demo) | ✅ Complete |
| **3** | Key Management / Ledger Integration (Speculos-backed signing; real hardware deferred) | ✅ Complete\* |
| **4** | Settlement & Audit Trail (Hedera testnet settlement, HCS audit trail, SUBMITTED→SETTLED/FAILED reconciliation) | ✅ Complete |
| **5** | Chainlink CRE confidential policy check (design + optional gated integration) | ✅ Complete |
| **6** | End-to-end integration & demo (`pnpm e2e:live`, real LLM provider, live agent entrypoint) | ✅ Core complete |

\* Ledger signing is backed by the [Speculos](https://github.com/LedgerHQ/speculos) hardware emulator running the real `app-hedera.elf` binary — not a physical device. The emulator produces identical on-device confirmations and is the configuration used for all live verification runs.

### What is verifiably working

- **`POST /issue`** — capability issuance: validates resource + price, atomically creates the task budget, fires an HCS audit event, and returns a signed `{ capabilityId, expiry }`. Optional Chainlink CRE spend-cap check gated behind `CRE_ENABLED`.
- **`POST /pay`** — payment execution: enforces all 9 invariant clauses from `SECURITY_INVARIANT.md` (replay protection, nonce burn, field matching, budget check, destination immutability), submits to Hedera testnet, persists settlement state.
- **`SUBMITTED → SETTLED/FAILED` reconciliation** — two-stage lookup (consensus-node receipt → mirror-node REST fallback) with `hedera_transaction_id` persisted for startup sweep recovery after broker crash.
- **HCS audit trail** — every capability issuance, authorization decision, and settlement outcome is logged as a Hedera Consensus Service message on topics `0.0.10423726` / `0.0.10423727`, independently verifiable on [HashScan](https://hashscan.io/testnet).
- **Sandbox egress isolation** — Docker-based network policy blocks all routes to payment infrastructure (wallet, RPC, facilitator) except the single authenticated broker channel. Demonstrated live by `apps/sandbox/demo/network-boundary-demo.sh`.
- **Attack scenario tests** — three adversarial scenarios (prompt injection targeting destination/amount, direct payment infra bypass, capability replay/reuse) all fail structurally, not by detection.
- **Attestation handshake** — `POST /attest/challenge` + `POST /attest/verify` implemented in broker and sandbox (`ATTESTATION_ENABLED` flag; **off by default** in the demo configuration — the 9 invariant clauses hold regardless).
- **`pnpm e2e:live`** — one command runs the full path: task definition → `POST /issue` → real LLM agent run with untrusted content → `POST /pay` → Hedera settlement → HCS log. Requires real `.env` credentials.

### What is not yet complete

- **6.2** — End-to-end walkthrough doc
- **6.3** — Live demo script/recording
- **6.5** — Final integrated property test pass
- **6.6** — Submission packaging
- **3.1** — Real Ledger hardware (Speculos emulator used throughout)

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
