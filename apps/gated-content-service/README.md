# gated-content-service

Standalone x402-gated resource server, settled through the [Blocky402](https://blocky402.com)
testnet facilitator on Hedera. Built for the Hedera "AI & Agentic Payments" track's Day-1
task: prove Blocky402 works at all, fully isolated from the rest of PayBound. Zero imports
from `apps/broker` or any `packages/*` — nothing here is wired into the Broker or
`e2e-live-demo.ts` yet (that's Day 2).

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
- `src/blocky402.ts` — thin client for Blocky402's `/supported`, `/verify`, `/settle`.
- `src/index.ts` — Hono server exposing `GET /gated-research-snippet`: 402 with a
  `PaymentRequired` body when unpaid, verifies + settles through Blocky402 when an
  `X-PAYMENT` header is present, returns the (synthetic) content + the real Hedera
  transaction ID on success.
- `scripts/test-client.ts` — plain runnable script (not a test-framework test) that signs
  a real Hedera transfer via `@x402/hedera` and drives the full 402 → pay → 200 flow.

`payTo` currently reuses `apps/broker`'s operator account (`0.0.10421552`) as a plain data
value — it was the funded testnet account this task had on hand, not an architectural
link between this service and the Broker. See the comment on `Config.payToAccountId` in
`src/config.ts`.

## Test accounts (Hedera testnet)

Recorded here so Day 2 doesn't have to re-derive "which account did we use" from HashScan.

- **payTo** (recipient): `0.0.10421552` — apps/broker's operator account, reused as a data
  value (see above).
- **payer** (test-client's buyer role): `0.0.10480198` — created and funded (5 HBAR) from
  the broker's operator account specifically for this task's Day-1 verification. DER
  private key lives only in `.env.local` (gitignored, never committed) — copy it from
  there when setting up Day 2's live-demo integration rather than creating a new account,
  unless it runs dry. Balance after two 0.001 HBAR verification runs: ~4.998 HBAR.

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
