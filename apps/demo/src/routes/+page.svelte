<script lang="ts">
  import {
    initialState,
    pushLog,
    reduceEvent,
    STAGE_ORDER,
    type DashboardState,
    type StageStatus,
  } from "$lib/shared/state.js";
  import { parseLine, type StageId } from "$lib/shared/events.js";

  const STAGE_SHORT: Record<StageId, string> = {
    attest: "ATTEST",
    issue: "ISSUE",
    agent: "AGENT",
    pay: "PAY",
    settle: "SETTLE",
    hcs: "HCS",
    x402_purchase: "X402",
  };

  let dashboardState = $state<DashboardState>(initialState());
  let runId = $state<string | null>(null);
  let triggering = $state(false);
  let rateLimitMessage = $state<string | null>(null);
  let retryAfterSeconds = $state<number | null>(null);
  let source: EventSource | null = null;
  let countdownTimer: ReturnType<typeof setInterval> | null = null;

  // NOT `|| phase === "waiting"`: that phase means two different things
  // depending on where it's read. In apps/tui-dashboard, "waiting" only
  // ever appears for the few milliseconds between spawning the process
  // and its first output line, because that TUI spawns e2e:live
  // immediately on mount. Here, `initialState()`'s "waiting" is this
  // page's actual idle state before any run has ever been triggered — the
  // page never auto-spawns anything. Treating it as "a run is active"
  // permanently disables the trigger button on first load, since nothing
  // can ever transition out of it. `triggerRun` below sets phase straight
  // to "running" the moment a real run starts, so "waiting" here always
  // means genuinely idle.
  const isRunning = $derived(dashboardState.phase === "running");
  const buttonDisabled = $derived(triggering || isRunning || retryAfterSeconds !== null);
  const buttonLabel = $derived(
    triggering
      ? "STARTING…"
      : isRunning
        ? "RUN IN PROGRESS…"
        : retryAfterSeconds !== null
          ? `RETRY IN ${retryAfterSeconds}S`
          : "RUN LIVE DEMO",
  );

  function cleanRawLine(line: string): string {
    const stripped = line
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/^\s*\[sandbox\]\s*/, "")
      .trim();
    if (!stripped) return "";
    if (stripped.includes("PB_TUI_EVENT")) return "";
    if (/^[{}[\],]*$/.test(stripped)) return "";
    if (/^"[a-zA-Z]+":/.test(stripped)) return "";
    if (/^(toolCalls|readResults|payResults):\s*\[/.test(stripped)) return "";
    if (/^Estimated cost:/.test(stripped)) return "";
    if (/^===/.test(stripped)) return "";
    return stripped;
  }

  function handleLine(text: string): void {
    const withRunning: DashboardState =
      dashboardState.phase === "waiting" ? { ...dashboardState, phase: "running" } : dashboardState;
    const event = parseLine(text);
    dashboardState = event ? reduceEvent(withRunning, event) : pushLog(withRunning, cleanRawLine(text));
  }

  function startCountdown(seconds: number): void {
    retryAfterSeconds = seconds;
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      if (retryAfterSeconds === null) return;
      if (retryAfterSeconds <= 1) {
        retryAfterSeconds = null;
        rateLimitMessage = null;
        if (countdownTimer) clearInterval(countdownTimer);
      } else {
        retryAfterSeconds -= 1;
      }
    }, 1000);
  }

  async function triggerRun(): Promise<void> {
    if (buttonDisabled) return;
    triggering = true;
    rateLimitMessage = null;

    try {
      const res = await fetch("/api/run", { method: "POST" });
      if (res.status === 429) {
        const body = (await res.json()) as { retryAfterSeconds?: number };
        const wait = body.retryAfterSeconds ?? 60;
        rateLimitMessage =
          wait > 60
            ? `This demo is rate-limited to keep real API/HBAR cost bounded. Try again in ${Math.ceil(wait / 60)} min.`
            : `A run is already in progress. Try again shortly.`;
        startCountdown(Math.min(wait, 90));
        return;
      }
      if (!res.ok) {
        rateLimitMessage = "Could not start a run — the backend may be redeploying. Try again shortly.";
        return;
      }
      const body = (await res.json()) as { runId: string };
      runId = body.runId;
      dashboardState = initialState();
      dashboardState = { ...dashboardState, phase: "running" };
      connectStream(body.runId);
    } finally {
      triggering = false;
    }
  }

  function connectStream(id: string): void {
    source?.close();
    source = new EventSource(`/api/run/${id}/stream`);
    source.addEventListener("line", (e: MessageEvent) => {
      const text = JSON.parse((e as MessageEvent).data) as string;
      handleLine(text);
    });
    source.addEventListener("done", () => {
      source?.close();
      source = null;
      // A run that ends without ever reaching a terminal phase (e.g. the
      // process exited before any final_result/run_error line) still needs
      // to stop reading as "running" forever.
      if (dashboardState.phase === "running" || dashboardState.phase === "waiting") {
        dashboardState = pushLog({ ...dashboardState, phase: "exited" }, "Run process exited.");
      }
    });
    source.onerror = () => {
      // Browser EventSource auto-retries; if the run already finished
      // server-side this just no-ops on next line/done anyway.
    };
  }

  $effect(() => {
    return () => {
      source?.close();
      if (countdownTimer) clearInterval(countdownTimer);
    };
  });

  function shortHash(str: string | undefined): string {
    if (!str) return "";
    return str.length > 28 ? `${str.slice(0, 16)}…` : str;
  }

  const completedCount = $derived(STAGE_ORDER.filter((s) => dashboardState.stages[s] === "done").length);
  const pipelineFailed = $derived(STAGE_ORDER.some((s) => dashboardState.stages[s] === "failed"));
  const result = $derived(
    dashboardState.finalResult ?? dashboardState.x402Outcome?.result ?? dashboardState.scenarioOutcome?.result,
  );
  const isSucceeded = $derived(dashboardState.phase === "succeeded");
  const isFailed = $derived(dashboardState.phase === "failed" || dashboardState.phase === "exited");
  const hcsSeq = $derived(
    dashboardState.scenarioOutcome?.result?.hcsSequenceNumber ?? dashboardState.finalResult?.hcsSequenceNumber,
  );

  function logColor(text: string): "red" | "green" | undefined {
    if (text.includes("ERROR") || text.includes("failed") || text.includes("✗")) return "red";
    if (
      text.includes("FINAL") ||
      text.includes("SUCCESS") ||
      text.includes("✓") ||
      text.includes("paid=true") ||
      text.includes("Settlement found")
    )
      return "green";
    return undefined;
  }

  // --- Terminal box-drawing (renders real Unicode border characters,
  // matching Ink's `borderStyle="single"` output exactly, instead of a CSS
  // card with rounded corners and colored backgrounds — see the redesign
  // note in this file's history for why: a CSS card reads as a generic
  // web dashboard no matter how the colors are chosen, which isn't what
  // an "exact replica of the TUI" means). ---
  // Target interior width in character units. Top/bottom borders are NOT
  // literal repeated "─" text — box-drawing glyphs don't reliably render
  // at exactly 1ch across fonts, so a character-count-based border
  // string drifted out of sync with the actual row width and triggered
  // spurious horizontal scrollbars even on short content. Borders are
  // real CSS lines instead (see .tbox/.tcap below): pixel-exact
  // regardless of font, with literal ┌┐└┘ glyphs only at the corners,
  // which don't need to line up with anything else.
  const FULL = 88; // must comfortably fit the stage-badges row (7 badges + connectors, ~78 chars) without scrolling — the one row that can't be truncated
  const HALF = 43; // each half of the two-column midsection

  /** Ink can wrap text within a bordered Box (yoga layout); a fixed-width HTML row can't without breaking the border illusion, so long values (tx IDs, URLs) are truncated in the middle instead — same idea as ResultPanel's own `wrap="truncate-end"` elsewhere in this codebase. The untruncated value is always still the real href/title where relevant. */
  function truncateMid(s: string, max: number): string {
    if (s.length <= max) return s;
    const keep = max - 1;
    const front = Math.ceil(keep * 0.6);
    const back = keep - front;
    return `${s.slice(0, front)}…${s.slice(s.length - back)}`;
  }

  // ink-spinner's "dots" frame set, cycled at the same ~80ms it uses, for
  // the one active-stage spinner the pipeline row shows.
  const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let spinnerFrame = $state(0);
  $effect(() => {
    const t = setInterval(() => {
      spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
    }, 80);
    return () => clearInterval(t);
  });
</script>

<svelte:head>
  <title>PayBound — Live Agent Runtime</title>
</svelte:head>

<div class="shell" style:--shell-width="{FULL}ch">
  <!-- BANNER -->
  <div class="tbox" style:--cols="{FULL}">
    <div class="tcap"><span class="corner">┌</span><span class="rule"></span><span class="corner">┐</span></div>
    <div class="trow">
      <div class="rc">
        <span><span class="inverse"> PAYBOUND </span> <span class="bold">AGENT RUNTIME</span></span>
        <span class="dim">HEDERA TESTNET · LIVE</span>
      </div>
    </div>
    <div class="tcap"><span class="corner">└</span><span class="rule"></span><span class="corner">┘</span></div>
  </div>

  <!-- TRIGGER (deliberately unboxed, like the TUI's own footer/status line) -->
  <div class="trigger">
    <button onclick={triggerRun} disabled={buttonDisabled} class="term-btn">[ {buttonLabel} ]</button>
    <div class="dim trigger-note">
      {#if rateLimitMessage}
        {rateLimitMessage}
      {:else}
        One click runs the real thing: a live agent reads attacker-controlled content, the broker structurally
        can't be misdirected, and a real payment settles on Hedera testnet. Rate-limited to keep this safe to
        leave public.
      {/if}
    </div>
  </div>

  <!-- PIPELINE EXECUTION -->
  <div class="tbox" style:--cols="{FULL}">
    <div class="tcap"><span class="corner">┌</span><span class="rule"></span><span class="corner">┐</span></div>
    <div class="trow">
      <div class="rc">
        <span class="bold">PIPELINE EXECUTION</span>
        <span>
          {#if pipelineFailed}
            <span class="red bold">PIPELINE FAILED</span>
          {:else if completedCount === STAGE_ORDER.length}
            <span class="green bold">ALL STAGES COMPLETE</span>
          {:else}
            <span class="dim">STAGE {completedCount + 1} OF {STAGE_ORDER.length}</span>
          {/if}
        </span>
      </div>
    </div>
    <div class="trow">
      <div class="rc single">
        <span>
          {#each STAGE_ORDER as stage, i (stage)}
            {@const status = dashboardState.stages[stage] as StageStatus}
            {#if status === "done"}<span class="green bold">[✓ {STAGE_SHORT[stage]}]</span
              >{:else if status === "failed"}<span class="red bold">[✗ {STAGE_SHORT[stage]}]</span
              >{:else if status === "active"}<span class="inverse bold"> {SPINNER_FRAMES[spinnerFrame]} {STAGE_SHORT[stage]} </span
              >{:else}<span class="dim">[○ {STAGE_SHORT[stage]}]</span>{/if}{#if i < STAGE_ORDER.length - 1}<span class="dim"> ─ </span>{/if}
          {/each}
        </span>
      </div>
    </div>
    <div class="tcap"><span class="corner">└</span><span class="rule"></span><span class="corner">┘</span></div>
  </div>

  <!-- TWO-COLUMN MIDSECTION -->
  <div class="col-row">
    <div class="tbox" style:--cols="{HALF}">
      <div class="tcap"><span class="corner">┌</span><span class="rule"></span><span class="corner">┐</span></div>
      <div class="trow">
        <div class="rc">
          <span class="bold">AGENT DISPATCH</span>
          {#if dashboardState.lastToolCall}<span class="green bold">[DISPATCHED]</span>{:else}<span class="dim">[AWAITING]</span>{/if}
        </div>
      </div>
      <div class="trow">
        <div class="rc"><span class="dim">Function:</span><span class="bold">pay(capabilityId)</span></div>
      </div>
      <div class="trow">
        <div class="rc">
          <span class="dim">Capability:</span>
          <span class="bold">{dashboardState.lastToolCall ? truncateMid(dashboardState.lastToolCall.capabilityId, 22) : "(pending…)"}</span>
        </div>
      </div>
      <div class="trow">
        <div class="rc">
          <span class="dim">Timestamp:</span>
          <span class="dim">{dashboardState.lastToolCall?.timestamp ? `${dashboardState.lastToolCall.timestamp.slice(11, 19)} UTC` : "(standby)"}</span>
        </div>
      </div>
      <div class="trow">
        <div class="rc"><span class="bold underline">POLICY:</span><span class="dim">no amount/dest field</span></div>
      </div>
      <div class="tcap"><span class="corner">└</span><span class="rule"></span><span class="corner">┘</span></div>
    </div>

    <div class="tbox" class:c-green={isSucceeded} class:c-red={isFailed} style:--cols="{HALF}">
      <div class="tcap"><span class="corner">┌</span><span class="rule"></span><span class="corner">┐</span></div>
      <div class="trow">
        <div class="rc">
          <span class="bold">RUN STATE</span>
          {#if isSucceeded}<span class="green bold">[✓ SETTLED]</span
            >{:else if isFailed}<span class="red bold">[✗ FAILED]</span
            >{:else if dashboardState.phase === "waiting"}<span class="dim">[STANDBY]</span
            >{:else}<span class="inverse bold"> SYNCING </span>{/if}
        </div>
      </div>
      <div class="trow">
        <div class="rc"><span class="dim">Scenario:</span><span class="bold">{dashboardState.scenario ?? "live-demo"}</span></div>
      </div>
      <div class="trow">
        <div class="rc"><span class="dim">Task Hash:</span><span>{dashboardState.taskHash ? shortHash(dashboardState.taskHash) : "(seeding…)"}</span></div>
      </div>
      <div class="trow">
        <div class="rc">
          <span class="dim">Hedera Tx:</span>
          <span class="bold">{result?.hederaTransactionId ? truncateMid(result.hederaTransactionId, 22) : "(pending…)"}</span>
        </div>
      </div>
      <div class="trow">
        <div class="rc"><span class="bold underline">STATUS:</span>
          {#if isSucceeded}<span class="green bold">✓ CONFIRMED</span
            >{:else if isFailed}<span class="red bold">✗ {dashboardState.errorMessage ? truncateMid(dashboardState.errorMessage, 20) : "FAILED"}</span
            >{:else}<span class="dim">● RECONCILING</span>{/if}
        </div>
      </div>
      <div class="tcap"><span class="corner">└</span><span class="rule"></span><span class="corner">┘</span></div>
    </div>
  </div>

  <!-- TRANSACTION REGISTRY -->
  <div class="tbox" class:c-green={dashboardState.txns.length > 0} style:--cols="{FULL}">
    <div class="tcap"><span class="corner">┌</span><span class="rule"></span><span class="corner">┐</span></div>
    <div class="trow">
      <div class="rc">
        <span class="bold">TRANSACTION REGISTRY</span>
        <span class="dim">{dashboardState.txns.length} CONFIRMED</span>
      </div>
    </div>
    {#if dashboardState.txns.length === 0}
      <div class="trow">
        <div class="rc single"><span class="dim">(waiting for Hedera transaction confirmations…)</span></div>
      </div>
    {:else}
      {#each dashboardState.txns as tx, idx (tx.id)}
        <div class="trow">
          <div class="rc single">
            <span
              ><span class="green bold">[✓ 0{idx + 1}]</span> <span class="bold">{tx.label}</span>
              <span class="dim">· {truncateMid(tx.id, 34)}</span>{#if tx.sequenceNumber !== undefined}<span class="dim"
                >  · Seq {tx.sequenceNumber}</span
              >{/if}</span
            >
          </div>
        </div>
        <div class="trow">
          <div class="rc single">
            <a class="green underline" href={tx.url} target="_blank" rel="noopener noreferrer"
              >  └─ {truncateMid(tx.url, FULL - 6)}</a
            >
          </div>
        </div>
      {/each}
    {/if}
    <div class="tcap"><span class="corner">└</span><span class="rule"></span><span class="corner">┘</span></div>
  </div>

  <!-- AUDIT & TELEMETRY STREAM -->
  <div class="tbox" style:--cols="{FULL}">
    <div class="tcap"><span class="corner">┌</span><span class="rule"></span><span class="corner">┐</span></div>
    <div class="trow">
      <div class="rc">
        <span class="bold">AUDIT &amp; TELEMETRY STREAM</span>
        <span class="dim">{dashboardState.log.length} EVENTS</span>
      </div>
    </div>
    <div class="scroll-region">
      {#if dashboardState.log.length === 0}
        <div class="trow">
          <div class="rc single"><span class="dim">(waiting for telemetry stream…)</span></div>
        </div>
      {:else}
        {#each dashboardState.log as line (line.id)}
          {@const color = logColor(line.text)}
          <div class="trow">
            <div class="rc single">
              <span class="dim">{String(line.id).padStart(2, "0")} {line.time} │</span>
              <span class:red={color === "red"} class:green={color === "green"}> {truncateMid(line.text, FULL - 14)}</span>
            </div>
          </div>
        {/each}
      {/if}
    </div>
    <div class="tcap"><span class="corner">└</span><span class="rule"></span><span class="corner">┘</span></div>
  </div>

  <div class="footer">
    <span class="dim">source: github.com/jaykerkar0405/PayBound</span>
    <span class="dim">a real broker + Ledger-emulated signer + Hedera testnet, not a mock</span>
  </div>
</div>

<style>
  /*
   * This page is a literal character-grid terminal, not a styled web
   * card layout: real Unicode box-drawing borders (┌─┐│└─┘), no
   * border-radius anywhere, no box-shadow, no colored backgrounds behind
   * badges — colors are applied to TEXT exactly where
   * apps/tui-dashboard's Ink components apply them (ink `color="green"`
   * etc. only ever colors the glyph, never adds a fill or border chrome
   * around it), nowhere else. A previous version of this page used CSS
   * cards with rounded corners and colored borders/pills, which read as
   * a generic web dashboard no matter the palette — this is the fix.
   */
  :root {
    --bg: #000000;
    --fg: #d4d4d4;
    --dim: #6a6a6a;
    --green: #2f9e44;
    --red: #c0392b;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #ffffff;
      --fg: #1a1a1a;
      --dim: #767676;
      --green: #1e7a34;
      --red: #a52422;
    }
  }

  :global(html),
  :global(body) {
    background: var(--bg);
    color: var(--fg);
    margin: 0;
  }
  :global(*) {
    box-sizing: border-box;
  }

  .shell {
    width: var(--shell-width);
    max-width: 100%;
    margin: 0 auto;
    padding: 24px 16px 48px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-family: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
    font-size: 13px;
    line-height: 1.45;
  }

  /* --- terminal box primitives ---
     Real CSS borders for the straight edges (pixel-exact, immune to
     font-metric drift) with literal Unicode glyphs only at the four
     corners, via .tcap. See the FULL/HALF comment above for why this
     replaced a literal-┌─┐-text approach. */
  .tbox {
    --box-color: var(--dim);
    width: calc(var(--cols) * 1ch);
    max-width: 100%;
    border-left: 1px solid var(--box-color);
    border-right: 1px solid var(--box-color);
  }
  .tbox.c-green {
    --box-color: var(--green);
  }
  .tbox.c-red {
    --box-color: var(--red);
  }
  .tcap {
    display: flex;
    align-items: center;
    height: 1px;
    color: var(--box-color);
  }
  .tcap .corner {
    flex: 0 0 auto;
    line-height: 0;
  }
  .tcap .rule {
    flex: 1 1 auto;
    height: 0;
    border-top: 1px solid var(--box-color);
  }
  .trow {
    display: flex;
    overflow-x: auto; /* safety net only — content is truncated well before this should ever trigger */
  }
  .rc {
    flex: 1 1 auto;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1ch;
    padding: 2px 1ch;
    min-width: 0;
    white-space: nowrap;
  }
  .rc.single {
    justify-content: flex-start;
  }
  .scroll-region {
    max-height: 260px;
    overflow-y: auto;
  }

  /* --- unboxed trigger, same as the TUI's own out-of-box status/footer lines --- */
  .trigger {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 4px;
    text-align: center;
  }
  .term-btn {
    font-family: inherit;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 4px 12px;
    background: transparent;
    color: var(--fg);
    border: none;
    cursor: pointer;
  }
  .term-btn:hover:not(:disabled) {
    background: var(--fg);
    color: var(--bg);
  }
  .term-btn:disabled {
    color: var(--dim);
    cursor: not-allowed;
  }
  .trigger-note {
    max-width: 78ch;
  }

  .col-row {
    display: flex;
    gap: 2ch;
    flex-wrap: wrap;
  }

  .footer {
    width: 100%;
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px 4px 0;
  }

  /* --- text-only modifiers, no chrome — this is the actual fix for
     "too much green": color is a property of the glyph, never a fill,
     border, or pill background. --- */
  .bold {
    font-weight: 700;
  }
  .underline {
    text-decoration: underline;
  }
  .dim {
    color: var(--dim);
  }
  .green {
    color: var(--green);
  }
  .red {
    color: var(--red);
  }
  a.green {
    text-decoration: none;
  }
  .inverse {
    background: var(--fg);
    color: var(--bg);
  }
</style>
