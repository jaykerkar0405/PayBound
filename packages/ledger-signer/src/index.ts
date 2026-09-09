import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import type { LedgerTransportConfig, SignWorkerRequest, SignWorkerResponse } from "./worker-protocol.js";

export type { LedgerTransportConfig } from "./worker-protocol.js";

/**
 * Always points at the *compiled* worker.js, even when this module itself
 * is being run from TypeScript source (e.g. this package's own vitest
 * suite, or a dev run via tsx). worker_threads can only load plain JS —
 * loading a .ts file into a Worker via an `--import`/loader execArgv hook
 * hits a known tsx/Node bug (ERR_UNKNOWN_FILE_EXTENSION) — so rather than
 * fight that, the worker script is always the tsc-built artifact.
 * Consumers get this for free (they only ever import this package's built
 * dist/); running this package's own tests against src/ requires `pnpm
 * build` to have populated dist/ first (enforced by the "pretest" script
 * in package.json).
 */
function resolveWorkerScriptPath(): string {
  const isRunningFromSource = import.meta.url.endsWith(".ts");
  return fileURLToPath(new URL(isRunningFromSource ? "../dist/worker.js" : "./worker.js", import.meta.url));
}

/**
 * Signs `rawTransactionBody` via the Ledger Hedera app's INS_SIGN_TRANSACTION
 * (0x04) — a single-APDU exchange, per docs/LEDGER_HEDERA_RESEARCH.md (issue
 * 3.1a). Requires a connected, unlocked Ledger with the Hedera app open.
 *
 * Runs the actual (blocking) device I/O in a worker thread (worker.ts) —
 * `node-hid`'s underlying write/read calls genuinely block, for as long as
 * the user takes to physically confirm on-device, and this must never
 * stall a server's main event loop. This function itself is safe to call
 * directly from request-handling code; it returns as soon as it's
 * dispatched to the worker and resolves/rejects once the worker replies.
 *
 * `transport` selects `hid` (default — real Ledger over USB, documented but
 * not implemented/tested against real hardware, see this package's README)
 * or `speculos` (task 3.2, issue 45's substitute for real hardware — a
 * running Speculos emulator's TCP APDU port).
 */
export function signHederaPayload(
  rawTransactionBody: Buffer,
  keyIndex = 0,
  transport: LedgerTransportConfig = { kind: "hid" },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request: SignWorkerRequest = { rawTransactionBody, keyIndex, transport };
    const worker = new Worker(resolveWorkerScriptPath(), { workerData: request });

    worker.once("message", (response: SignWorkerResponse) => {
      if (response.ok) {
        resolve(Buffer.from(response.signature));
      } else {
        reject(new Error(response.error));
      }
      void worker.terminate();
    });

    worker.once("error", (error: Error) => {
      reject(error);
    });

    worker.once("exit", (exitCode: number) => {
      if (exitCode !== 0) {
        reject(new Error(`ledger-signer: worker exited unexpectedly with code ${exitCode}`));
      }
    });
  });
}
