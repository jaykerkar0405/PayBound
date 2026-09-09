import { parentPort, workerData } from "node:worker_threads";
import { signHederaPayloadViaSpeculos } from "./sign.js";
import { simulateBlockingDelayForTests } from "./worker-test-hooks.js";
import type { SignWorkerRequest, SignWorkerResponse } from "./worker-protocol.js";

/**
 * The `speculos`-transport worker_threads entry point: one fresh Worker per
 * sign call (spawned and torn down by index.ts's `signHederaPayload`),
 * keeping the actual device I/O off the server's main thread. Speculos has
 * no native addon to load, so — unlike the `hid` transport (see
 * hid-worker.ts's doc comment for why that one is persistent instead) —
 * spawning fresh per call is both simple and safe here.
 */
if (parentPort === null) {
  throw new Error("ledger-signer worker.ts must only be run as a node:worker_threads Worker");
}

async function run(port: NonNullable<typeof parentPort>): Promise<void> {
  try {
    simulateBlockingDelayForTests();

    const { rawTransactionBody, keyIndex, transport } = workerData as SignWorkerRequest;
    if (transport.kind !== "speculos") {
      throw new Error(
        `ledger-signer worker.ts only handles the speculos transport; got "${transport.kind}" ` +
          "(hid-transport requests should be routed to hid-worker.ts by index.ts).",
      );
    }
    const body = Buffer.from(rawTransactionBody);
    const signature = await signHederaPayloadViaSpeculos(body, keyIndex, transport.host, transport.port);
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
