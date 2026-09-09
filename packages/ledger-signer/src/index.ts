import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import type { LedgerTransportConfig, SignWorkerRequest, SignWorkerResponse } from "./worker-protocol.js";

export type { LedgerTransportConfig } from "./worker-protocol.js";

/**
 * Always points at a *compiled* worker script, even when this module
 * itself is being run from TypeScript source (e.g. this package's own
 * vitest suite, or a dev run via tsx). worker_threads can only load plain
 * JS — loading a .ts file into a Worker via an `--import`/loader execArgv
 * hook hits a known tsx/Node bug (ERR_UNKNOWN_FILE_EXTENSION) — so rather
 * than fight that, the worker script is always the tsc-built artifact.
 * Consumers get this for free (they only ever import this package's built
 * dist/); running this package's own tests against src/ requires `pnpm
 * build` to have populated dist/ first (enforced by the "pretest" script
 * in package.json).
 */
function resolveWorkerScriptPath(fileName: "worker.js" | "hid-worker.js"): string {
  const isRunningFromSource = import.meta.url.endsWith(".ts");
  return fileURLToPath(
    new URL(isRunningFromSource ? `../dist/${fileName}` : `./${fileName}`, import.meta.url),
  );
}

/**
 * Runs one `speculos`-transport sign in a fresh, one-shot Worker
 * (worker.ts) — spawned per call and torn down immediately after. Safe to
 * do per call because Speculos has no native addon to load; see
 * `signViaHidWorker` below for why the `hid` transport can't use this same
 * spawn-fresh-per-call approach.
 */
function signViaSpeculosWorker(request: SignWorkerRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(resolveWorkerScriptPath("worker.js"), { workerData: request });
    // Set once a real response has arrived, so the "exit" handler below
    // knows a subsequent exit is this function's own `worker.terminate()`
    // call finishing, not a crash — `terminate()` does not guarantee exit
    // code 0 for a forced stop, so without this flag that self-initiated
    // exit would otherwise race the settlement below and reject a call
    // that actually succeeded.
    let responded = false;

    worker.once("message", (response: SignWorkerResponse) => {
      responded = true;
      // Awaited before settling (not fire-and-forget): this worker's exit
      // is confirmed complete before the caller's promise resolves, so a
      // caller awaiting each call in turn (as every caller in this codebase
      // does) never has two Speculos workers' lifecycles overlapping.
      void worker.terminate().finally(() => {
        if (response.ok) {
          resolve(Buffer.from(response.signature));
        } else {
          reject(new Error(response.error));
        }
      });
    });

    worker.once("error", (error: Error) => {
      reject(error);
    });

    worker.once("exit", (exitCode: number) => {
      if (!responded && exitCode !== 0) {
        reject(new Error(`ledger-signer: worker exited unexpectedly with code ${exitCode}`));
      }
    });
  });
}

/**
 * A single, persistent Worker for the `hid` transport, created lazily on
 * first use and reused for every subsequent `hid`-transport call for the
 * life of the process — deliberately not spawned fresh per call the way
 * `signViaSpeculosWorker` above does.
 *
 * Why: `node-hid`'s native addon isn't built context-aware, so loading it
 * into a *second* `worker_threads` Worker within the same process is
 * unsupported and throws "Module did not self-register" (nodejs/node#21481)
 * — confirmed here to reproduce on Node 24 for the second of two
 * sequential, non-overlapping `hid`-transport calls, even with node-hid
 * lazily imported (device.ts) and full worker teardown awaited between
 * calls. The only fix that holds regardless of Node version is to never
 * load node-hid into a second Worker in the first place: this package
 * keeps exactly one `hid`-transport Worker alive and serializes every
 * request through it (see hid-worker.ts's doc comment for the full
 * writeup, including why this also matches real hardware's own one-
 * request-at-a-time semantics rather than being just a workaround).
 */
let hidWorker: Worker | undefined;

function getHidWorker(): Worker {
  if (hidWorker !== undefined) return hidWorker;
  const worker = new Worker(resolveWorkerScriptPath("hid-worker.js"));
  // Self-heals on an unexpected crash: a future call gets a fresh worker
  // rather than one permanently wedged. If node-hid's second-load problem
  // is what caused the crash, a replacement will hit the same issue — an
  // acceptable gap for a transport that's documented as not implemented/
  // tested against real hardware (see this package's README).
  worker.once("exit", () => {
    if (hidWorker === worker) hidWorker = undefined;
  });
  hidWorker = worker;
  return worker;
}

/**
 * Sends one request to the persistent `hid` worker and resolves on its
 * next reply. Correlating by "next message" rather than a request ID is
 * safe only because every caller of `signHederaPayload` in this codebase
 * awaits one call before starting the next — see `getHidWorker`'s doc
 * comment for why this transport is serialized through one worker at all.
 */
function signViaHidWorker(request: SignWorkerRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const worker = getHidWorker();

    const onMessage = (response: SignWorkerResponse): void => {
      worker.off("error", onError);
      if (response.ok) {
        resolve(Buffer.from(response.signature));
      } else {
        reject(new Error(response.error));
      }
    };
    const onError = (error: Error): void => {
      worker.off("message", onMessage);
      reject(error);
    };

    worker.once("message", onMessage);
    worker.once("error", onError);
    worker.postMessage(request);
  });
}

/**
 * Signs `rawTransactionBody` via the Ledger Hedera app's INS_SIGN_TRANSACTION
 * (0x04) — a single-APDU exchange, per docs/LEDGER_HEDERA_RESEARCH.md (issue
 * 3.1a). Requires a connected, unlocked Ledger with the Hedera app open.
 *
 * Runs the actual (blocking) device I/O in a worker thread — `node-hid`'s
 * underlying write/read calls genuinely block, for as long as the user
 * takes to physically confirm on-device, and this must never stall a
 * server's main event loop. This function itself is safe to call directly
 * from request-handling code; it returns as soon as it's dispatched to a
 * worker and resolves/rejects once that worker replies.
 *
 * `transport` selects `hid` (default — real Ledger over USB, documented but
 * not implemented/tested against real hardware, see this package's README;
 * routed to a persistent worker, see `signViaHidWorker`) or `speculos`
 * (task 3.2, issue 45's substitute for real hardware — a running Speculos
 * emulator's TCP APDU port; routed to a fresh worker per call, see
 * `signViaSpeculosWorker`).
 */
export function signHederaPayload(
  rawTransactionBody: Buffer,
  keyIndex = 0,
  transport: LedgerTransportConfig = { kind: "hid" },
): Promise<Buffer> {
  const request: SignWorkerRequest = { rawTransactionBody, keyIndex, transport };
  return transport.kind === "hid" ? signViaHidWorker(request) : signViaSpeculosWorker(request);
}
