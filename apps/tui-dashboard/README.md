# PayBound TUI Dashboard (Task 6.x)

A live, terminal-based visualization of a real `pnpm e2e:live` run
(`apps/broker/scripts/e2e-live-demo.ts`) as it happens — built for Jay's demo
recording (6.3). Built with [Ink](https://github.com/vadimdemedes/ink) (React
for terminals).

**This is a display-only layer.** It reads a real run's output; it never
writes anything back into the payment flow (attestation, issuance, agent run,
payment, settlement, HCS), and it cannot affect that flow's outcome even if
it crashes, hangs, or is killed outright. See
["Independence, verified"](#independence-verified) below.

## Running it

The dashboard needs the same always-on infra as
[`docs/WALKTHROUGH.md`](../../docs/WALKTHROUGH.md) Level 1: Speculos and
the Broker running, `apps/broker/.env.local`/`apps/sandbox/.env.local`
configured. Bring all of that up with one script from the repo root
(see [`scripts/live-stack.sh`](../../scripts/live-stack.sh)):

```bash
pnpm live:up      # starts Speculos + Broker, seeds the task, idempotent
pnpm live:status  # check what's up
pnpm live:down    # tear it all down when you're done rehearsing
```

`live:up` only manages that infra — it does not start `e2e:live` or this
dashboard, so you can run either as many times as you want against the
same up-once stack. Then, from `apps/tui-dashboard/`:

```bash
pnpm dev
```

This spawns the real `e2e:live` command itself
(`node --env-file=.env.local --env-file=../sandbox/.env.local --import tsx/esm scripts/e2e-live-demo.ts`,
run from `apps/broker/` — the exact command behind
`apps/broker/package.json`'s own `e2e:live` script) and renders the
dashboard around its output. You don't run `pnpm e2e:live` separately —
this starts it.

Press `Ctrl+C` to exit the dashboard at any point. **This does not stop the
underlying run** — see below.

### Terminal width assumption

Designed for an **80-100 column terminal**. The layout reads
`process.stdout.columns` at startup and clamps to that range (narrower than
80 renders at 80 and will overflow; wider than 100 is capped at 100 rather
than stretching). Size your terminal into that range *before* hitting record.

### Running a different adversarial scenario

The dashboard spawns `e2e:live` with this process's own environment
(`runner.ts`), so any of that script's env vars pass straight through —
including `E2E_DEMO_SCENARIO` (see `docs/WALKTHROUGH.md`'s "Trying a
different adversarial scenario"):

```bash
E2E_DEMO_SCENARIO=hijack pnpm dev
```

The event log (panel 4) shows which scenario is running the moment the
content server starts, alongside the usual stage/audit events.

### Replaying a captured run (dev/testing only)

To iterate on the dashboard's rendering without spending a real Gemini/Hedera
call every time, replay a previously captured log at a fixed pace:

```bash
pnpm dev -- --replay /path/to/captured.log
```

Any file containing the same NDJSON event lines a real run produces works,
including a real run's own log file (see below). This mode is never used in
the actual demo-recording path.

## Panel layout

Top to bottom, fixed order:

1. **Banner** — "PayBound — Live Payment Trace".
2. **Stage tracker** — the 6 real stages: Attest, Issue, Agent, Pay, Settle,
   HCS. Current stage shows a spinner, completed stages are checked, others
   are dimmed. These are not `e2e-live-demo.ts`'s own `[1/6]`..`[6/6]`
   script-level stages (see [Data source](#data-source) below) — they're the
   finer-grained sequence a reader of `docs/WALKTHROUGH.md` would recognize:
   attestation handshake, capability issuance, the agent's tool-calling loop,
   the `pay` tool call itself, Hedera settlement, and HCS audit confirmation.
3. **Live tool-call panel** — the exact JSON the agent sent to the `pay`
   tool, `{ "capabilityId": "<real id>" }`, shown the instant it happens.
   There is no amount field and no recipient field because the tool itself
   has none (`apps/sandbox/src/tools/pay.ts`) — that's the point.
4. **Event log** — the last 10 real `[AUDIT]`/stage events, oldest to
   newest. A bounded, rolling window (see `state.ts`'s `pushLog`) — each
   update touches a fixed-size array, not a growing transcript.
5. **Final result panel** — once set (`final_result` event), stays on screen
   for the rest of the process's life: `paid`, the real Hedera transaction
   ID, and the real HCS sequence number. Nothing later clears it, and it's
   the last thing rendered in `App.tsx`, so it's the last thing on screen
   when recording stops.

## Data source

Per the architecture decision behind this task: the dashboard tails
*structured log output* from the real `e2e:live` process — it does **not**
poll a new HTTP endpoint, and it doesn't add a network dependency to the
critical recording path.

`e2e-live-demo.ts`'s existing output wasn't structured enough on its own to
parse reliably (the final tool-call/payment summary spans several
pretty-printed, multi-line JSON blocks, and gets re-prefixed with
`  [sandbox] ` per line when forwarded from the spawned agent process — a
naive multi-line regex over that text would be fragile exactly where
`e2e-live-demo.ts`'s own `runAgent()` re-prints the spawned sandbox
process's output). So this task added the smallest possible parallel
structured stream, alongside the existing human-readable output — never
replacing it:

Every line of the form `PB_TUI_EVENT <compact-json>` is a display-only event.
These lines were added as pure, additive `console.log` calls (no control-flow
or behavior changes) in exactly three places:

| File | What it adds |
|---|---|
| `apps/sandbox/src/tools/pay.ts` | `pay_tool_call` — logged at the very top of `executePay`, before the request is made. This is what panel 3 shows. |
| `apps/sandbox/src/live-run.ts` | `stage` events for `attest`/`issue`/`agent`, `capability_issued`, `payment_result`, and a `run_error` on the top-level catch. |
| `apps/broker/scripts/e2e-live-demo.ts` | `run_started`, `task_seeded`, `content_served`, `stage` events for `settle`/`hcs`, `settlement_found` (including the HCS `sequence_number` — captured from the mirror node response but not previously printed; now also printed as a plain `hcsSequenceNumber: N` line alongside the existing human-readable settlement block), `mirror_confirmed`, `final_result`, and `run_error` on every failure branch (including the top-level `.catch`). |

`apps/sandbox/src/live-run.ts` runs as a real child process of
`e2e-live-demo.ts` (`runAgent()`), and its stdout/stderr are already
forwarded through `e2e-live-demo.ts`'s own stdout, prefixed
`  [sandbox] ` — so any `PB_TUI_EVENT` line from `live-run.ts` or
`pay.ts` reaches this dashboard the same way as everything else, no new
plumbing needed. The parser (`events.ts`'s `parseLine`) finds the
`PB_TUI_EVENT` marker anywhere on a line and ignores whatever precedes it, so
that prefix (or ANSI codes, or ordinary log noise) never breaks parsing.

See `events.ts` for the full event type union and `state.ts` for how each
event updates dashboard state.

## Independence, verified

The whole point of this being a *separate* process is that it must never be
able to affect, or be a single point of failure for, the actual payment
flow. This holds by construction, not just by convention — see
`runner.ts`'s top doc comment for the three mechanisms:

1. The `e2e:live` child is spawned `detached: true`, in its own process
   group — a `Ctrl+C` in the dashboard's terminal (which sends `SIGINT` to
   the *foreground process group*) cannot reach it.
2. The child's stdout/stderr are redirected to a real log file on disk, not
   piped through this process — this dashboard *tails that file* by polling
   its size and reading new bytes. There is no pipe between the two
   processes for a dead dashboard to leave dangling, and no `EPIPE` risk.
3. `child.unref()`, and nothing in this codebase ever calls `child.kill()` —
   the child's lifecycle is never tied to the dashboard's.

Verified live (see the PR description for the actual transaction IDs from
each run): started a real `pnpm dev` run from this package, and — mid-run,
before stage 6 completed — killed the dashboard three different ways
(`Ctrl+C`, `kill -9 <dashboard-pid>` from another terminal, and closing the
terminal window outright). In every case the underlying `e2e:live` process
kept running to completion in the background, its payment settled, and the
transaction was independently confirmed on the Hedera Testnet mirror node
afterward — the same standard every other live check in this project uses.
You can confirm this yourself: after killing the dashboard, check
`ps aux | grep e2e-live-demo` (it's still there) and
`cat /tmp/paybound-tui-dashboard/e2e-live-*.log | tail` (it's still writing).

## What this does *not* do

- Does not read the Broker's own console output or database directly — the
  settlement/HCS numbers it shows come from `e2e-live-demo.ts`'s own
  independent mirror-node verification (the same one `docs/WALKTHROUGH.md`
  walks through), not from trusting the Broker's logs.
- Does not retry, restart, or otherwise control the `e2e:live` run. If it
  fails, the dashboard shows the real error and stops updating; it does not
  attempt to recover the run itself.
- Does not add any new tool the agent can call, any new Broker endpoint, or
  any new field to the `pay` request. It only reads.
