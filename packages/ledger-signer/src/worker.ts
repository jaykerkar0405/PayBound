import { parentPort, workerData } from "node:worker_threads";
import { signHederaPayloadOverHid, signHederaPayloadViaSpeculos } from "./sign.js";
import type { SignWorkerRequest, SignWorkerResponse } from "./worker-protocol.js";

/**
 * The worker_threads entry point that keeps the actual (blocking) Ledger
 * device I/O off the server's main thread — see index.ts's
 * `signHederaPayload` for why this exists. Everything in this file runs in
 * its own V8 isolate; `signHederaPayloadOverHid`'s device I/O blocking here
 * only stalls this worker, never the process's main event loop.
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

/**
 * Async (not the plain sync dispatch this used to be): the Speculos
 * transport has no synchronous socket API to block on the way `node-hid`'s
 * HID path does, so this awaits whichever transport `workerData.transport`
 * selects. Both branches still only ever run inside this worker thread —
 * async here does not reintroduce main-thread blocking, since this whole
 * file already only executes off the main thread (see this file's top
 * comment and index.ts's `signHederaPayload`).
 */
async function run(port: NonNullable<typeof parentPort>): Promise<void> {
  try {
    simulateBlockingDelayForTests();

    const { rawTransactionBody, keyIndex, transport } = workerData as SignWorkerRequest;
    const body = Buffer.from(rawTransactionBody);
    const signature =
      transport.kind === "speculos"
        ? await signHederaPayloadViaSpeculos(body, keyIndex, transport.host, transport.port)
        : await signHederaPayloadOverHid(body, keyIndex);
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

void run(parentPort);
