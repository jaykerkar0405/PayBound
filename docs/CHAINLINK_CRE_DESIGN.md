# Chainlink CRE Integration Design (Task 5.1)

## Policy question

> **Confidentially evaluate whether the requested `exactAmount` for a
> resource falls within a per-resource spending cap defined in a Chainlink
> CRE confidential environment — without revealing that cap to the agent,
> the sandbox, or any other component outside the broker.**

Concretely: before issuing a capability for resource `R` with amount `A`,
the broker asks a Chainlink CRE job: _"Is `A` ≤ the confidential cap for
resource `R`?"_ The CRE job returns `true` or `false`. If `false`, the
broker refuses to issue the capability with a `spend_policy_exceeded` error.
The cap value itself is never transmitted to the broker — only the boolean
verdict is.

### Why this question

PayBound already enforces a per-task total budget (`maxTotalSpend`, task 1.4)
and exact-price matching against the resource registry (task 1.3). What's
missing is a **per-resource spending cap** that:

1. Is **secret from the reasoning layer** — if the agent or the task
   definition could inspect the cap, it could craft requests that trivially
   satisfy it. The cap needs to live in a confidential environment.
2. Augments — but does not replace — the registry's price check. The registry
   enforces _exact_ amounts; the CRE policy enforces a _ceiling_ on what
   amounts can even be set in the registry for a given resource category
   (e.g., "no single API call can cost more than 0.50 HBAR regardless of what
   the registry says").
3. Is a **business policy**, not a cryptographic invariant — it can change
   over time without touching the core broker code or the capability wire
   format.

---

## Integration point

The check plugs into `POST /issue` in
[`apps/broker/src/routes/issue.ts`](../apps/broker/src/routes/issue.ts),
**between schema validation and the `issueCapability()` call** — at line 36,
after `c.req.valid("json")` returns the validated inputs and before
`issueCapability(...)` is called.

```typescript
// apps/broker/src/routes/issue.ts — current (lines 32–45)
(c) => {
  const { taskDefinition, resourceId, exactAmount, paymentRequest, session } =
    c.req.valid("json");              // ← validated inputs available here

  // ▶ CRE check inserted here (see below) ◀

  try {
    const result = issueCapability({ taskDefinition, resourceId,
                                     exactAmount, paymentRequest, session });
    return c.json({ capabilityId: result.capabilityId, expiry: result.expiry }, 200);
  } catch (err) { ... }
}
```

The inserted call looks like:

```typescript
// New function: packages/cre-policy/src/index.ts (task 5.2)
const allowed = await checkSpendPolicy(resourceId, exactAmount);
if (!allowed) {
  return c.json(
    { error: "spend_policy_exceeded",
      message: `Chainlink CRE policy denied issuance for resource ${resourceId}` },
    403,
  );
}
```

This is the **only** place the CRE check appears in the codebase. It does not
touch `issueCapability()` (task 1.3), `Broker.authorize()` (task 1.6), or any
payment-state-machine transition — which is what makes it non-load-bearing (see
below).

---

## Non-load-bearing guarantee

> **Removing the CRE check entirely must not weaken the core security
> guarantee.**

This is structurally true by placement:

1. The CRE check is a **pre-issuance gate**, not part of the authorization
   invariant. `Broker.authorize()` (task 1.6 / `SECURITY_INVARIANT.md`)
   enforces its 9 clauses against the capability's _already-committed fields_
   — field values that are set by `issueCapability()`, which the CRE check
   runs _before_. The invariant's clauses (replay protection, nonce burn,
   field matching, budget check) are all independent of whether a CRE gate
   was evaluated.

2. If `checkSpendPolicy` is deleted or returns `true` unconditionally, the
   only consequence is that capabilities can be issued for amounts that exceed
   the confidential cap. The capability is still correctly signed, the nonce
   still burns on use, the budget still caps total spend, and the payment
   destination is still fixed by the registry. None of the 9 invariant
   clauses are affected.

3. The check is **not replicated** elsewhere — it does not appear in
   `issueCapability()`, `authorize()`, or any state-machine transition.
   Removing it from `issue.ts` removes it entirely; there is no
   hidden dependency.

This matches the explicit note in `docs/TASKS.md` (task 5.1/5.2): _"clearly
gated so its failure/removal doesn't affect the core invariant."_

---

## Chainlink CRE Confidential Workflow design (implemented in task 5.3, issue #98)

The spend-cap check is a real Chainlink CRE Confidential Workflow — not a
conceptual job description deployed outside this repo. It lives in
[`cre-workflow/spend-cap-workflow/workflow.ts`](../cre-workflow/spend-cap-workflow/workflow.ts)
(the confidential-workflow logic itself; `main.ts` alongside it is only the
thin `Runner.newRunner`/`runner.run` entrypoint — see `cre-workflow/README.md`
for why the two are split). `cre-workflow/` lives at the repo root, isolated
from the rest of the monorepo's Node-targeted build pipeline, because CRE
workflows compile to WASM — see `docs/TECH_STACK_ADR.md` (L139-155) for that
rationale.

`initWorkflow` registers `onHttpTrigger` via `cre.handlerInTee` (not
`cre.handler`) on an HTTP trigger — the literal Confidential Workflow prize
requirement. Inside the handler, which runs inside a hardware-isolated TEE:

1. The incoming request is parsed as `{ resourceId, exactAmount }` — the
   exact shape `apps/broker/src/cre-policy.ts` sends (L91-96).
2. `runtime.getSecret({ id: "SPEND_CAPS" })` fetches the spend-caps table
   strictly inside the enclave — the Vault DON releases it only into an
   attested enclave, and it is never logged or exposed outside the handler.
3. A three-tier cap lookup: exact `resourceId` match → the `"default"` key
   → if neither exists, a permissive `{ allowed: true, reason: "No spend
   cap defined for resource" }`.
4. The comparison uses `parseFloat` (a WASM runtime constraint — no
   arbitrary-precision library).
5. The allow/deny decision is logged via `runtime.log()`; the caps table
   itself is never logged.
6. The handler returns `JSON.stringify({ allowed, reason })`, matching
   exactly what `apps/broker/src/cre-policy.ts` (L105-117) parses.

See `cre-workflow/README.md` for setup and the verified `cre workflow
simulate` commands, and `cre-workflow/evidence/simulation-output.txt` for
real, unedited simulation output covering all four cases (ALLOW, DENY,
FALLBACK-DEFAULT, FALLBACK-PERMISSIVE).

### Local end-to-end wiring (evaluated, not usable as-is)

`cre workflow simulate spend-cap-workflow --listen` was evaluated as a way
to point the broker's `CRE_GATEWAY_URL` at a live local endpoint for a real
round-trip test. It isn't suitable for that:

- The workflow's result only appears in the simulator's own terminal log —
  the HTTP response to the trigger request is always `200 OK` with an
  empty body (confirmed via a direct `curl -i`, which showed
  `Content-Length: 0`). `apps/broker/src/cre-policy.ts`'s `response.json()`
  would throw on that empty body, landing in the existing fail-open `catch`
  block (L118-128) — never blocking issuance, but also never reflecting the
  real decision.
- It rate-limits to one execution per 30 seconds.
- Its debug endpoint expects the request wrapped as `{"input": {...}}`, not
  the raw `{ resourceId, exactAmount }` body the broker sends.

This is a property of the local `--listen` debug harness — a manual
trigger-injection tool, not a synchronous request/response gateway matching
the real production CRE HTTP trigger contract — not a defect in
`workflow.ts`. The real logic is already correctly exercised by Phase 3's
non-`--listen` `--http-payload` simulate runs (see
`cre-workflow/evidence/simulation-output.txt`) and by `workflow.ts`'s own
unit tests (`cre-workflow/spend-cap-workflow/main.test.ts`).

---

## Error behaviour (for task 5.2)

| CRE outcome | HTTP response from `POST /issue` | Notes |
|---|---|---|
| `true` (allowed) | Continue to `issueCapability()` | Normal path |
| `false` (denied) | `403 spend_policy_exceeded` | CRE check failed |
| CRE disabled, unconfigured, unreachable, or returns a malformed response | Continue to `issueCapability()` | Fail-open: check is skipped, issuance proceeds |

**Fail-open on CRE errors**: if the check is disabled, `CRE_GATEWAY_URL`
isn't set, the gateway is unreachable, or its response can't be parsed,
`checkSpendPolicy()` returns `{ allowed: true }` and issuance continues
exactly as if the check had never run — the broker never refuses to issue
because of a broken or absent CRE gateway. This is what actually makes the
check "optional and non-load-bearing" per `docs/TASKS.md`: a fail-closed
design would make CRE gateway availability load-bearing for `/issue`
working at all, which is the opposite of the intent. See
`apps/broker/src/cre-policy.ts` and `docs/CAPABILITY_SPEC.md`'s "Chainlink
CRE optional policy check" section for the implementation and the
non-load-bearing guarantee this table's design supports.

---

## What task 5.2 implements against this design

- `packages/cre-policy/src/index.ts` — `checkSpendPolicy(resourceId, amount)`
  that calls the Chainlink CRE gateway and verifies the signed attestation
- `apps/broker/src/routes/issue.ts` — insert the `checkSpendPolicy` call at
  the identified integration point (line 36)
- `apps/broker/src/config.ts` — `CRE_GATEWAY_URL` and `CRE_ENABLED` env vars
  (defaults: `CRE_ENABLED=false` so existing tests are unaffected)
- Tests: unit test `checkSpendPolicy` with a fake gateway response; integration
  test `POST /issue` returns 403 when the gateway denies
