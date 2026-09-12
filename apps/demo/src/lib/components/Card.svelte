<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title,
    strong = false,
    meta,
    children,
  }: {
    title: string;
    strong?: boolean;
    meta?: Snippet;
    children: Snippet;
  } = $props();
</script>

<section class="card" class:strong>
  <header class="card-head">
    <h2>{title}</h2>
    {#if meta}<div class="meta">{@render meta()}</div>{/if}
  </header>
  <div class="card-body">
    {@render children()}
  </div>
</section>

<style>
  .card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .card.strong {
    border-color: var(--border-strong);
  }
  .card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 11px 16px;
    border-bottom: 1px solid var(--border);
  }
  .card.strong .card-head {
    border-bottom-color: var(--border-strong);
  }
  h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
  }
  .meta {
    font-size: 12px;
  }
  .card-body {
    padding: 14px 16px;
  }
</style>
