# Demo Signing Approach

## Current decision: scripted auto-approval, local/TUI path only

The local/TUI live-demo path (`pnpm --filter broker e2e:live`, and
`apps/tui-dashboard`, which spawns the same command) runs real Ledger-backed
signing against Speculos, approved automatically by a scripted button-presser
(`apps/broker/src/speculos-auto-approve.ts`) — no human needs to stand at a
keyboard, but the real device app still genuinely receives and processes the
signing request and its on-screen review flow. This is what the submission's
recorded demo video shows, and it is the real hardware-signing proof for the
Ledger track.

The deployed web dashboard (`apps/demo`, judge-facing, reachable from any
device) permanently uses the Phase 1 stub signer instead
(`LEDGER_SIGNING_ENABLED=false`, see `apps/demo/.env.example`) — it is a
UI/UX exploration surface, not a second hardware-signing proof. See
"Why the dashboard stays on the stub signer" below for why this isn't
revisited just because hosting/reachability changes.

This document replaces an earlier version of itself that predates both of
these decisions (see git history) — that version was written when
`apps/broker/src/signer.ts` was still a pure stub with no real Speculos
path at all, and proposed **manual, human-attended approval** as the demo
plan for whenever real signing landed. That plan was superseded before it
was ever used for a live run: manual approval never shipped, and once real
signing did land, going straight to scripted auto-approval was the better
fit — see the next section.

---

## Why scripted auto-approval, not manual human approval

Manual approval (a person pressing Speculos's physical/emulated buttons at
the right moment) has a real cost that scripted approval doesn't: it
requires a human at a keyboard, in real time, synchronized with wherever
in the pipeline the signing call happens to land — brittle for a recorded
demo take, and a hard blocker for anything unattended (repeated rehearsal
runs, CI-style checks).

Scripted auto-approval (`speculos-auto-approve.ts`, adapted from the test
suite's own `global-setup.speculos.ts` poller) keeps the demo an honest
run of the real signing path — Speculos's on-device review flow genuinely
executes — without needing a human present. It polls Speculos's HTTP
automation API for the current review screen and pages/confirms through
it (`right` to advance fields, `both` to confirm), the same sequence a
human would perform.

---

## Why the dashboard stays on the stub signer

A further idea explored during this project — routing Speculos's pending
approval screen to a judge's *browser* so they could click a real
approve/reject button themselves — was investigated and **fully cancelled,
not deferred**. Even setting aside hosting cost (a publicly-reachable
Speculos instance would need a paid Render Private Service, or a
self-hosted VM/tunnel — all rejected as unnecessary spend for this), the
idea has a product-fit problem independent of hosting: hardware-approval
UX (reading a device review screen, pressing through fields) does not work
for a judge on a phone. That problem doesn't go away no matter how
Speculos is hosted, so this is not "revisit once reachability improves" —
it's closed. If browser-driven human approval is ever wanted again, it
needs a different UX proposal, not just infrastructure.

The dashboard's `LEDGER_SIGNING_ENABLED=false` is therefore permanent
product intent, not a temporary hosting workaround — see the comment on
that line in `apps/demo/.env.example` before changing it.

---

## Running the local/TUI path yourself

1. **Start Speculos** (see `packages/ledger-signer/speculos/README.md`):
   `packages/ledger-signer/speculos/start.sh` (interactive) or
   `--detach` (background/scripted).
2. **Start the broker**, then run `pnpm --filter broker e2e:live` (or
   `apps/tui-dashboard`, which spawns the same command).
3. With `LEDGER_SIGNING_ENABLED` at its default `true` and
   `LEDGER_TRANSPORT=speculos`, `e2e-live-demo.ts`'s `main()` starts the
   auto-approve poller for the whole run — no manual button-pressing is
   needed or expected.

If you want to watch (or manually override) the approval yourself instead,
you still can: Speculos's screen is a real, inspectable device UI
(`packages/ledger-signer/speculos/README.md` documents the manual
right/both button sequence) — the poller pressing buttons on your behalf
doesn't prevent you from also watching it happen.

> **Timing note**: the device timeout window is
> `SPECULOS_EXCHANGE_TIMEOUT_MS` in `packages/ledger-signer/src/device.ts`
> (60s by default). If Speculos becomes unresponsive or the poller can't
> keep up, the signing call fails with `"ledger device: timed out waiting
> for a Speculos APDU response"`; restart Speculos to clear stale device
> state (status word `0x6901`) and re-trigger the run.
