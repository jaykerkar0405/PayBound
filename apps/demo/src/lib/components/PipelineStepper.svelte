<script lang="ts">
  import type { StageId } from "$lib/shared/events.js";
  import type { StageStatus } from "$lib/shared/state.js";

  let {
    order,
    stages,
    labels,
    spinnerFrame,
    spinnerFrames,
  }: {
    order: readonly StageId[];
    stages: Readonly<Record<StageId, StageStatus>>;
    labels: Record<StageId, string>;
    spinnerFrame: number;
    spinnerFrames: readonly string[];
  } = $props();
</script>

<ol class="stepper">
  {#each order as stage, i (stage)}
    {@const status = stages[stage]}
    <li
      class="step"
      class:done={status === "done"}
      class:failed={status === "failed"}
      class:active={status === "active"}
    >
      {#if i > 0}
        <span class="connector" class:filled={status !== "pending"}></span>
      {/if}
      <span class="node">
        {#if status === "done"}✓{:else if status === "failed"}✕{:else if status === "active"}{spinnerFrames[
            spinnerFrame
          ]}{/if}
      </span>
      <span class="label">{labels[stage]}</span>
    </li>
  {/each}
</ol>

<style>
  .stepper {
    display: flex;
    align-items: flex-start;
    list-style: none;
    margin: 0;
    padding: 0;
    min-width: 480px;
  }
  .step {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    min-width: 0;
  }
  .connector {
    position: absolute;
    top: 11px;
    right: 50%;
    width: 100%;
    height: 1px;
    background: var(--border);
  }
  .connector.filled {
    background: var(--border-strong);
  }
  .node {
    z-index: 1;
    width: 22px;
    height: 22px;
    flex: 0 0 auto;
    border-radius: 999px;
    border: 1px solid var(--border-strong);
    background: var(--bg);
    color: var(--fg-subtle);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
  }
  .step.done .node {
    border-color: var(--success);
    color: var(--success);
  }
  .step.failed .node {
    border-color: var(--danger);
    color: var(--danger);
  }
  .step.active .node {
    border-color: var(--accent);
    color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .label {
    margin-top: 6px;
    font-size: 12px;
    color: var(--fg-subtle);
    white-space: nowrap;
  }
  .step.done .label,
  .step.active .label,
  .step.failed .label {
    color: var(--fg);
  }
</style>
