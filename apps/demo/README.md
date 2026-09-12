# PayBound Live Web Demo

A public, judge-facing web page that runs the **real** `e2e:live` path on
click — not a replay, not a mock. It reuses `apps/tui-dashboard`'s exact
stage/event reducer (`src/lib/shared/`, ported verbatim) so the browser
shows the same pipeline, tool-call, transaction, and audit panels the
terminal dashboard does, driven by the same real NDJSON events.

## Why this exists

Two deployed services (`apps/broker`, `apps/gated-content-service`) on
their own are just bare API endpoints — nothing a judge can meaningfully
click through. This page is what actually uses them: clicking "RUN LIVE
DEMO" spawns a real agent run against your deployed broker's public URL,
and a real x402 purchase against your deployed gated-content-service, then
streams the whole thing live over SSE.

**Every click spends real money and real API quota** — one real Gemini
call, tiny real testnet HBAR transfers, one real HCS message. See
`src/lib/server/rate-limiter.ts` for why this is safe to leave public
(1 concurrent run, 6/hour, in-memory — a single free-tier instance needs
nothing fancier).

## Architecture

- `src/lib/shared/{state,events}.ts` — ported from `apps/tui-dashboard`,
  kept in sync by hand. Zero Ink/terminal dependencies in the original, so
  the browser reuses the exact same reducer rather than re-deriving it.
- `src/lib/server/rate-limiter.ts` — in-memory, single-instance limiter.
- `src/lib/server/run-manager.ts` — spawns
  `apps/broker/scripts/e2e-live-demo.ts` as a real child process (the exact
  command `apps/broker`'s own `e2e:live` script runs), buffers its output,
  broadcasts to any number of connected browser tabs.
- `src/routes/api/run/+server.ts` — `POST`, triggers a run (rate-limited).
- `src/routes/api/run/[id]/stream/+server.ts` — `GET`, Server-Sent Events.
- `src/routes/+page.svelte` — the page itself: button, stage tracker,
  tool-call panel, result panel, transaction registry, event log — same
  panel names and layout as `apps/tui-dashboard`, in a monochrome
  shadcn-style treatment instead of Ink.

**Important, non-obvious architecture note:** the scenario stage (the
security-relevant agent run) genuinely calls your deployed broker over
real HTTP (`BROKER_HOST`). The separate x402 purchase stage does **not** —
`apps/broker/scripts/pay-for-gated-content.ts` imports the broker's
issuance/authorize logic directly and runs it in-process against a local
SQLite file (this is existing, intentional architecture — see that file's
own doc comment — not something this app changes). It still genuinely
calls your deployed **gated-content-service** over real HTTP for the
402→sign→200 handshake; only the capability bookkeeping behind it is
local to this process.

## Environment variables

See `.env.example` — this app needs its own copies of the Gemini/Hedera
credentials and `LEDGER_SIGNING_ENABLED=false`, since the spawned script's
preflight checks read *this process's* environment, not the remote
broker's.

## Local development

```bash
pnpm --filter broker dev:live          # a broker instance somewhere reachable
pnpm --filter gated-content-service dev:live
cd apps/demo
cp .env.example .env.local             # fill in real values, BROKER_HOST=http://127.0.0.1:3000
pnpm dev
```

## Deploying (Render)

- Root Directory: repo root (blank) — this spawns sibling apps by relative
  path, so it needs the whole monorepo checkout, not just `apps/demo`.
- Build: `pnpm install --frozen-lockfile && pnpm exec turbo run build`
  (deliberately **not** `--filter=demo` — `apps/broker` and `apps/sandbox`
  are spawned as sibling *processes*, not declared package.json
  dependencies of `demo`, so Turbo's dependency graph never builds them
  or the `@paybound/*` workspace packages they import — every one of
  which ships as `main: "./dist/index.js"` with `dist/` gitignored — when
  the build is scoped to `--filter=demo`. That scoping produces a demo
  service that starts fine but fails every run with `ERR_MODULE_NOT_FOUND`
  the moment the spawned script tries to import an unbuilt workspace
  package. Building the whole repo is the only filter that's
  actually correct here; Turbo's cache keeps repeat builds cheap.)
- Start: `pnpm --filter demo start` (runs `node build/index.js`).
- Env vars: see `.env.example`. `BROKER_HOST` and `GATED_CONTENT_URL`
  should point at your other two deployed Render services' real URLs.
