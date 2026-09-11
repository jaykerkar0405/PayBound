# gated-content-service

Standalone x402-gated resource server, settled through the [Blocky402](https://blocky402.com)
testnet facilitator on Hedera. Built for the Hedera "AI & Agentic Payments" track's Day-1
task: prove Blocky402 works at all, fully isolated from the rest of PayBound. Day 1 had
zero imports from `apps/broker` or any `packages/*`; Day 2 introduced exactly one shared
dependency, `@paybound/x402-blocky402-client` (see "Architecture" below) — a generic,
PayBound-agnostic x402/Blocky402 protocol client, not business logic, so this service
still has no coupling to the Broker or its capability/payment model. Nothing here is
wired into the Broker's real payment flow or `e2e-live-demo.ts` yet — Day 2 added a
second, independent settlement strategy in `packages/settlement` that also consumes this
service, but through the Broker's own credentials in a separate stage, not through this
package.

## Setup

```
cp .env.example .env.local   # fill in GATED_PAYTO_ACCOUNT_ID, PAYER_ACCOUNT_ID, PAYER_PRIVATE_KEY
pnpm --filter gated-content-service dev:live       # starts the server on :3210
pnpm --filter gated-content-service test-client     # runs the standalone client against it
```

See `.env.example` for what each variable is and where to get testnet HBAR
(https://portal.hedera.com/).

## Architecture

- `src/config.ts` — env-derived config only.
- `src/blocky402.ts` — thin, config-bound wrapper around
  `@paybound/x402-blocky402-client`'s server-side Blocky402 helpers
  (`/supported`, `/verify`, `/settle`). The generic logic itself lives in that
  shared package (Day 2 extraction) — `packages/settlement`'s x402 settlement
  strategy depends on the same package rather than duplicating this logic.
- `src/index.ts` — Hono server exposing `GET /gated-research-snippet`: 402 with a
  `PaymentRequired` body when unpaid, verifies + settles through Blocky402 when an
  `X-PAYMENT` header is present, returns the (synthetic) content + the real Hedera
  transaction ID on success.
- `scripts/test-client.ts` — plain runnable script (not a test-framework test) that signs
  a real Hedera transfer via `@paybound/x402-blocky402-client`'s client-side helpers and
  drives the full 402 → pay → 200 flow.

`payTo` is a dedicated "data provider" testnet account, deliberately distinct from both
the Broker's operator account (which acts as *payer* in Day 2's new x402 settlement
strategy — see `packages/settlement`) and this package's own standalone test-client payer.
Keeping all three separate avoids a demo narrative where the Broker appears to pay itself.
See the comment on `Config.payToAccountId` in `src/config.ts`.

## Test accounts (Hedera testnet)

Recorded here so nobody has to re-derive "which account did we use" from HashScan. Three
distinct roles, three distinct accounts:

- **payTo / data provider**: `0.0.10480612` — created Day 2 (1 HBAR, funded from the
  Broker's operator account), used only to receive payments. Distinct from the Broker's
  own account so Day 2's Broker-driven x402 payment doesn't look like self-payment.
- **standalone test-client payer**: `0.0.10480198` — created and funded (5 HBAR) from the
  broker's operator account for Day 1's verification; still used by `scripts/test-client.ts`.
  DER private key lives only in `.env.local` (gitignored, never committed).
- **Broker operator (Day 2's x402-strategy payer)**: `0.0.10421552` — `apps/broker`'s
  existing `HEDERA_TESTNET_ACCOUNT_ID`, reused as-is; no new credential needed for the
  Broker's side of the new strategy. (This account was Day 1's original, since-replaced
  `payTo` choice — see git history if that context matters.)

## Day-1 live verification (2026-09-11)

Two independent runs, both a real signed HBAR transfer verified + settled through the
live Blocky402 testnet facilitator, each cross-checked against the Hedera mirror node and
a browser-rendered HashScan page (not just the facilitator's own response):

- `0.0.7162784@1789146819.646853496` — https://hashscan.io/testnet/transaction/0.0.7162784-1789146819-646853496
- `0.0.7162784@1789146835.033457070` — https://hashscan.io/testnet/transaction/0.0.7162784-1789146835-033457070

Both: `SUCCESS`, exactly 100000 tinybars (0.001 HBAR) transferred `0.0.10480198 → 0.0.10421552`,
fee paid by Blocky402's advertised `hedera:testnet` fee-payer account (`0.0.7162784`, fetched
live from `GET /supported` — never hardcoded).

Note: the x402-foundation spec doc names the settlement field `transactionId`, but
Blocky402's actual live `/settle` response (and the `@x402/core` types this package
imports) use `transaction` — see the comment at the top of `src/blocky402.ts`. Don't
"fix" this back to match the spec doc without re-checking a live response first.

## Day-2 shared-package re-verification (2026-09-11)

Day 2 extracted this package's Blocky402/Hedera client logic into
`@paybound/x402-blocky402-client` (consumed by both this service and
`packages/settlement`'s new x402 settlement strategy) and moved `payTo` to the new
dedicated data-provider account. Re-ran `scripts/test-client.ts` live against the
refactored code — not assumed correct from the diff being "just a move":

- `0.0.7162784@1789147994.641863826` — https://hashscan.io/testnet/transaction/0.0.7162784-1789147994-641863826

`SUCCESS`, exactly 100000 tinybars transferred `0.0.10480198 → 0.0.10480612` (the new
payTo account), fee paid by `0.0.7162784` — confirmed on the Hedera mirror node,
identical shape and outcome to Day 1's runs. The extraction is genuinely non-behavioral.
