# CRE local adapter — demo/local-dev tooling only

**Not a production component.** This directory exists to let
`apps/broker/src/cre-policy.ts`'s `checkSpendPolicy()` talk to the real,
merged `cre-workflow/spend-cap-workflow/` (PR #100) over a real HTTP
round-trip, for local demo/verification purposes — without needing a
persistent CRE gateway deployment.

## Why this exists

`cre workflow simulate ... --listen` (the CLI's own debug server mode) was
evaluated in `docs/CHAINLINK_CRE_DESIGN.md` and found unusable as a
synchronous gateway: its HTTP response is always an empty `200` body, it
rate-limits to one execution per 30 seconds, and its debug endpoint expects
the request wrapped as `{"input": {...}}`, not the raw
`{resourceId, exactAmount}` shape the broker actually sends.

This adapter avoids `--listen` entirely. Instead, `server.mjs` runs a real
`cre workflow simulate spend-cap-workflow --non-interactive --trigger-index 0
--http-payload '<forwarded request body>' --target staging-settings`
**once per incoming HTTP request** — the same one-shot invocation
`cre-workflow/README.md` and its `evidence/simulation-output.txt` already
prove works — and parses the real result back out of the CLI's own stdout.

## What this does NOT touch

- `apps/broker/src/cre-policy.ts`, `config.ts`, `issue.ts`,
  `issueCapability()`, `authorize()`, or any invariant clause — zero changes.
  Pointing a broker at this adapter is a config change
  (`CRE_GATEWAY_URL=http://127.0.0.1:8090`), not a code change.
- `cre-workflow/spend-cap-workflow/`'s workflow logic (PR #100) — untouched.
  This only shells out to the real `cre` CLI against that unmodified
  workflow.

## Running it

```bash
cd cre-workflow/adapter
node server.mjs
# listens on http://127.0.0.1:8090 by default (CRE_ADAPTER_PORT to change)
```

Then point a broker instance at it (`apps/broker/.env.local`):

```
CRE_ENABLED=true
CRE_GATEWAY_URL=http://127.0.0.1:8090
```

`prove-roundtrip.mjs` exercises the exact wire contract `checkSpendPolicy()`
uses (same method, headers, body shape, and response-parsing rules —
verified line-by-line against `apps/broker/src/cre-policy.ts` as it stands
today) without needing a full broker instance running:

```bash
node prove-roundtrip.mjs           # against http://127.0.0.1:8090
node prove-roundtrip.mjs <url>     # against a different adapter URL
```

## Current status: verified live, real round-trip confirmed

`cre login` was completed live in this environment (real browser OAuth flow,
confirmed via `cre whoami`). With a working session, both `cre workflow
simulate` directly and this adapter's full HTTP round-trip produce real,
correct results:

```
$ cre workflow simulate spend-cap-workflow --non-interactive --trigger-index 0 \
    --http-payload '{"resourceId": "api-call-gpt4", "exactAmount": "0.30"}' --target staging-settings
✓ Workflow Simulation Result:
"{\"allowed\":true,\"reason\":\"CRE policy: allowed\"}"
```

Real, live evidence, in order:

1. `evidence/2026-09-12_1237UTC_roundtrip-BLOCKED-pre-login.txt` — the
   original blocked attempt (no login), kept as evidence the failure mode
   was real, not fabricated.
2. `evidence/2026-09-12_1247UTC_direct-cli-post-login.txt` — real ALLOW and
   DENY results from `cre workflow simulate` run directly, post-login.
3. `evidence/2026-09-12_1248UTC_roundtrip-SUCCESS-post-login.txt` — real
   ALLOW and DENY results round-tripped through this adapter's `server.mjs`
   via `prove-roundtrip.mjs`, both returning genuine `HTTP 200` with the
   correct `{allowed, reason}` body — a real, complete broker↔workflow
   round-trip, not the fail-open path.
4. `evidence/parser-validation-against-pr100-evidence.txt` — the adapter's
   output-parsing logic validated against PR #100's own captured evidence
   (written before login was available; still valid, kept for completeness).

**Real per-request timing** (server-side, measured inside the adapter —
see evidence file 3 for the raw log lines): **13.9s** and **8.6s** for two
successive requests. A direct, unadapted `cre workflow simulate` invocation
measured similarly: **26.1s** cold, **7.8s–8.0s** on subsequent runs once
the CLI's own caches are warm. In short: **not fast enough to invoke live,
on-camera, per-request during a demo recording** — budget several seconds
to over 20 seconds per call, heavily front-loaded on the first invocation.
Pre-capturing the evidence above (or invoking it once, off-camera, shortly
before recording) is the realistic way to show this working in a demo.

## Operational notes (read before pointing a real broker at this)

- **Latency:** confirmed above — 8–26 seconds per request, dominated by
  workflow compilation and an RPC health check against `project.yaml`'s
  placeholder chain entry (which fails, but doesn't block execution).
  `checkSpendPolicy()`'s own `fetch()` call had no timeout as of this
  writing (see Fix 1 in the project's audit fix list) — before that fix
  lands, a hung `cre` invocation here could hang a real `/issue` call
  indefinitely. Supervised demo/manual use only, not a standing gateway.
- **Concurrency:** requests are handled strictly one at a time
  (`server.mjs`'s `busy` flag returns `503 adapter_busy` otherwise) —
  running multiple `cre` CLI processes against the same project
  concurrently has not been tested.
- **Rate limiting:** `docs/CHAINLINK_CRE_DESIGN.md` documents a 30-second
  rate limit specific to `--listen`'s debug endpoint, which this adapter
  never uses. Two successive one-shot `--http-payload` invocations 14
  seconds apart (evidence file 3) completed without hitting any rate limit,
  which is some evidence — not a guarantee — that the 30s limit is specific
  to `--listen` as documented, not account-wide.
