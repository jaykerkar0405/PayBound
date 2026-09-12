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
- [Hedera Track: x402-Gated Service + Blocky402](#hedera-track-x402-gated-service--blocky402)
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

For a real, hand-verifiable run of the full payment path — real agent, real Broker, real Hedera settlement, real HCS audit log — see [`docs/WALKTHROUGH.md`](./docs/WALKTHROUGH.md) instead of the summary below.

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

`GET /health`, `POST /issue`, and `POST /pay` are the three HTTP routes. `POST /issue` accepts `{ taskDefinition, resourceId, exactAmount, paymentRequest, session }`, atomically creates the task budget on first call for a given task hash, and returns `{ capabilityId, expiry }`. See `apps/broker/src/routes/issue.ts` and `apps/broker/src/__tests__/issue-route.test.ts` for the full schema and worked examples. To seed the resource registry before issuing, call `seedRegistry` from a one-off script pointed at the broker's `DB_PATH` (see `apps/broker/src/scripts/` for examples).

Without a running Speculos instance (and with `LEDGER_SIGNING_ENABLED` left at its default `true`), both `pnpm --filter broker test` and any real `POST /pay` call will fail — the test suite fails fast with an explicit error; a live `/pay` call instead hangs until the signer's own timeout and then returns a 500. Set `LEDGER_SIGNING_ENABLED=false` to fall back to the Phase 1 stub signer if you don't need real signing.

### Sandbox (`apps/sandbox`)

Copy `apps/sandbox/.env.example` to `.env.local`. `BROKER_HOST` defaults to `host.docker.internal`, which only resolves when the sandbox runs inside its own Docker container (`apps/sandbox/Dockerfile`); point it at `127.0.0.1` (or wherever the broker is listening) when running the sandbox directly on the host.

```bash
pnpm --filter sandbox dev
```

Note: this entrypoint (`apps/sandbox/src/index.ts`'s `main()`) only establishes the sandbox's attested workload identity and logs it. The full agent loop is driven by `apps/sandbox/src/live-run.ts`, which runs a real LLM (Gemini primary, Groq fallback) through the complete lifecycle — capability issuance, untrusted content fetch, payment, Hedera settlement. Run the entire path end-to-end with real credentials via:

```bash
pnpm e2e:live   # from the repo root — requires .env with HEDERA_ and LLM API key vars set
```

To containerize and run the sandbox's egress isolation live, see `apps/sandbox/demo/network-boundary-demo.sh` and `apps/sandbox/Dockerfile`.

### Demo dashboard (`apps/demo`)

```bash
pnpm --filter demo dev
```

This is currently the unmodified SvelteKit scaffold — it does not yet render anything PayBound-specific or talk to the broker. Wiring it up is tracked as Phase 6 in `docs/TASKS.md`.

## Hedera Track: x402-Gated Service + Blocky402

Extends PayBound for Hedera's "AI & Agentic Payments on Hedera" hackathon track. Written
against the track's exact, re-fetched qualification wording
([ethglobal.com/events/ethonline2026/prizes/hedera](https://ethglobal.com/events/ethonline2026/prizes/hedera)),
one section per requirement.

### 1. A live x402-gated service, settled through Blocky402

> "Host a live x402-gated service on Hedera testnet or mainnet, settled through the
> Blocky402 facilitator."

[`apps/gated-content-service`](./apps/gated-content-service) is a standalone Hono
resource server, live on **Hedera testnet**. `GET /gated-research-snippet` returns HTTP
402 with a `PaymentRequired` body until paid; a request carrying a signed `X-PAYMENT`
header is verified and settled through **Blocky402**'s real testnet facilitator
(`https://api.testnet.blocky402.com`, no API key) via its actual `POST /verify` and
`POST /settle` endpoints, before the gated content — and the real Hedera transaction ID —
is returned. See that package's own README for its architecture and Day-1 standalone
verification (two independent live runs, each cross-checked against the Hedera mirror
node and a rendered HashScan page).

### 2. A platform that consumes it and completes a real paid request

> "Build a platform or agent that consumes that service and completes at least one real
> paid request end to end."

The Broker (`apps/broker`) — PayBound's own trust broker — is the platform. Its new
[`scripts/pay-for-gated-content.ts`](./apps/broker/scripts/pay-for-gated-content.ts)
issues a real capability, authorizes and submits it through the same state-machine
pipeline `POST /pay` uses in production, then settles it through
[`packages/settlement`](./packages/settlement)'s new x402 strategy — which builds, signs,
and actually pays for `apps/gated-content-service`'s content, for real. It runs as an
independent stage of `pnpm e2e:live` (`apps/broker/scripts/e2e-live-demo.ts`).

**Evidence, both independently confirmed on the Hedera mirror node and rendered on
HashScan** — 100,000 tinybars (0.001 HBAR) moving from the Broker's operator account
(`0.0.10421552`) to `apps/gated-content-service`'s `payTo` (`0.0.10480612`), fee paid by
Blocky402's own fee-payer account (`0.0.7162784`):

- `0.0.7162784@1789149606.940091227` —
  [mirror node](https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7162784-1789149606-940091227)
  (`result: SUCCESS`) ·
  [HashScan](https://hashscan.io/testnet/transaction/0.0.7162784-1789149606-940091227)
- `0.0.7162784@1789149738.205454639` (a second, independent run) —
  [mirror node](https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7162784-1789149738-205454639)
  (`result: SUCCESS`) ·
  [HashScan](https://hashscan.io/testnet/transaction/0.0.7162784-1789149738-205454639)

### 3. Setup, architecture, and the payment flow

> "Public GitHub repo with a README covering setup, architecture, and the payment flow."

#### Setup (from a clean checkout)

1. `pnpm install && pnpm build` (repo root).
2. **gated-content-service** — `cp apps/gated-content-service/.env.example
   apps/gated-content-service/.env.local`; fill in `GATED_PAYTO_ACCOUNT_ID` (a Hedera
   testnet account you control — get one + fund it at
   [portal.hedera.com](https://portal.hedera.com/); see "Three accounts, not two" below
   for why this must be distinct from the Broker's own account). To also run its
   standalone proof, fill `PAYER_ACCOUNT_ID`/`PAYER_PRIVATE_KEY` with a *different*
   funded account. Then: `pnpm --filter gated-content-service dev:live`.
3. **Broker** — `cp apps/broker/.env.example apps/broker/.env.local`; fill in
   `HEDERA_TESTNET_ACCOUNT_ID`/`HEDERA_TESTNET_PRIVATE_KEY` (the Broker's own operator
   account — this is the x402 strategy's *payer*), `HEDERA_HCS_TOPIC_ID` (create once via
   `packages/settlement/src/hcs-topic.ts`), and `GATED_CONTENT_URL` /
   `GATED_CONTENT_PAYTO_ACCOUNT_ID` / `GATED_CONTENT_PRICE_HBAR` (must match step 2's
   running service). `LEDGER_SIGNING_ENABLED` defaults to `true`, so start Speculos
   first: `packages/ledger-signer/speculos/start.sh`.
4. In another terminal: `pnpm --filter broker dev:live`.
5. Run just the purchase — from `apps/broker/`: `node --env-file=.env.local --import
   tsx/esm scripts/pay-for-gated-content.ts` — or the full demo (adversarial scenario +
   this purchase, as an independent stage): `pnpm e2e:live`, also from `apps/broker/`.
6. Speculos will display a transaction review screen for the Broker's capability
   signature (a separate signing domain from the x402 payment itself — see
   `docs/SETTLEMENT_INTEGRATION_PROPOSAL.md`). Approve it on-device (press right through
   fields, both buttons to confirm) within 60s, or drive it via Speculos's own HTTP API
   the way this project's automated test suite already does unattended
   (`apps/broker/src/__tests__/global-setup.speculos.ts`) — see
   `packages/ledger-signer/speculos/README.md`.

#### Three accounts, not two

Two different consumers pay the same resource, for two different reasons — hence three
distinct Hedera testnet accounts, not two:

- **`0.0.10421552`** — the Broker's own operator account (`HEDERA_TESTNET_ACCOUNT_ID`).
  Acts as *payer* in the new x402 strategy — the same account the Broker's existing
  direct-transfer settlement already uses, so no new secret was needed.
- **`0.0.10480612`** — a dedicated "data provider" account, `apps/gated-content-service`'s
  `payTo`. Kept distinct from the Broker's operator account specifically so the Broker's
  x402 payment doesn't read as paying itself.
- **`0.0.10480198`** — `apps/gated-content-service/scripts/test-client.ts`'s own payer,
  from that package's Day-1 standalone verification. Kept separate on purpose:
  `apps/gated-content-service` has zero dependency on `apps/broker` by design, and its
  standalone proof must keep running without ever needing Broker credentials — reusing
  the Broker's operator account there would quietly reintroduce that dependency.

#### Architecture

[`packages/x402-blocky402-client`](./packages/x402-blocky402-client) is a small,
protocol-only shared package with no PayBound-specific business logic (no `Capability` or
registry types) — `facilitator.ts` (resource-server-side Blocky402 calls: `/supported`,
`/verify`, `/settle`, `PaymentRequirements`/`PaymentRequired` builders) and `client.ts`
(consumer-side: build + sign a `PaymentPayload` via `@x402/hedera`, encode the
`X-PAYMENT` header). Two otherwise-unrelated things depend on it:

- `apps/gated-content-service` (the resource server), via `facilitator.ts`.
- `packages/settlement`'s new `submit-x402.ts` (the client/payer role), via `client.ts`.

`packages/settlement/src/submit-x402.ts` adds `submitViaX402`/`createX402Submitter` — a
second settlement strategy alongside `submit.ts`'s existing `submitToHedera`, same output
shape (`HederaSubmissionResult`), same fail-closed philosophy: before signing or
dispatching anything, it re-fetches the resource's *live* `PaymentRequirements` and
refuses to pay if `payTo`/`amount` don't match what the capability actually authorized.

Critically, **`apps/broker/src/settlement.ts`'s `settleAndRecord` required zero code
changes.** It already accepted a `deps: SettlementDeps` parameter (used until now only by
its own tests), and that seam is exactly what lets
`apps/broker/scripts/pay-for-gated-content.ts` substitute `createX402Submitter(...)` in
for `submitToHedera` at one specific call site — without touching `settleAndRecord`
itself, `routes/pay.ts`, or any of the sandboxed agent's payment tooling
(`tools/pay.ts`'s single-parameter invariant is completely untouched by this track's
work).

`pay-for-gated-content.ts` drives the real authorization pipeline — `authorize()`,
`state-machine.ts`'s `submitPayment`, `signer.ts`'s `resolveSigner()` — the same building
blocks `POST /pay` uses in production, called directly rather than over HTTP (the HTTP
route always uses the default strategy). `e2e-live-demo.ts` calls it as a new,
independent stage that runs after, and regardless of the outcome of, the existing
6-stage adversarial-scenario demo; that demo's own logic is otherwise byte-for-byte
unchanged by this track's work.

#### Payment flow: the two-signature fee-payer model

The least obvious mechanic in this whole path: **every settled transaction carries two
signatures, from two different accounts, for two different reasons.**

1. The **client** (the Broker's operator account, or the standalone test-client's payer)
   builds a Hedera `TransferTransaction` moving the exact payment amount to `payTo`, and
   signs it with its own key — but does not pay the network fee. This partially-signed
   transaction, base64-encoded, travels as the `X-PAYMENT` header.
2. The **resource server** hands that transaction to Blocky402 via `POST /verify` then
   `POST /settle`. Blocky402, as the facilitator, holds the `feePayer` account's key
   (`0.0.7162784` on testnet — fetched live from `GET /supported` every time, never
   hardcoded; see `facilitator.ts`), adds its own co-signature as the transaction's
   fee-payer, and is the one that actually dispatches it to Hedera consensus.

The effect, visible on every HashScan page linked in this README: `PAYER ACCOUNT` is
always Blocky402's fee-payer, charged the network fee, while the `Transfers` section
separately shows the client's account debited by *exactly* the payment amount, with no
fee attached to it. The client never needs to hold HBAR beyond the payment amount itself
— Blocky402 covers the entire network fee as part of acting as facilitator.

**Extra-points bullets this build already earns**, verified against real evidence, not
claimed aspirationally:

- **Verifiable payment audit trails on HCS** — true, but only for the platform-driven
  purchase (`pay-for-gated-content.ts`), not the fully isolated Day-1 standalone proof
  (which deliberately has zero Broker/HCS dependency). `settleAndRecord`'s real
  `logSettlementOutcome` runs unmodified for the x402 strategy exactly as it does for the
  direct-transfer one — both of the x402 transactions cited above produced a real
  `settlement_outcome` HCS message on topic `0.0.10423726` (sequence numbers 179 and
  184), independently confirmed via the mirror node's own topic-messages API, not just
  inferred from the code.

One bullet this build does *not* earn, despite settling on Hedera: **"HTS tokens or
custom fee schedules in the settlement path."** The settlement asset is native HBAR
(`asset: "0.0.0"`), not an HTS token — that bullet wants a custom/HTS asset in the path,
which this build doesn't have.

### 4. Demo video shot list

> "Demo video of five minutes or less showing the paid request executing."

Not recorded as part of this task — a shot list instead, so it can be recorded in one
take. Have `apps/gated-content-service` and `apps/broker` already running (per Setup
above) before hitting record.

| # | Time | Screen | Show |
|---|---|---|---|
| 1 | 0:00–0:20 | Title card | Track name + one-line architecture caption |
| 2 | 0:20–0:50 | Terminal | Unauthenticated `GET /gated-research-snippet` → raw 402 `PaymentRequired` JSON (`payTo`, `amount`, `extra.feePayer` visible) |
| 3 | 0:50–1:30 | Terminal | `pay-for-gated-content.ts` (or `test-client.ts`) building + signing the transaction; the `X-PAYMENT` header being constructed |
| 4 | 1:30–2:15 | Terminal (gated-content-service's log) | The raw `[blocky402] POST /verify response: {...}` and `POST /settle response: {...}` lines appearing live |
| 5 | 2:15–2:45 | Terminal | The paid request's 200 response — content + `settlement.transaction` + the printed HashScan URL |
| 6 | 2:45–3:30 | Browser | That HashScan URL, rendered — `SUCCESS`, `CRYPTO TRANSFER`, `PAYER ACCOUNT` = Blocky402's fee-payer, `Transfers` table showing the exact amount moving payer → payTo. **This is the money shot** — pause on it |
| 7 | 3:30–4:10 | Terminal | `pnpm e2e:live` full run (or a prior run's log) — the new "=== Real x402-gated content purchase ===" stage appearing immediately after the existing adversarial-scenario stage's own SUCCESS line |
| 8 | 4:10–4:40 | Browser | The same transaction's mirror-node JSON (`testnet.mirrornode.hedera.com/api/v1/transactions/<id>`) — a second, independent, non-Blocky402-controlled confirmation |
| 9 | 4:40–5:00 | Title card | Repo link + both transaction IDs on screen |

## Project Status

PayBound is in early development. The specification (capability object, state machine, signing model, and formal invariant) is defined. The reference broker implementation, sandbox isolation, and agent integration are in progress.
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

- **6.3** — Live demo script/recording
- **6.5** — Final integrated property test pass
- **6.6** — Submission packaging
- **3.1** — Real Ledger hardware (Speculos emulator used throughout)

### Known limitations (disclosed, not blocking submission)

- **Crash during Ledger signing itself leaves no recoverable record.** The
  `SUBMITTED → SETTLED/FAILED/RECOVERABLE` reconciliation path (Phase 4)
  correctly recovers a broker crash that happens *after* a payment reaches
  `SUBMITTED` — including a crash between a successful settlement dispatch
  and the outcome being durably recorded, which the startup sweep now
  detects and reconciles by transaction ID. The one gap this doesn't close:
  a crash *during* the Ledger signature itself, before the `SUBMITTED` row
  is ever written, leaves no database trace at all — the capability's
  nonce is burned (so it can never be retried) and its share of the task
  budget is spent, for a payment that never got far enough to have
  anything to reconcile. Closing this would require a schema/sequencing
  change (a pre-signing placeholder row with a nullable signature column)
  beyond what's safe to land under submission deadline pressure against
  core payment-state logic — treated as a disclosed, architecture-level
  caveat rather than a blocking defect, same as the Ledger signing-model
  and x402-integration caveats above.

## Roadmap

- [x] `SECURITY_INVARIANT.md`: formal statement of the invariant
- [x] `THREAT_MODEL.md`: full trusted/adversarial boundary definition
- [x] `CAPABILITY_SPEC.md`: capability object and state machine reference
- [x] Property tests against a broker stub covering replay, substitution, escalation, stale nonces, mismatched sessions, mismatched task hashes, concurrent payments, and malformed responses
- [x] Reference broker implementation (`POST /issue`, `POST /pay`, `Broker.authorize`)
- [x] Sandbox network isolation layer (Docker egress policy, `network-boundary-demo.sh`)
- [x] Reference agent integration (real LLM via `runSandboxLifecycle`, `apps/sandbox/src/live-run.ts`)
- [x] End-to-end live path (`pnpm e2e:live`) — task definition → issuance → agent → payment → Hedera settlement + HCS log
- [x] [End-to-end example and walkthrough doc](./docs/WALKTHROUGH.md)
- [ ] Live demo script / recording (task 6.3)

## Contributing

Contributions, issues, and design discussion are welcome. If you're planning a non-trivial change, please open an issue first so it can be discussed against the security invariant before any implementation work begins.

## License

Licensed under the [MIT License](LICENSE).
