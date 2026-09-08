# Protocol — the Broker↔Agent-Sandbox `pay(capability_id)` channel

This document formalizes task 0.4: the single wire call the agent sandbox is
allowed to make toward money — `pay(capability_id)` — and how the sandbox's
attested workload identity is presented on that channel. It is the
authoritative reference for `packages/protocol` (see
[`ARCHITECTURE.md`](./ARCHITECTURE.md) "Mapping onto the repo").

This document was checked directly against `packages/types/src/index.ts` as
it stands today, not against an assumed shape — see the "Corrections against
current code" notes inline below where this doc's requirements didn't
initially match what's actually implemented there.

## 1. Call semantics: synchronous, but not through settlement

`pay(capability_id)` is a **synchronous HTTP call**. The agent's payment
tool call blocks the sandbox until the Broker has:

1. looked up the capability referenced by `capabilityId`,
2. run `Broker.authorize(payment)` (`SECURITY_INVARIANT.md`),
3. on success, reserved it (the atomic nonce-burn + budget-check at
   `RESERVED`, per `CAPABILITY_SPEC.md`), and
4. constructed, signed, and submitted the canonical payment request for
   settlement (the `SUBMITTED` transition, per `CAPABILITY_SPEC.md` — signing
   and submission happen together at this step, not before it).

It does **not** block through full settlement. `SUBMITTED -> SETTLED` /
`RECOVERABLE` / `FAILED` (per `CAPABILITY_SPEC.md`'s "Triggering conditions
for `RECOVERABLE` and `FAILED`") happens asynchronously on the Broker's
side, independent of this call having already returned.

This is deliberate, not an oversight: dispatching a signed transaction to
Hedera is fast; _waiting for network confirmation of it_ is not, and its
latency is outside the Broker's control. The agent's payment tool call
resolves quickly regardless of Hedera settlement latency — the sandbox is
never left blocked on consensus finality. This is also the only model under
which `RECOVERABLE` makes sense as a state at all: `RECOVERABLE` represents
an _unknown_ settlement outcome (timeout, connection failure, no
confirmation received) that can only arise because settlement finality is
inherently decoupled from the request/response cycle that produced
`SUBMITTED` in the first place. If settlement were synchronous, there would
be no such thing as an unknown outcome to reconcile — every call would
resolve directly to `SETTLED` or `FAILED`.

## 2. Request shape

Reuse [`PayRequest`](../packages/types/src/index.ts) from `packages/types`,
unmodified:

```ts
interface PayRequest {
  readonly capabilityId: CapabilityId; // opaque, branded — see CAPABILITY_SPEC.md / OPEN_QUESTIONS.md
}
```

Exactly one field, per the design principle stated in `ARCHITECTURE.md` and
the README: the payment tool "has exactly one parameter... no `destination`
field, no `amount` field — nothing free text can populate." `capabilityId`
is the sandbox-facing opaque lookup handle, distinct from `Capability.nonce`
(see `docs/OPEN_QUESTIONS.md` "Resolved: capability_id vs. nonce").

## 3. Response shape — success

Reuse [`PayResponse`](../packages/types/src/index.ts) from `packages/types`,
unmodified:

```ts
interface PayResponse {
  readonly state: PaymentState;
}
```

On success, `state` is a `SubmittedPaymentState` — **not** a
`ReservedPaymentState`, and not an `IssuedPaymentState` transitioning live
during the call.

**Corrections against current code:** an earlier draft of this section
assumed the call's synchronous response would carry a `ReservedPaymentState`
(reasoning that the call blocks "through... reservation... signing," and
treating reservation and signing as separate stopping points). That doesn't
match `CAPABILITY_SPEC.md`'s actual definition: signing is not a separate
transition — it happens _as part of_ the `RESERVED -> SUBMITTED` transition
("the Broker has constructed and signed the canonical payment request and
submitted it for settlement"). Since §1 above establishes that this call
blocks through signing, it necessarily blocks through the transition into
`SUBMITTED`, and that is the state the response actually carries. This was
checked directly against `packages/types`' `SubmittedPaymentState` /
`ReservedPaymentState` definitions (`packages/types/src/index.ts`), which
confirm `SubmittedPaymentState` nests `reservedFrom: ReservedPaymentState`
(which itself nests `issuedFrom: IssuedPaymentState`) — so the full
`ISSUED -> RESERVED -> SUBMITTED` history is present in the single
`SubmittedPaymentState` value returned, not lost by only returning the
latest state.

## 4. Response shape — authorization failure

If `Broker.authorize(payment)` rejects the payment (`SECURITY_INVARIANT.md`),
the response reports the specific clause that failed, using
`AuthorizationFailureReason` from `packages/types`.

The 9 values match `SECURITY_INVARIANT.md`'s resolved clause names (task
0.3.1a) exactly:

```
AMOUNT_MISMATCH
SUBSTITUTION
RESOURCE_MISMATCH
TASK_HASH_MISMATCH
SESSION_MISMATCH
REQUEST_FORGERY
REPLAY
STALE_NONCE
BUDGET_EXCEEDED
```

This response shape is:

```ts
{
  authorized: false;
  reason: AuthorizationFailureReason; // one of the 9 values above
}
```

(`AuthorizationResult` in `packages/types` — not `PayResponse`, since a
rejected payment never reaches a `PaymentState` at all; there is no
capability-consuming state to report.)

**This granularity is a deliberate design choice**, not an accident of
implementation convenience:

- It supports precise property testing (task 1.8): a test asserting "a
  substituted destination is rejected" can assert on
  `reason === "SUBSTITUTION"` specifically, rather than a generic
  `"denied"` that could pass even if the Broker rejected the payment for
  the wrong reason.
- Surfacing the specific failed clause on the wire strengthens the
  project's core claim of formal precision (`SECURITY_INVARIANT.md`,
  `THREAT_MODEL.md`): the invariant is a named, checkable conjunction, not
  a black box, and the wire protocol should not flatten that back into an
  opaque yes/no.

**Open design question, deliberately deferred (not decided here):** whether
this detailed reason is fed back into the agent's own LLM-visible tool-call
result, versus only being used for logging/audit purposes (e.g. an HCS
entry), is a separate decision for Phase 2 (sandbox/agent loop
implementation, tasks 2.4–2.5) to make. There are real arguments either way
(precise feedback could help a legitimate retry; but a rejected agent
learning _why_ — "wrong destination" vs. "wrong resource" — could also hand
an adversarial context a diagnostic signal about what the Broker is
checking). This document only specifies what the Broker returns on the
wire; what the sandbox does with it before it (if at all) reaches the
agent's context is out of scope here.

## 5. Attested workload identity

Per `THREAT_MODEL.md` ("Sandbox attestation") and `SECURITY_INVARIANT.md`
(clause 5, session mismatch), the sandbox's attested workload identity
authenticates the **channel** to the Broker — it does not, by itself,
authorize any individual payment. Only a valid capability does that
(`capability.session` is checked against `payment.session`, but that
equality check is one of the 9 invariant clauses, not a substitute for
`Broker.authorize` as a whole).

The channel handshake implements two concrete requirements (resolved in task 2.3):

1. **Identity** — which sandbox workload this is, matching the `session`
   (`PublicKey`, per `packages/types`) that will be embedded in any
   capability issued for it.
   - _Mechanism:_ At sandbox startup, prior to reading any untrusted content,
     the sandbox generates an ephemeral Ed25519 keypair in memory. The public
     key (SPKI DER format, hex-encoded) is exported as the `session` / `PublicKey`
     value. The private key remains strictly in-memory only (never logged or
     persisted to disk).
2. **Freshness / non-replay of the attestation itself** — proof that this
   is a live presentation of that identity, established before the agent
   was exposed to any untrusted content (per `THREAT_MODEL.md`), not a
   replayed attestation artifact from a previous or different session.
   - _Mechanism:_ Challenge-response handshake. The Broker (or verifier) issues
     a single-use, high-entropy random challenge string. The sandbox signs the
     challenge with its in-memory Ed25519 private key and returns the proof
     `{ publicKey, challenge, signature }`. The Broker verifies the signature
     against `publicKey` and confirms that `challenge` matches the issued
     nonce, proving live possession and preventing replay.

## 6. Error handling for malformed or unresolvable requests

The response shapes in §3–4 both assume the Broker found a real capability
and ran `Broker.authorize` against it. That is a different situation from a
request that never gets that far — the two are handled differently:

- **Malformed `capabilityId`** (wrong shape — fails the branded
  `CapabilityId` schema in `packages/types`): **`400 Bad Request`**. This is
  the natural behavior of a `@hono/zod-validator`-wired route (see
  `docs/TECH_STACK_ADR.md` "Broker service") — a request body that fails
  schema validation never reaches the handler at all, so it never has the
  chance to run `Broker.authorize`. Body shape:

  ```json
  { "error": "invalid_capability_id", "message": "..." }
  ```

- **Well-formed but unknown `capabilityId`** (valid shape, but no matching
  capability exists in the Broker's records — e.g. already consumed and
  since garbage-collected, never issued, or simply wrong): **`404 Not
Found`**. Body shape:

  ```json
  { "error": "capability_not_found", "capabilityId": "..." }
  ```

- **A real, found capability that fails `Broker.authorize`**: **`200 OK`**,
  body per §4 above (`{ "authorized": false, "reason": "..." }`).

**Why the split, and why 200 for a genuine authorization failure:** a
malformed or unresolvable request never reached the point of being _a
decision about a real payment_ — there was nothing valid to decide on, so
it's a protocol-level error (4xx), consistent with Hono/HTTP convention
(the request itself was invalid, or its target doesn't exist). A rejected
authorization is different: the request was well-formed, the capability was
real, and the Broker made an actual, deliberate business decision about it
— it evaluated the invariant and it didn't hold. That's not a broken
request; it's a correct and expected outcome of a working system (per
`ARCHITECTURE.md`'s Moment B — a hard-fail is success, not error, from the
system's point of view). Collapsing that into a 4xx would blur the
distinction between "this request was invalid" and "this request was valid
and the answer is no," which matters for exactly the property-testing and
formal-precision reasons given in §4.

## Open questions raised by this document

One genuinely undecided item surfaced while writing this document and is
tracked in `docs/OPEN_QUESTIONS.md` rather than resolved by assumption here:

- The specific attestation mechanism for the channel handshake (§5).
