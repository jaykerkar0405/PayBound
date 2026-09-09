import { afterEach, describe, expect, it } from "vitest";
import { signHederaPayload } from "../index.js";

/**
 * Proves the actual fix for the event-loop-blocking bug: `signHederaPayload`
 * must run the (genuinely blocking) device I/O off the main thread, so a
 * slow/pending sign — e.g. the time a user takes to physically confirm on a
 * Ledger — never stalls other in-flight work on the same process. Before
 * this fix, `node-hid`'s synchronous write/readTimeout calls ran directly
 * on the caller's thread and would have starved the event loop for the
 * full duration of the call.
 *
 * `worker.ts` has a test-only hook (LEDGER_SIGNER_TEST_BLOCK_MS) that
 * busy-blocks the worker thread for a fixed duration in place of real
 * device I/O — the same category of blocking operation, without requiring
 * hardware. If the fix works, that busy-block only stalls the worker;
 * the main thread stays free to run other async work concurrently.
 */
describe("signHederaPayload (worker-thread isolation)", () => {
  afterEach(() => {
    delete process.env["LEDGER_SIGNER_TEST_BLOCK_MS"];
  });

  it("does not block the main event loop while a slow sign is in-flight", async () => {
    const SIMULATED_SIGN_DELAY_MS = 300;
    process.env["LEDGER_SIGNER_TEST_BLOCK_MS"] = String(SIMULATED_SIGN_DELAY_MS);

    // Fires the slow "sign" without awaiting it yet — this is what a
    // concurrent second request (e.g. a health check or another payment
    // attempt) would be racing against on the real server.
    const signPromise = signHederaPayload(Buffer.from("payload"), 0);

    // Stands in for a concurrent request: a handful of macrotask/microtask
    // hops, timed. If the main thread were blocked by the sign call, this
    // would take as long as the sign call itself; if the worker is truly
    // isolated, it resolves almost immediately regardless.
    const concurrentStart = Date.now();
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const concurrentElapsedMs = Date.now() - concurrentStart;

    expect(concurrentElapsedMs).toBeLessThan(SIMULATED_SIGN_DELAY_MS / 2);

    // The slow sign itself still completes (with a device-not-found
    // rejection, since no hardware is attached here) — the point above is
    // only that it didn't block anything else while doing so.
    await expect(signPromise).rejects.toThrow(/no Ledger device found/);
  });
});
