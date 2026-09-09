import { parentPort, workerData } from "node:worker_threads";
import { signHederaPayloadSync } from "./sign.js";
import type { SignWorkerRequest, SignWorkerResponse } from "./worker-protocol.js";

/**
 * The worker_threads entry point that keeps the actual (blocking) Ledger
 * device I/O off the server's main thread — see index.ts's
 * `signHederaPayload` for why this exists. Everything in this file runs in
 * its own V8 isolate; `signHederaPayloadSync` blocking here only stalls
 * this worker, never the process's main event loop.
 */
if (parentPort === null) {
  throw new Error("ledger-signer worker.ts must only be run as a node:worker_threads Worker");
}

/**
 * Test-only hook: simulates a slow/blocking device interaction (e.g. the
 * time a user takes to physically confirm on-device) without requiring
 * real hardware, by busy-blocking this worker thread for the given number
 * of milliseconds before proceeding. Never set outside tests — see
 * src/__tests__/worker-concurrency.test.ts.
 */
function simulateBlockingDelayForTests(): void {
  const delayMs = Number(process.env["LEDGER_SIGNER_TEST_BLOCK_MS"] ?? 0);
  if (delayMs <= 0) return;
  const until = Date.now() + delayMs;
  while (Date.now() < until) {
    /* intentional busy-block, standing in for a genuinely blocking HID call */
  }
}

function run(port: NonNullable<typeof parentPort>): void {
  try {
    simulateBlockingDelayForTests();

    const { rawTransactionBody, keyIndex } = workerData as SignWorkerRequest;
    const signature = signHederaPayloadSync(Buffer.from(rawTransactionBody), keyIndex);
    const response: SignWorkerResponse = { ok: true, signature };
    port.postMessage(response);
  } catch (error) {
    const response: SignWorkerResponse = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    port.postMessage(response);
  }
}

run(parentPort);
