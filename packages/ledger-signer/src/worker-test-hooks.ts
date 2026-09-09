/**
 * Test-only hook: simulates a slow/blocking device interaction (e.g. the
 * time a user takes to physically confirm on-device) without requiring
 * real hardware, by busy-blocking the calling worker thread for the given
 * number of milliseconds before proceeding. Never set outside tests — see
 * src/__tests__/worker-concurrency.test.ts. Shared by worker.ts (speculos)
 * and hid-worker.ts (hid) so both transports can be exercised under the
 * same simulated-delay test.
 */
export function simulateBlockingDelayForTests(): void {
  const delayMs = Number(process.env["LEDGER_SIGNER_TEST_BLOCK_MS"] ?? 0);
  if (delayMs <= 0) return;
  const until = Date.now() + delayMs;
  while (Date.now() < until) {
    /* intentional busy-block, standing in for a genuinely blocking HID call */
  }
}
