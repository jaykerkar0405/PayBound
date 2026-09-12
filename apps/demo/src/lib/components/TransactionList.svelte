<script lang="ts">
  import type { TxLogEntry } from "$lib/shared/state.js";

  let {
    txns,
    truncateMid,
  }: {
    txns: readonly TxLogEntry[];
    truncateMid: (s: string, max: number) => string;
  } = $props();
</script>

{#if txns.length === 0}
  <p class="empty">No transactions yet — they'll appear here once Hedera confirms one.</p>
{:else}
  <ul class="txn-list">
    {#each txns as tx (tx.id)}
      <li class="txn-row">
        <div class="txn-main">
          <span class="txn-label">{tx.label}</span>
          <span class="data txn-id">{truncateMid(tx.id, 34)}</span>
          {#if tx.sequenceNumber !== undefined}<span class="txn-seq">Seq {tx.sequenceNumber}</span>{/if}
        </div>
        <a class="txn-link" href={tx.url} target="_blank" rel="noopener noreferrer">View on HashScan ↗</a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .empty {
    margin: 0;
    font-size: 13px;
    color: var(--fg-subtle);
  }
  .txn-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .txn-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .txn-row + .txn-row {
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .txn-main {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
    font-size: 13px;
  }
  .txn-label {
    font-weight: 500;
    color: var(--fg);
  }
  .txn-id {
    color: var(--fg-muted);
    font-size: 12.5px;
  }
  .txn-seq {
    color: var(--fg-subtle);
    font-size: 12px;
  }
  .txn-link {
    align-self: flex-start;
    font-size: 12.5px;
    color: var(--fg-muted);
    text-decoration: none;
  }
  .txn-link:hover {
    color: var(--fg);
    text-decoration: underline;
  }
</style>
