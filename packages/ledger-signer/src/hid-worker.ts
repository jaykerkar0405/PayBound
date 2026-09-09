import { parentPort } from "node:worker_threads";
import { signHederaPayloadOverHid } from "./sign.js";
import { simulateBlockingDelayForTests } from "./worker-test-hooks.js";
import type { SignWorkerRequest, SignWorkerResponse } from "./worker-protocol.js";

/**
 * The `hid`-transport worker_threads entry point — deliberately separate
 * from worker.ts (used for `speculos`) and deliberately *persistent*
 * (handles every `hid`-transport request for the life of the process,
 * instead of one request per spawned Worker the way worker.ts/index.ts's
 * `signHederaPayload` normally works).
 *
 * Why: `node-hid`'s native addon isn't built context-aware, so loading it
 * into a *second* `worker_threads` Worker within the same OS process is
 * unsupported and throws "Module did not self-register" (nodejs/node#21481)
 * — confirmed here empirically: reproduces reliably on Node 24 (this
 * project's CI), not on Node 26 (used for local development while this was
 * fixed), for the *second* of two sequential, non-overlapping `hid`-
 * transport calls in one process, even after every other contributor to
 * that failure this codebase controlled for (lazy-loading node-hid so
 * unrelated `speculos` calls never load it — see device.ts's
 * `openLedgerDevice` — and awaiting full worker teardown between calls —
 * see index.ts) was already fixed. The only fix that's actually correct
 * regardless of Node version is to never load node-hid into a *second*
 * Worker in the first place: keep exactly one `hid`-transport Worker alive
 * for the process's lifetime and serialize every request through it.
 *
 * This also matches real hardware semantics, not just working around a
 * test failure: a physical Ledger device can only handle one request at a
 * time regardless, so serializing `hid`-transport calls through a single
 * persistent worker is the correct production design for whenever real
 * hardware support lands (see this package's README's "known limitation"
 * note), not merely a workaround.
 */
if (parentPort === null) {
  throw new Error("ledger-signer hid-worker.ts must only be run as a node:worker_threads Worker");
}

parentPort.on("message", (request: SignWorkerRequest) => {
  void (async () => {
    try {
      simulateBlockingDelayForTests();
      const signature = await signHederaPayloadOverHid(
        Buffer.from(request.rawTransactionBody),
        request.keyIndex,
      );
      const response: SignWorkerResponse = { ok: true, signature };
      parentPort?.postMessage(response);
    } catch (error) {
      const response: SignWorkerResponse = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      parentPort?.postMessage(response);
    }
  })();
});
