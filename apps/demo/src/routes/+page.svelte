<script lang="ts">
  import {
    initialState,
    pushLog,
    reduceEvent,
    STAGE_ORDER,
    STAGE_LABELS,
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
</script>

<svelte:head>
  <title>PayBound — Live Agent Runtime</title>
</svelte:head>

<div class="shell">
  <header class="panel banner">
    <div class="banner-left">
      <span class="chip chip-inverse">PAYBOUND</span>
      <span class="bold">AGENT RUNTIME</span>
    </div>
    <span class="dim">HEDERA TESTNET · LIVE</span>
  </header>

  <section class="trigger">
    <button onclick={triggerRun} disabled={buttonDisabled} class="run-button">{buttonLabel}</button>
    <span class="dim trigger-note">
      {#if rateLimitMessage}
        {rateLimitMessage}
      {:else}
        One click runs the real thing: a live agent reads attacker-controlled content, the broker structurally
        can't be misdirected, and a real payment settles on Hedera testnet. Rate-limited to keep this safe to
        leave public.
      {/if}
    </span>
  </section>

  <section class="panel stage-tracker">
    <div class="panel-head">
      <span class="bold">PIPELINE EXECUTION</span>
      <span class="dim">
        {#if pipelineFailed}
          <span class="red bold">PIPELINE FAILED</span>
        {:else if completedCount === STAGE_ORDER.length}
          <span class="green bold">ALL STAGES COMPLETE</span>
        {:else}
          STAGE {completedCount + 1} OF {STAGE_ORDER.length}
        {/if}
      </span>
    </div>
    <div class="stage-row">
      {#each STAGE_ORDER as stage, i (stage)}
        {@const status = dashboardState.stages[stage] as StageStatus}
        <span
          class="badge"
          class:badge-done={status === "done"}
          class:badge-active={status === "active"}
          class:badge-failed={status === "failed"}
          class:badge-pending={status === "pending"}
        >
          {#if status === "done"}✓{:else if status === "failed"}✗{:else if status === "active"}●{:else}○{/if}
          {STAGE_SHORT[stage]}
        </span>
        {#if i < STAGE_ORDER.length - 1}<span class="connector">─</span>{/if}
      {/each}
    </div>
  </section>

  <section class="columns">
    <div class="panel">
      <div class="panel-head">
        <span class="bold">AGENT TOOL DISPATCH</span>
        {#if dashboardState.lastToolCall}
          <span class="green bold">[DISPATCHED]</span>
        {:else}
          <span class="dim">[AWAITING]</span>
        {/if}
      </div>
      <div class="kv"><span class="dim">Function:</span><span class="bold">pay(capabilityId)</span></div>
      <div class="kv">
        <span class="dim">Capability:</span>
        <span class="bold">{dashboardState.lastToolCall?.capabilityId ?? "(pending…)"}</span>
      </div>
      <div class="kv">
        <span class="dim">Payload:</span>
        <span>{dashboardState.lastToolCall ? `{"capabilityId": "${dashboardState.lastToolCall.capabilityId}"}` : "(waiting…)"}</span>
      </div>
      <div class="kv">
        <span class="dim">Timestamp:</span>
        <span class="dim">{dashboardState.lastToolCall?.timestamp ? `${dashboardState.lastToolCall.timestamp.slice(11, 19)} UTC` : "(standby)"}</span>
      </div>
      <div class="kv"><span class="bold underline">POLICY:</span><span class="dim">Zero model tampering</span></div>
    </div>

    <div class="panel" class:panel-green={isSucceeded} class:panel-red={isFailed}>
      <div class="panel-head">
        <span class="bold">SETTLEMENT &amp; RUN STATE</span>
        {#if isSucceeded}
          <span class="green bold">[✓ SETTLED]</span>
        {:else if isFailed}
          <span class="red bold">[✗ FAILED]</span>
        {:else if dashboardState.phase === "waiting"}
          <span class="dim">[STANDBY]</span>
        {:else}
          <span class="chip chip-inverse">SYNCING</span>
        {/if}
      </div>
      <div class="kv"><span class="dim">Scenario:</span><span class="bold">{dashboardState.scenario ?? "live-demo"}</span></div>
      <div class="kv"><span class="dim">Task Hash:</span><span>{dashboardState.taskHash ? shortHash(dashboardState.taskHash) : "(seeding…)"}</span></div>
      <div class="kv"><span class="dim">Hedera Tx:</span><span class="bold">{result?.hederaTransactionId ?? "(pending…)"}</span></div>
      <div class="kv"><span class="dim">HCS Seq #:</span><span>{hcsSeq !== undefined ? String(hcsSeq) : "(pending…)"}</span></div>
      <div class="kv">
        <span class="bold underline">STATUS:</span>
        {#if isSucceeded}
          <span class="green bold">✓ MIRROR CONFIRMED</span>
        {:else if isFailed}
          <span class="red bold">✗ {dashboardState.errorMessage ? dashboardState.errorMessage.slice(0, 40) : "FAILED"}</span>
        {:else}
          <span class="dim">● RECONCILING HCS</span>
        {/if}
      </div>
    </div>
  </section>

  <section class="panel" class:panel-green={dashboardState.txns.length > 0}>
    <div class="panel-head">
      <span class="bold">TRANSACTION REGISTRY &amp; HASHSCAN AUDIT</span>
      <span class="dim">{dashboardState.txns.length} CONFIRMED SETTLEMENTS</span>
    </div>
    {#if dashboardState.txns.length === 0}
      <span class="dim">(waiting for Hedera transaction confirmations…)</span>
    {:else}
      {#each dashboardState.txns as tx, idx (tx.id)}
        <div class="txn">
          <div class="txn-head">
            <span class="green bold">[✓ 0{idx + 1}]</span>
            <span class="bold">{tx.label}</span>
            <span class="dim">· Tx: {tx.id}</span>
            {#if tx.sequenceNumber !== undefined}<span class="dim">· Seq: {tx.sequenceNumber}</span>{/if}
          </div>
          <div class="txn-url"><span class="dim">└─ Explorer: </span><a href={tx.url} target="_blank" rel="noopener noreferrer">{tx.url}</a></div>
        </div>
      {/each}
    {/if}
  </section>

  <section class="panel event-log">
    <div class="panel-head">
      <span class="bold">AUDIT &amp; TELEMETRY STREAM</span>
      <span class="dim">{dashboardState.log.length} TOTAL EVENTS</span>
    </div>
    {#if dashboardState.log.length === 0}
      <span class="dim">(waiting for telemetry stream…)</span>
    {:else}
      {#each dashboardState.log as line (line.id)}
        {@const color = logColor(line.text)}
        <div class="log-line">
          <span class="dim log-meta">{String(line.id).padStart(2, "0")} │ {line.time} │</span>
          <span class:red={color === "red"} class:green={color === "green"}>{line.text}</span>
        </div>
      {/each}
    {/if}
  </section>

  <footer class="footer">
    <span class="dim">source: github.com/jaykerkar0405/PayBound</span>
    <span class="dim">a real broker + Ledger-emulated signer + Hedera testnet, not a mock</span>
  </footer>
</div>

<style>
  :root {
    --bg: #0a0a0a;
    --panel-bg: #111113;
    --border: #2a2a2e;
    --fg: #e4e4e7;
    --dim: #71717a;
    --green: #4ade80;
    --red: #f87171;
    --inverse-bg: #e4e4e7;
    --inverse-fg: #0a0a0a;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #fafafa;
      --panel-bg: #ffffff;
      --border: #d4d4d8;
      --fg: #18181b;
      --dim: #71717a;
      --green: #16a34a;
      --red: #dc2626;
      --inverse-bg: #18181b;
      --inverse-fg: #fafafa;
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
    max-width: 900px;
    margin: 0 auto;
    padding: 24px 16px 48px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-family: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
    font-size: 13px;
    line-height: 1.5;
  }

  .panel {
    border: 1px solid var(--border);
    background: var(--panel-bg);
    padding: 8px 12px;
    border-radius: 4px;
  }
  .panel-green {
    border-color: var(--green);
  }
  .panel-red {
    border-color: var(--red);
  }

  .panel-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 4px;
    letter-spacing: 0.04em;
  }

  .banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .banner-left {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .chip {
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .chip-inverse {
    background: var(--inverse-bg);
    color: var(--inverse-fg);
  }

  .trigger {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px 8px;
    text-align: center;
  }
  .run-button {
    font-family: inherit;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 10px 28px;
    background: var(--inverse-bg);
    color: var(--inverse-fg);
    border: 1px solid var(--inverse-bg);
    border-radius: 4px;
    cursor: pointer;
  }
  .run-button:hover:not(:disabled) {
    opacity: 0.85;
  }
  .run-button:disabled {
    background: transparent;
    color: var(--dim);
    border-color: var(--border);
    cursor: not-allowed;
  }
  .trigger-note {
    max-width: 60ch;
  }

  .stage-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 2px;
  }
  .connector {
    color: var(--dim);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 3px;
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 0.03em;
    border: 1px solid var(--border);
  }
  .badge-pending {
    color: var(--dim);
  }
  .badge-active {
    background: var(--inverse-bg);
    color: var(--inverse-fg);
    border-color: var(--inverse-bg);
  }
  .badge-done {
    color: var(--green);
    border-color: var(--green);
  }
  .badge-failed {
    color: var(--red);
    border-color: var(--red);
  }

  .columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  @media (max-width: 640px) {
    .columns {
      grid-template-columns: 1fr;
    }
  }

  .kv {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 1px 0;
    overflow-wrap: anywhere;
  }

  .txn {
    padding: 4px 0;
  }
  .txn-head {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .txn-url {
    padding-left: 16px;
    overflow-wrap: anywhere;
  }
  .txn-url a {
    color: var(--green);
    text-decoration: underline;
  }

  .event-log {
    max-height: 320px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .log-line {
    display: flex;
    gap: 6px;
    overflow-wrap: anywhere;
  }
  .log-meta {
    flex-shrink: 0;
    white-space: nowrap;
  }

  .footer {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px 4px 0;
  }

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
</style>
