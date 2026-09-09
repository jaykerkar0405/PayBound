# Demo Signing Approach

## Decision: Option 1 — Human Approval

The live demo will have a person physically approve each payment on the
Speculos emulator (or a real Ledger device) at the right moment in the demo
script. This is intentional design, not a bug.

---

## Background and Reasoning

### Current state of the codebase (as of task 3.1)

The Ledger-backed signing path (`packages/ledger-signer`, `apps/broker/src/signer.ts`)
is currently a **stub**:

- `packages/ledger-signer/src/index.ts` exports nothing — it is an explicit
  placeholder pending task 3.1's signing-curve decision (see
  `docs/OPEN_QUESTIONS.md "Ledger signing curve mismatch"`).
- `apps/broker/src/signer.ts` uses a fixed HMAC secret for development.
  It does **not** contact a Ledger device or Speculos in any code path today.

There is therefore no active "hang on device approval" problem in the current
codebase. This document records the approach for **when task 3.1 lands** and
real Ledger signing is wired in.

### Why Option 1, not Option 2

**Option 2 — demo-safe auto-approval** — would require building a
Speculos HTTP button poller that ships alongside the broker as real demo
tooling. That is non-trivial engineering:

- It needs its own lifecycle management (start alongside broker, stop
  gracefully, survive broker restarts).
- It couples the demo tightly to Speculos's HTTP API, which is emulator-only
  and would need a different mechanism for a physical Ledger device.
- It obscures the Ledger approval step — a core part of the security story —
  from anyone watching the demo.

**Option 1** avoids all of this:

- Zero new code needed for the demo path.
- The human approval step is a **feature, not a bug** in a security demo:
  it shows the audience that the Ledger device produces a visible
  confirmation prompt before money moves. Hiding that behind an auto-approver
  defeats the demo's own purpose.
- Faster to implement given the Sept 13 deadline (`docs/TASKS.md §Phase 6`).
- If task 3.1 slips or the signing-curve question isn't resolved in time,
  the stub signer continues working without any Speculos involvement at all.

> **If Option 2 is ever needed** (e.g. a fully scripted CI-style end-to-end
> test that exercises real signing unattended), revisit this document at that
> point. The right reference implementation to adapt is the test-time poller
> in `apps/broker/src/__tests__/global-setup.speculos.ts` (when that file is
> created as part of task 3.1). Do **not** add such a poller now; the
> infrastructure it would poll doesn't exist yet.

---

## Demo script: what the person running the demo must do

When task 3.1 is complete and real Ledger signing is active:

1. **Start Speculos before the demo** (see `packages/ledger-signer/speculos/README.md`).
2. **Start the broker** (`pnpm --filter broker dev` or equivalent).
3. When the demo triggers `POST /pay` or `POST /issue`, the Ledger device
   (or Speculos UI) will display a transaction review screen.
4. **Navigate and approve on-device**:
   - Press **right** to advance through transaction fields.
   - Press **both buttons** on the final "Sign" or "Approve" screen to confirm.
5. The broker's signing call will unblock and the payment will proceed.

> **Timing note**: approval must happen within the device timeout window
> (configured in `packages/ledger-signer/src/device.ts` as
> `SPECULOS_EXCHANGE_TIMEOUT_MS` — 60 s by default). If the demo pauses
> longer than that before approval, the request will time out with:
> `"ledger device: timed out waiting for a Speculos APDU response"`.
> Simply re-trigger the payment after restarting Speculos to clear stale
> device state (status word `0x6901` indicates leftover state from a prior
> timed-out attempt).

---

## Speculos start script

`packages/ledger-signer/speculos/start.sh` provides two modes:

- **Interactive (default)**: `./start.sh` — for human-attended runs where
  you can see Speculos's screen in a terminal. Starts Speculos in the
  foreground; press Ctrl-C to stop.
- **Background (demo/script)**: `./start.sh --detach` — starts Speculos as
  a detached Docker container (`docker run -d`) and prints the container ID.
  Run `./stop.sh` to stop it afterward.

The original `docker run -it` invocation failed in non-interactive/scripted
contexts ("cannot attach stdin to a TTY-enabled container because stdin is
not a terminal"). The updated script uses `-it` only in interactive mode and
`-d` in detached mode. See `packages/ledger-signer/speculos/README.md` for
full usage.
