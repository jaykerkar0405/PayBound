<script lang="ts">
  import type { LogLine } from "$lib/shared/state.js";

  let {
    log,
    truncateMid,
    logColor,
  }: {
    log: readonly LogLine[];
    truncateMid: (s: string, max: number) => string;
    logColor: (text: string) => "red" | "green" | undefined;
  } = $props();

  let logRegion = $state<HTMLDivElement>();

  /**
   * Whether the user is at (or near) the bottom of the scroll region —
   * kept up to date on every scroll, including the programmatic ones this
   * component makes itself. New entries only auto-scroll the view while
   * this is true, so scrolling up to read earlier entries never gets
   * fought/overridden by the next event arriving.
   */
  let stickToBottom = $state(true);
  const BOTTOM_THRESHOLD_PX = 24;

  function handleScroll(): void {
    if (!logRegion) return;
    stickToBottom = logRegion.scrollHeight - logRegion.scrollTop - logRegion.clientHeight <= BOTTOM_THRESHOLD_PX;
  }

  $effect(() => {
    // Reactive dependency: re-run whenever the log grows (or resets to
    // empty at the start of a new run — re-arm sticky-scroll then,
    // regardless of where a previous run's log was left scrolled).
    if (log.length === 0) stickToBottom = true;
    if (stickToBottom && logRegion) {
      logRegion.scrollTop = logRegion.scrollHeight;
    }
  });
</script>

<div class="log-region" bind:this={logRegion} onscroll={handleScroll}>
  {#if log.length === 0}
    <p class="empty">Waiting for the telemetry stream…</p>
  {:else}
    {#each log as line (line.id)}
      {@const color = logColor(line.text)}
      <div class="log-row">
        <span class="data log-time">{line.time}</span>
        <span class="log-text" class:success={color === "green"} class:danger={color === "red"}
          >{truncateMid(line.text, 100)}</span
        >
      </div>
    {/each}
  {/if}
</div>

<style>
  .empty {
    margin: 0;
    font-size: 13px;
    color: var(--fg-subtle);
  }
  .log-region {
    max-height: 220px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .log-row {
    display: flex;
    gap: 10px;
    font-size: 12.5px;
    line-height: 1.5;
  }
  .log-time {
    flex: 0 0 auto;
    color: var(--fg-subtle);
  }
  .log-text {
    color: var(--fg-muted);
    overflow-wrap: anywhere;
  }
  .log-text.success {
    color: var(--success);
  }
  .log-text.danger {
    color: var(--danger);
  }
</style>
