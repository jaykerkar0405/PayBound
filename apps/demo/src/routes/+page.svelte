<script lang="ts">
  import {
    initialState,
    pushLog,
    reduceEvent,
    STAGE_ORDER,
    STAGE_LABELS,
    type DashboardState,
  } from "$lib/shared/state.js";
  import { parseLine } from "$lib/shared/events.js";
  import Card from "$lib/components/Card.svelte";
  import PipelineStepper from "$lib/components/PipelineStepper.svelte";
  import TransactionList from "$lib/components/TransactionList.svelte";
  import ActivityLog from "$lib/components/ActivityLog.svelte";

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
      ? "Starting…"
      : isRunning
        ? "Run in progress…"
        : retryAfterSeconds !== null
          ? `Retry in ${retryAfterSeconds}s`
          : "Run the live demo",
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

  /** Long values (tx IDs, hashes, URLs) are truncated in the middle rather than wrapped or clipped at the end, so the readable prefix and the verifiable suffix both stay visible. */
  function truncateMid(s: string, max: number): string {
    if (s.length <= max) return s;
    const keep = max - 1;
    const front = Math.ceil(keep * 0.6);
    const back = keep - front;
    return `${s.slice(0, front)}…${s.slice(s.length - back)}`;
  }

  // ink-spinner's "dots" frame set, cycled at the same ~80ms it uses, for
  // the pipeline stepper's one active-stage indicator.
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
  <title>PayBound — Agent Runtime</title>
</svelte:head>

<div class="page">
  <header class="topbar">
    <span class="brand">PayBound</span>
    <span class="live-pill" class:active={isRunning}>
      <span class="dot"></span>
      Live on Hedera testnet
    </span>
  </header>

  <section class="hero">
    <h1>The agent can request a payment.<br />It can't choose who gets paid, or how much.</h1>
    <p class="hero-sub">
      One click runs the real pipeline against Hedera testnet: an agent reads attacker-controlled content, the
      broker structurally can't be redirected, and a payment settles on-chain.
    </p>
    <button onclick={triggerRun} disabled={buttonDisabled} class="cta">{buttonLabel}</button>
    {#if rateLimitMessage}
      <p class="hero-note warn">{rateLimitMessage}</p>
    {:else}
      <p class="hero-note">Rate-limited to keep real API and HBAR cost bounded.</p>
    {/if}
  </section>

  <section class="pipeline">
    <div class="pipeline-head">
      <h2>Pipeline</h2>
      {#if pipelineFailed}
        <span class="status danger">Pipeline failed</span>
      {:else if completedCount === STAGE_ORDER.length}
        <span class="status success">All stages complete</span>
      {:else}
        <span class="status">Stage {completedCount + 1} of {STAGE_ORDER.length}</span>
      {/if}
    </div>
    <div class="pipeline-scroll">
      <PipelineStepper
        order={STAGE_ORDER}
        stages={dashboardState.stages}
        labels={STAGE_LABELS}
        {spinnerFrame}
        spinnerFrames={SPINNER_FRAMES}
      />
    </div>
  </section>

  <div class="grid-2">
    <Card title="Agent dispatch">
      {#snippet meta()}
        {#if dashboardState.lastToolCall}<span class="success">Dispatched</span
          >{:else}<span class="muted">Awaiting</span>{/if}
      {/snippet}
      <dl class="fact-list">
        <div class="fact"><dt>Function called</dt><dd class="data">pay(capability_id)</dd></div>
        <div class="fact">
          <dt>Capability</dt>
          <dd class="data">
            {dashboardState.lastToolCall ? truncateMid(dashboardState.lastToolCall.capabilityId, 22) : "pending"}
          </dd>
        </div>
        <div class="fact">
          <dt>Requested at</dt>
          <dd class="data muted">
            {dashboardState.lastToolCall?.timestamp ? `${dashboardState.lastToolCall.timestamp.slice(11, 19)} UTC` : "—"}
          </dd>
        </div>
      </dl>
      <p class="note">No amount or destination field exists to inject into.</p>
    </Card>

    <Card title="Run state" strong={isSucceeded || isFailed}>
      {#snippet meta()}
        {#if isSucceeded}<span class="success">Settled</span
          >{:else if isFailed}<span class="danger">Failed</span
          >{:else if dashboardState.phase === "waiting"}<span class="muted">Standby</span
          >{:else}<span class="accent">Syncing</span>{/if}
      {/snippet}
      <dl class="fact-list">
        <div class="fact"><dt>Scenario</dt><dd class="data">{dashboardState.scenario ?? "live-demo"}</dd></div>
        <div class="fact">
          <dt>Task hash</dt>
          <dd class="data">{dashboardState.taskHash ? shortHash(dashboardState.taskHash) : "seeding"}</dd>
        </div>
        <div class="fact">
          <dt>Hedera tx</dt>
          <dd class="data">{result?.hederaTransactionId ? truncateMid(result.hederaTransactionId, 22) : "pending"}</dd>
        </div>
      </dl>
      <p class="note" class:success={isSucceeded} class:danger={isFailed}>
        {#if isSucceeded}
          Confirmed on Hedera testnet.
        {:else if isFailed}
          Failed{dashboardState.errorMessage ? `: ${truncateMid(dashboardState.errorMessage, 60)}` : "."}
        {:else}
          Reconciling…
        {/if}
      </p>
    </Card>
  </div>

  <Card title="Transactions" strong={dashboardState.txns.length > 0}>
    {#snippet meta()}<span class="muted">{dashboardState.txns.length} confirmed</span>{/snippet}
    <TransactionList txns={dashboardState.txns} {truncateMid} />
  </Card>

  <Card title="Activity log">
    {#snippet meta()}<span class="muted">{dashboardState.log.length} events</span>{/snippet}
    <ActivityLog log={dashboardState.log} {truncateMid} {logColor} />
  </Card>

  <footer class="page-footer">
    <a href="https://github.com/jaykerkar0405/PayBound" target="_blank" rel="noopener noreferrer"
      >Source on GitHub</a
    >
    <span class="muted">Real broker, real Ledger-emulated signer, real Hedera testnet — not a simulation.</span>
  </footer>
</div>

<style>
  :root {
    --bg: #0a0a0a;
    --surface-1: #141414;
    --surface-2: #1c1c1c;
    --border: #262626;
    --border-strong: #404040;
    --fg: #fafafa;
    --fg-muted: #a1a1aa;
    --fg-subtle: #71717a;
    --accent: #3b82f6;
    --success: #34d399;
    --danger: #f87171;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #fafafa;
      --surface-1: #ffffff;
      --surface-2: #f4f4f5;
      --border: #e4e4e7;
      --border-strong: #d4d4d8;
      --fg: #18181b;
      --fg-muted: #52525b;
      --fg-subtle: #71717a;
      --accent: #2563eb;
      --success: #16a34a;
      --danger: #dc2626;
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

  /* Shared text-utility classes — declared :global so the child
     components (TransactionList, ActivityLog) that don't otherwise
     share this stylesheet's scoping can also use them. */
  :global(.data) {
    font-family: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
  }
  :global(.muted) {
    color: var(--fg-subtle);
  }
  :global(.accent) {
    color: var(--accent);
  }
  :global(.success) {
    color: var(--success);
  }
  :global(.danger) {
    color: var(--danger);
  }

  .page {
    max-width: 880px;
    margin: 0 auto;
    padding: 32px 20px 56px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .brand {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .live-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--fg-subtle);
  }
  .live-pill .dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--fg-subtle);
  }
  .live-pill.active {
    color: var(--accent);
  }
  .live-pill.active .dot {
    background: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.45;
    }
  }

  .hero {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 0 4px;
  }
  .hero h1 {
    margin: 0;
    font-size: clamp(20px, 3vw, 26px);
    font-weight: 600;
    line-height: 1.3;
    letter-spacing: -0.01em;
  }
  .hero-sub {
    margin: 0;
    max-width: 62ch;
    font-size: 14px;
    line-height: 1.6;
    color: var(--fg-muted);
  }
  .cta {
    margin-top: 4px;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    padding: 10px 18px;
    border-radius: 8px;
    border: 1px solid var(--fg);
    background: var(--fg);
    color: var(--bg);
    cursor: pointer;
  }
  .cta:hover:not(:disabled) {
    opacity: 0.88;
  }
  .cta:disabled {
    background: var(--surface-2);
    border-color: var(--border);
    color: var(--fg-subtle);
    cursor: not-allowed;
  }
  .hero-note {
    margin: 0;
    font-size: 12px;
    color: var(--fg-subtle);
    max-width: 62ch;
  }
  .hero-note.warn {
    color: var(--danger);
  }

  .pipeline {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .pipeline-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .pipeline-head h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
  }
  .status {
    font-size: 12px;
    color: var(--fg-subtle);
  }
  .status.success {
    color: var(--success);
  }
  .status.danger {
    color: var(--danger);
  }
  .pipeline-scroll {
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  @media (max-width: 640px) {
    .grid-2 {
      grid-template-columns: 1fr;
    }
  }

  .fact-list {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .fact {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
  }
  .fact dt {
    margin: 0;
    color: var(--fg-muted);
    font-weight: 400;
    flex: 0 0 auto;
  }
  .fact dd {
    margin: 0;
    color: var(--fg);
    text-align: right;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .note {
    margin: 10px 0 0;
    font-size: 12.5px;
    color: var(--fg-subtle);
    line-height: 1.5;
  }

  .page-footer {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 12px;
    padding-top: 8px;
  }
  .page-footer a {
    color: var(--fg-muted);
  }
  .page-footer a:hover {
    color: var(--fg);
  }
</style>
