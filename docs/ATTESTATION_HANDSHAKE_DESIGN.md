# Attestation Handshake Design (task 2.3 follow-up)

**Status: design only, not implemented.** This document answers the 5
design questions posed for closing the gap identified in the attestation
overclaim investigation: `apps/sandbox/src/attestation.ts` has real, tested
Ed25519 sign/verify primitives, but nothing in `apps/broker` issues a
challenge, verifies a signature, or ties a verified attestation to
anything. `docs/PROTOCOL.md` §5, `docs/THREAT_MODEL.md`, `README.md`, and
`docs/OPEN_QUESTIONS.md` all currently describe this handshake as
implemented/resolved; it is not. This document does not correct those
docs — that's implementation-time work, listed in the blast radius below.

## What PROTOCOL.md §5 actually specifies, and what it leaves open

Read in full before writing this design. §5 specifies, precisely:

- **What is being proven:** (1) Identity — which sandbox workload this is,
  matching the `session`/`PublicKey` that gets embedded in any capability
  issued for it; (2) Freshness/non-replay — live possession of that
  identity's private key, not a replayed artifact.
- **The mechanism:** challenge-response. "The Broker (or verifier) issues
  a single-use, high-entropy random challenge string. The sandbox signs
  the challenge with its in-memory Ed25519 private key and returns the
  proof `{ publicKey, challenge, signature }`. The Broker verifies the
  signature against `publicKey` and confirms that `challenge` matches the
  issued nonce."
- **What it is not:** "it does not, by itself, authorize any individual
  payment. Only a valid capability does that" — and clause 5's
  `payment.session == capability.session` equality check "is one of the 9
  invariant clauses, not a substitute for `Broker.authorize` as a whole."

§5 does **not** specify: the actual wire endpoint(s), when in the
sandbox's lifecycle the handshake happens relative to `/issue`/`/pay`,
how long a successful attestation remains valid, or where the Broker
keeps the state needed to verify a proof against the challenge it issued.
These are exactly the gaps this document fills. Nothing in §5 is
impossible to implement as written — the mechanism it describes
(challenge-response over Ed25519) is exactly what
`apps/sandbox/src/attestation.ts` already implements on the sandbox side;
this design only adds the Broker side and the wire-level plumbing between
them.

## 1. Handshake lifecycle

**New, dedicated endpoints, called once per sandbox process lifetime —
not embedded in `/issue` or `/pay`.**

A challenge-response handshake inherently needs two round trips (the
Broker must generate and hand back a challenge before the sandbox can
sign it), so it cannot be collapsed into a single call. Two new routes,
mounted alongside `/issue` and `/pay`:

- **`POST /attest/challenge`** — body `{ publicKey }`. The Broker
  generates a single-use, high-entropy random challenge (e.g.
  `randomBytes(32).toString("hex")`), records it against `publicKey` with
  a short expiry (proposed: 60 seconds — just long enough to sign and
  respond; see §2), and returns `{ challenge, expiresAt }`.
- **`POST /attest/verify`** — body `{ publicKey, challenge, signature }`
  (exactly `AttestationProof`'s shape). The Broker looks up the pending
  challenge for `publicKey`, confirms it matches and hasn't expired, then
  calls `verifyAttestationProof(proof, storedChallenge)`. On success, it
  records `publicKey` as attested for a longer TTL (proposed: 30 minutes;
  see §2) and returns `{ attested: true, expiresAt }`. On failure, `401`
  with a structured error (see §3).

**Why not embed this in `/issue`:** `/issue`'s request shape
(`issueRequestSchema`) is a fixed, already-audited 5-field contract with
its own 118 passing tests. Session/PROTOCOL.md's own §2 states the payment
tool's "exactly one parameter" principle applies to `/pay`; `/issue`
doesn't carry that exact constraint but is still a stable, tested shape
that a two-step embedded challenge would force into an awkward
multi-round-trip contract (first call returns a challenge instead of a
capability, second call needs new fields for the proof). A separate
channel-establishment step keeps `/issue`'s and `/pay`'s wire shapes
completely unchanged, which matters given how much already depends on
them (see §5).

**Where this plugs into the sandbox's lifecycle:** `runSandboxLifecycle`
(`apps/sandbox/src/agent.ts`) currently does: Step 1 (establish
attestation identity) → Step 2 (issue capability) → Step 3 (agent loop).
This adds a new Step 1.5 between them: perform the handshake (call
`/attest/challenge`, sign, call `/attest/verify`) using the identity from
Step 1, before Step 2 ever calls `/issue`. This matches PROTOCOL.md's own
framing — the identity is established "prior to reading any untrusted
content," and the handshake proves its freshness before the channel is
used for anything.

## 2. Where verified attestation is stored

**In-memory only, in the Broker process — not persisted to SQLite.
Two separate maps, two different TTLs.**

This is the biggest decision, so the reasoning in full:

**Re-attesting on every `/issue`/`/pay` call was rejected.** It would
require adding a proof field to `payRequestSchema`/`issueRequestSchema`,
directly violating the "exactly one parameter, `capabilityId`" principle
that's stated in `ARCHITECTURE.md`, the README, and `PROTOCOL.md` §2, and
already backed by dozens of tests asserting the wire shape is exactly
`{ capabilityId }`. Ruled out.

**A session-level, server-side record was chosen instead.** A successful
handshake marks `publicKey` (== `session`) as attested for a bounded
window. `/issue` and `/pay` then check "is this request's session
currently within an attested window?" against that record — a lookup, not
a new request field, so `/issue`'s and `/pay`'s existing wire shapes don't
change at all.

**Storage: in-memory `Map`, not the SQLite DB.** Two reasons:
1. Semantic fit — attestation proves *current, live* possession of a
   private key, not a durable fact worth persisting across a Broker
   restart. If the Broker restarts, requiring the sandbox to re-attest
   (cheap: one local crypto verify, no external calls) is the *correct*
   behavior, not a gap to route around. This is different from
   `payment_submissions`/`tasks`/`capabilities`, which are persisted
   because they represent money that must survive a crash
   (`docs/CAPABILITY_SPEC.md`'s `RECOVERABLE` state exists specifically
   for that).
2. Blast radius — zero new DB tables, zero migrations, zero changes to
   `db.ts`.

**Two maps, two TTLs, both in a new `apps/broker/src/attestation.ts`:**
```ts
const pendingChallenges = new Map<string, { challenge: string; issuedAt: number }>();
const verifiedAttestations = new Map<string, { expiresAt: number }>();
```
- `pendingChallenges`: keyed by `publicKey`. Entry created by
  `POST /attest/challenge`, consumed (deleted) by a successful
  `POST /attest/verify`. Proposed expiry: **60 seconds** — matches "the
  sandbox signs and responds" being effectively instantaneous; long
  enough for real latency, short enough that a leaked challenge is
  useless quickly.
- `verifiedAttestations`: keyed by `publicKey`. Entry created by a
  successful `POST /attest/verify`. Proposed expiry: **30 minutes** —
  generous enough to cover one full agent run (tool-calling steps,
  network content-reading delays) without re-attesting mid-task, but
  still bounded, consistent with PROTOCOL.md §5's "freshness" framing.
  Both TTLs configurable via env vars (`ATTESTATION_CHALLENGE_TTL_MS`,
  `ATTESTATION_TTL_MS`), following the project's existing
  environment-configuration convention (`config.ts`).

No cleanup/GC job is proposed for expired entries beyond a lazy
check-on-read (an entry past its expiry is treated as absent, and can be
overwritten by a fresh challenge/attestation) — matches the MVP posture
elsewhere in this codebase (no background sweep exists for anything else
except `sweepRecoverablePayments`, which has a durability reason this
doesn't share). A long-running Broker would leak small map entries over
time; noted as a known, low-severity limitation, not solved here.

## 3. Failure behavior

New, distinct error — **not** folded into `SESSION_MISMATCH` or any of
the 9 `AuthorizationFailureReason` values, which must stay exactly as
audited. This is a protocol-level pre-check failure, the same category as
the existing "malformed capabilityId" (400) / "capability not found"
(404) split in PROTOCOL.md §6 — it means the request never reached the
point of being a decision `Broker.authorize()` makes.

- **`/attest/verify` with an invalid signature, mismatched/expired
  challenge:** `401`, `{ "error": "attestation_failed", "message": "..." }`.
- **`/issue` or `/pay` called with a `session` that has no active,
  verified attestation record** (when `ATTESTATION_ENABLED=true`; see
  §4): `401`, `{ "error": "attestation_required", "message": "..." }`.

Two distinct error codes (`attestation_failed` vs `attestation_required`)
because they're genuinely different situations: the first is "you tried
to attest and failed," the second is "you never tried." Both map to HTTP
`401 Unauthorized` — the channel-identity analog of `SECURITY_INVARIANT.md`'s
own reasoning for keeping protocol-level failures distinct from
`Broker.authorize()` decisions (`200` for a real, decided rejection;
non-200 for a request that never got that far).

**For `/pay` specifically:** `payRequestSchema` carries no `session`
field (only `capabilityId`), so the check happens *after* the existing
`getCapabilityRecord(capabilityId)` lookup (`routes/pay.ts` line 44),
using `record.capability.session` — the session the capability was
originally bound to at issuance, not anything the caller currently
claims. This is a nice side-consistency property: it ties the attestation
check to the same session value clause 5 already checks the payment
against, rather than introducing a second, independent notion of
"session."

## 4. Backward compatibility / gating

**Gate on/off via `ATTESTATION_ENABLED` (default `false`), mirroring the
`CRE_ENABLED` pattern from task 5.2 — but fail-**closed**, not fail-open,
when enabled. These are two independent decisions; justified separately.**

**Why gate it at all (the "on/off" axis):** 118 broker tests and 58
sandbox tests currently pass with zero handshake ever performed. Making
attestation mandatory by default would require reworking all of them
before this could land, which isn't realistic in the time remaining (see
§6). `isSettlementConfigured()`/`CRE_ENABLED` already established the
precedent for exactly this situation in this codebase.

There's a real tension worth naming, not hand-waving: `THREAT_MODEL.md`
and `README.md` list "sandbox attestation" under **Trusted** components
the invariant's boundary depends on — not under `ARCHITECTURE.md`'s
"supporting services, not load-bearing" bucket the way CRE and settlement
are explicitly framed. So defaulting this off is a real scope decision,
not a mechanical copy of the CRE precedent. The justification: even fully
wired, PROTOCOL.md §5 itself states attestation "does not, by itself,
authorize any individual payment" — the 9 invariant clauses (audited,
correct, and *not touched by this design at all* — see §5/below) remain
the load-bearing guarantee regardless of whether attestation is on.
Attestation's actual value-add is narrower than "Trusted" might suggest:
it prevents a *third party* from spoofing/replaying a session value it
never generated — it does **not** defend against a compromised sandbox
(`THREAT_MODEL.md`'s own "Explicitly out of scope" list already excludes
that; a compromised sandbox can just generate its own legitimate keypair
and attest with it). Given that scope, gating it off by default while
`ATTESTATION_ENABLED=false` doesn't weaken the invariant `Broker.authorize()`
actually enforces — it leaves a defense-in-depth channel-identity layer
un-built, which is an honest, statable limitation, not a silent
regression. **This reasoning itself needs to land in `THREAT_MODEL.md`/
`CAPABILITY_SPEC.md` alongside implementation** (see §5), the same way
task 5.2 added a "Chainlink CRE optional policy check" section — this is
also how the overclaim findings from the prior investigation get closed
out, not by walking back the language alone.

**Why fail-*closed* when enabled (the "on, what happens on failure" axis)
— deliberately different from CRE's fail-open:** CRE fails open because
its failure mode is "a third-party gateway is unreachable," and a broken
external dependency shouldn't take `/issue` offline for something
non-load-bearing. Attestation verification has no equivalent external
dependency — it's a local crypto check against the Broker's own in-memory
state, nothing can be "down." The only way it fails is that the caller
genuinely never completed a valid handshake, which is exactly the case
`ATTESTATION_ENABLED=true` exists to block. Fail-open here would make the
flag a no-op.

## 5. Blast radius

**Shared (`packages/`):**
- `packages/protocol/src/attestation.ts` *(new)* — `verifyAttestationProof`
  and the `AttestationProof` shape move here from
  `apps/sandbox/src/attestation.ts`. It's a pure function (no sandbox-only
  state), and `packages/protocol` already has a proper `main`/`types`
  field and build/lint scripts — it's empty today (`export {};`, a
  placeholder comment says it's waiting on exactly this task) but
  otherwise ready. Moving it here is what actually makes
  `ARCHITECTURE.md`'s existing (currently false) claim about this
  package's role true, rather than adding yet another place that
  describes something as done before it is.
- `packages/protocol/src/index.ts` *(modified)* — export from the new file.
- `packages/types/src/index.ts` *(modified)* — new schemas:
  `attestationProofSchema` (mirrors `AttestationProof`), request/response
  shapes for `/attest/challenge` and `/attest/verify`. Same pattern as
  `payRequestSchema`/`issueRequestSchema`.
- `packages/capability-spec/src/index.ts` *(modified)* — re-export the
  new schemas, same pattern as existing ones.

**Broker (`apps/broker`):**
- `apps/broker/src/attestation.ts` *(new)* — the two in-memory maps,
  `issueChallenge()`, `verifyAndRecordAttestation()`, `isAttested()`.
- `apps/broker/src/routes/attest.ts` *(new)* — the two Hono routes.
- `apps/broker/src/index.ts` *(modified)* — mount `/attest`, alongside
  `/issue`/`/pay`.
- `apps/broker/src/config.ts` *(modified)* — `attestationEnabled`,
  `attestationTtlMs`, `attestationChallengeTtlMs`, same pattern as
  `creEnabled`/`creGatewayUrl`.
- `apps/broker/src/routes/issue.ts` *(modified)* — new pre-check, first
  thing after body validation (before the existing CRE check).
- `apps/broker/src/routes/pay.ts` *(modified)* — new pre-check, after the
  existing `getCapabilityRecord` lookup (line 44), before `getTask`/`authorize`.
- `apps/broker/package.json` *(modified)* — add
  `"@paybound/protocol": "workspace:*"` (not currently a dependency).
- `apps/broker/src/__tests__/attest-route.test.ts` *(new)* — challenge
  issuance, valid proof succeeds, invalid signature rejected,
  expired/mismatched/reused challenge rejected, `ATTESTATION_ENABLED=false`
  default no-op, `/issue`+`/pay` 401 without attestation when enabled.

**Sandbox (`apps/sandbox`):**
- `apps/sandbox/src/attestation.ts` *(modified)* — remove the local
  `AttestationProof`/`verifyAttestationProof` (import the shared ones from
  `@paybound/protocol` instead, if still needed for the sandbox's own
  tests); keep `generateSandboxAttestation`/`createProof` here — the
  private key must never leave this process.
- `apps/sandbox/src/attest-handshake.ts` *(new)* — sandbox-side caller:
  given a `SandboxAttestation` and the Broker's base URL, calls
  `/attest/challenge` then `/attest/verify`.
- `apps/sandbox/src/agent.ts` *(modified)* — new Step 1.5 in
  `runSandboxLifecycle`, between attestation identity (Step 1) and
  capability issuance (Step 2). Needs its own sub-decision at
  implementation time: always attempt it, or gate it the same way the
  Broker does (only attempt if the sandbox is configured to expect it)?
  Proposed default: attempt it unconditionally but treat a `404`/network
  failure on `/attest/challenge` as "Broker doesn't have this feature
  enabled" and proceed without blocking — mirrors the Broker's own
  fail-open-when-disabled stance and avoids a hard coupling where an
  older/gated Broker breaks every sandbox run. This needs confirmation
  at implementation time, not assumed here.
- `apps/sandbox/package.json` *(modified)* — add
  `"@paybound/protocol": "workspace:*"`.

**Docs (implementation-time, not part of this design doc):**
- `docs/PROTOCOL.md` §5 — add the concrete endpoint/lifecycle/storage
  details this design specifies (currently under-specified, not wrong).
- `docs/THREAT_MODEL.md`, `README.md`, `docs/OPEN_QUESTIONS.md` — correct
  the present-tense "implemented"/"Resolved" language identified in the
  prior investigation to reflect gated, real (once built) status.
- `docs/CAPABILITY_SPEC.md` — new section documenting
  `ATTESTATION_ENABLED`'s gating and non-load-bearing framing, same
  pattern as the existing "Chainlink CRE optional policy check" section.
- `docs/TASKS.md` — 2.3's own checkbox/description needs the "wire it
  into the channel handshake" clause actually true, or re-scoped
  explicitly if this lands partially.

**Explicitly NOT touched:** `apps/broker/src/authorize.ts`,
`apps/broker/src/state-machine.ts`, `packages/types`' `taskSchema`/
`capabilitySchema`/`AuthorizationFailureReason` (the 9 clause names),
`SECURITY_INVARIANT.md`. The attestation check is a route-layer pre-check
in `issue.ts`/`pay.ts`, structurally identical in kind to the existing CRE
check and the task-resource-mismatch check (both already precedent for
"a pre-check before the core flow runs, not a change to the core flow
itself"). **No red flag here** — nothing in this design requires or
implies a change to the 9 invariant clauses or the payment state machine.

## 6. Effort/risk estimate (~2 days remaining)

**Rough size: 0.75–1.5 days** for a working, tested, gated-off-by-default
implementation (challenge/verify routes + storage + `/issue`/`/pay`
pre-checks + sandbox-side caller + new tests), **not** counting the doc
corrections listed above (another 1–2 hours, mechanical once the code
exists).

**Lower-risk parts:** the crypto itself (already built, tested,
unchanged); the storage design (two `Map`s, no new infra); the
`/issue`/`/pay` pre-checks (small, additive, same shape as two precedents
already in the codebase).

**Higher-risk / most likely to eat time:**
- The cross-package move (`apps/sandbox/src/attestation.ts` →
  `packages/protocol`) touches an already-tested file
  (`attestation.test.ts`) and needs both `apps/broker` and `apps/sandbox`
  wired to a new workspace dependency — mechanical, but exactly the kind
  of "add a `main`/`exports` field, add a `workspace:*` dep" work that
  took real back-and-forth in the attack-scenario-3 rewrite (issue #75)
  when a similar cross-package question came up for a different reason.
- The sandbox-side Step 1.5 wiring in `runSandboxLifecycle` needs its own
  fail-open-when-Broker-doesn't-support-it decision (flagged, unresolved
  above) — get this wrong and every sandbox test that doesn't mock the
  new handshake call could start hanging on a real network call instead
  of failing fast.
- `runSandboxLifecycle`'s only existing test (`agent.test.ts`'s ordering
  test) doesn't perform any handshake — it'll need a mock for the new
  Step 1.5 the same way it already mocks `issueCapability`, or the new
  step needs to be itself injectable/overridable for tests, matching the
  existing `issueCapability`/`readContentTool`/`payTool` override
  pattern in `SandboxLifecycleOptions`.

**Recommendation given ~2 days left:** this is buildable, but it's the
kind of thing that looks like "a few hours" and easily becomes a full day
once the cross-package plumbing and the sandbox-side test-injection shape
are actually worked out. Given `ATTESTATION_ENABLED=false` by default
means shipping *nothing* here changes current behavior at all, this is a
reasonable candidate to explicitly scope out of the submission and land
post-deadline if time gets tight elsewhere — unlike the reconciliation
gap (4.3) or the multi-resource-per-task gap, which were real,
demonstrable bugs in things the demo actually exercises, this closes a
documentation-accuracy gap and adds a not-yet-load-bearing layer. The
cheaper, faster alternative already available: just correct the
overclaiming docs (small, low-risk, a few hours) and leave 2.3 as an
honestly-documented known limitation, exactly as `THREAT_MODEL.md` already
does for "compromised sandbox." That's a real option, not just this one.
