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
</script>

<div class="log-region">
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
