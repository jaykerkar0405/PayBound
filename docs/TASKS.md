# PayBound — Task Breakdown

This file breaks the PayBound project into ordered, dependency-sequenced tasks.
Each task is scoped to be completable in a single focused session by one person.
Check items off as they're completed.

Ownership areas (not formal assignment, just where each task naturally falls):
- **[Broker]** — Dev A: Broker / capability core
- **[Sandbox]** — Dev B: sandbox / agent / attack scenarios / Ledger integration
- **[Settlement]** — Dev C: Hedera/HCS / Chainlink CRE / demo

**Submission deadline: Sept 13, 2026.**

---

## Phase 0 — Specification (blocks all implementation)

These formalize what's already described in the README so every later task has
an unambiguous contract to build against. Do these first and in this order.

- [x] **0.1** `THREAT_MODEL.md` — write out the trusted/adversarial boundary from the
      README's Security Model section as a standalone doc: trusted components,
      adversarial inputs, and the explicitly-out-of-scope list. *(Broker)*
- [x] **0.2** `SECURITY_INVARIANT.md` — formalize the `Broker.authorize(payment)`
      invariant from the README, including what "violates" means for each clause
      (replay, substitution, escalation, stale nonce, session mismatch, task_hash
      mismatch, over-budget). Depends on 0.1. *(Broker)*
- [x] **0.3** `CAPABILITY_SPEC.md` — define the exact wire format (JSON schema or
      equivalent) for `Capability` and `Task` objects, field types, encoding of
      hashes, and the state machine transitions (`ISSUED -> RESERVED -> SUBMITTED
      -> SETTLED`, plus `RECOVERABLE`/`FAILED`) with the preconditions/postconditions
      of each transition. Depends on 0.2. *(Broker)*
- [x] **0.3a** `ARCHITECTURE.md` — high-level overview doc (not originally a
      numbered task, but written alongside 0.1-0.3 and worth tracking): the
      problem/core idea condensed, the three-component system mapped onto the
      repo structure, the three-moment demo, and the core-vs-optional
      architecture split. *(Broker)*
- [x] **0.3.1a** Resolve mapping between the 7 originally-named violation
      types and SECURITY_INVARIANT.md's 9 formal clauses. Added 2 new named
      violation types (resource mismatch, request forgery) and reclassified
      escalation as an agent/sandbox-layer behavior rather than a
      `Broker.authorize()` clause. *(Broker)*
- [x] **0.3.1b** Specify the exact triggering conditions for the
      `RECOVERABLE` and `FAILED` payment-state transitions (currently
      unspecified beyond their position in the state-machine diagram in
      CAPABILITY_SPEC.md). Blocks 1.8 — the property tests can't be written
      correctly against undefined transition conditions for these two
      branches. *(Broker)*
- [x] **0.4** Define the Broker↔Agent-sandbox wire protocol: the single `pay(capability_id)`
      call's request/response shape, error codes, and how the sandbox's attested
      workload identity is presented on the channel. See `docs/PROTOCOL.md`.
      Depends on 0.3. *(Broker + Sandbox, joint)*
- [x] **0.5** Decide and document the tech stack per component (language/framework
      for broker service, agent sandbox runtime, resource registry storage,
      capability issuer). One short ADR-style note is enough. *(Broker)*

## Phase 1 — Broker & Capability Core (critical path)

Everything else depends on a working broker, since it's the only thing that
signs payments.

- [ ] **1.1** Scaffold the broker service (project skeleton, config, health check
      endpoint). Depends on 0.5. *(Broker)*
- [ ] **1.2** Implement the resource registry: closed, pre-vetted set of
      `resource_id -> recipient/price` entries, populated before any agent run
      starts. Depends on 1.1. *(Broker)*
- [ ] **1.3** Implement the capability issuer: given a task definition, produces
      a signed `Capability` object per `CAPABILITY_SPEC.md`, with `max_uses=1`
      and short expiry. Depends on 1.2, 0.3. *(Broker)*
- [ ] **1.4** Implement the `Task` budget tracker (`max_total_spend`,
      `spent_so_far`) with atomic increment. Depends on 1.1. *(Broker)*
- [ ] **1.5** Implement the payment state machine (`ISSUED -> RESERVED ->
      SUBMITTED -> SETTLED`, with `RECOVERABLE`/`FAILED` branches) as an atomic
      transaction at the `RESERVED` step (nonce burn + budget check together).
      Depends on 1.3, 1.4. *(Broker)*
- [ ] **1.6** Implement `Broker.authorize(payment)` enforcing every clause of the
      formal invariant from `SECURITY_INVARIANT.md`. Depends on 1.5, 0.2. *(Broker)*
- [ ] **1.7** Implement the `pay(capability_id)` endpoint the agent sandbox calls,
      per the protocol in 0.4: looks up the capability, runs `authorize`,
      constructs and signs the real payment. Depends on 1.6, 0.4. *(Broker)*
- [ ] **1.8** Property tests against the broker (can run against a stub signer
      before 3.x lands): replay, substitution, escalation, stale nonce, session
      mismatch, task_hash mismatch, concurrent double-spend on the same task
      budget, malformed capability_id. Depends on 1.7. *(Broker)*

## Phase 2 — Sandbox, Agent, and Attack Scenarios

Can start scaffolding in parallel with Phase 1 (2.1–2.2), but real integration
needs the broker's `pay()` endpoint (1.7).

- [x] **2.1** Scaffold the agent sandbox runtime (whatever isolation mechanism is
      chosen — container, microVM, etc.) with no network access by default.
      Depends on 0.5. *(Sandbox)*
- [x] **2.2** Implement sandbox network egress policy: allow outbound to
      arbitrary untrusted content (web, docs, tool APIs) but block every route
      to payment infrastructure except the single authenticated Broker channel.
      Depends on 2.1. *(Sandbox)*
- [x] **2.3** Establish the sandbox's attested workload identity, created before
      the agent is exposed to any untrusted content, and wire it into the
      channel handshake defined in 0.4. Depends on 2.2, 0.4. *(Sandbox)*
- [x] **2.4** Implement the agent's payment tool: exactly one parameter
      (`capability_id`), no destination/amount fields, calling the broker's
      `pay()` endpoint from 1.7. Depends on 2.3, 1.7. *(Sandbox)*
- [x] **2.5** Wire up a minimal agent loop (LLM + tool-use) that can read
      untrusted content and invoke the payment tool, with the capability issued
      by the trusted task definer *before* untrusted content is read. Depends
      on 2.4. *(Sandbox)*
- [x] **2.6** Build attack scenario 1: prompt injection attempting to redirect
      payment destination/amount (should fail structurally — no field exists).
      Depends on 2.5. *(Sandbox)*
- [ ] **2.7** Build attack scenario 2: injected instruction attempting to make
      the agent sign/call payment infra directly, bypassing the broker
      (should fail — no signing key, no network path). Depends on 2.2, 2.5. *(Sandbox)*
- [ ] **2.8** Build attack scenario 3: replay/reuse of a previously-used
      capability_id or expired capability (should be rejected by broker's
      `authorize`). Depends on 1.8, 2.5. *(Sandbox)*
- [ ] **2.9** Live demonstration harness for the network boundary claim: show
      the sandbox's egress policy actually blocking direct calls to a
      wallet/facilitator/RPC, not just diagram it. Depends on 2.2. *(Sandbox)*

## Phase 3 — Key Management / Ledger Integration

- [ ] **3.1** Integrate Ledger for broker key management: broker holds/uses a
      Ledger-backed signing key instead of a software key. Depends on 1.7. *(Sandbox, per ownership note)*
- [ ] **3.2** Swap the stub signer used in Phase 1 tests for the real
      Ledger-backed signer and re-run the property test suite (1.8) to confirm
      behavior is unchanged. Depends on 3.1, 1.8. *(Sandbox)*

## Phase 4 — Settlement & Audit Trail (Hedera/HCS)

Independent of Phase 2/3 aside from needing a signed payment object to settle;
can start once 1.7 exists.

- [ ] **4.1** Integrate Hedera settlement: broker submits the signed payment for
      settlement on Hedera. Depends on 1.7. *(Settlement)*
- [ ] **4.2** Integrate HCS (Hedera Consensus Service) for an externally
      verifiable audit trail: log capability issuance, authorization decisions,
      and settlement outcomes as HCS messages. Depends on 4.1. *(Settlement)*
- [ ] **4.3** Update the payment state machine's `SUBMITTED -> SETTLED/FAILED`
      transition to reflect real Hedera settlement results instead of a stub.
      Note (per CAPABILITY_SPEC.md "Triggering conditions for RECOVERABLE and
      FAILED", task 0.3.1b): implementing the `RECOVERABLE` path requires
      querying Hedera by transaction ID for reconciliation, not just retry
      logic — a definitive negative result goes straight to `FAILED`, but an
      unknown outcome (timeout, connection failure, broker crash mid-flight)
      must be reconciled against Hedera before resolving to `SETTLED` or
      `FAILED`. `resolveSubmission(submitted, outcome)` in
      `apps/broker/src/state-machine.ts` (task 1.5) already implements the
      state-transition mapping — this task's job is determining the real
      outcome value (`'settled' | 'failed' | 'unknown'`) via Hedera
      reconciliation and calling `resolveSubmission()` with it, not building
      the state machine itself. Depends on 4.1, 1.5. *(Settlement)*

## Phase 5 — Optional Confidential Policy Check (Chainlink CRE)

Explicitly bounded scope; not load-bearing for the core security guarantee.
Do this only after Phases 1–4 are solid, and treat it as cuttable if time runs short.

- [ ] **5.1** Define the specific policy question Chainlink CRE will evaluate
      confidentially (e.g., a resource-vetting or spend-policy check) and where
      it plugs into the capability issuance flow (1.3). Depends on 1.3. *(Settlement)*
- [ ] **5.2** Integrate the Chainlink CRE confidential policy check as an
      optional pre-check before capability issuance, clearly gated so its
      failure/removal doesn't affect the core invariant. Depends on 5.1. *(Settlement)*

## Phase 6 — Integration, Demo, and Submission

- [ ] **6.1** End-to-end integration: wire Phases 1–4 (and 5 if time permits)
      together into one runnable path — task definition → capability issuance →
      agent run with untrusted content → payment → Hedera settlement + HCS audit
      log. Depends on 2.9, 3.2, 4.3. *(All)*
- [ ] **6.2** Write the end-to-end example and walkthrough doc (README roadmap
      item) covering the full flow from 6.1. Depends on 6.1. *(All)*
- [ ] **6.3** Build the live demo script/recording: legitimate payment succeeds,
      injected attack (2.6/2.7/2.8) visibly fails, network boundary block
      (2.9) is shown live. Depends on 6.1. *(Settlement, with Sandbox support)*
- [ ] **6.4** Update README's Project Status section to reflect actual
      implementation state (do this last, once real progress exists). Depends
      on 6.1. *(Broker)*
- [ ] **6.5** Final pass: re-run full property test suite (1.8) plus attack
      scenarios (2.6–2.8) against the fully integrated system before
      submission. Depends on 6.1. *(All)*
- [ ] **6.6** Prepare and submit final deliverable ahead of the Sept 13, 2026
      deadline. Depends on 6.5. *(All)*
