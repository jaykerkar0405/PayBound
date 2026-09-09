/** The message shapes exchanged between index.ts (main thread) and worker.ts. */

/**
 * Selects which physical/emulated transport a sign request talks to (task
 * 3.2, issue 45): `hid` is the original `node-hid` USB path (device.ts's
 * `openLedgerDevice`/`writeHidBlock`/`readHidBlock`), documented as a future
 * real-hardware option but not implemented/tested against real hardware
 * here — see the package README. `speculos` talks to a running Speculos
 * emulator instance (LedgerHQ/app-hedera under Speculos) over its TCP APDU
 * port, per device.ts's `exchangeApduOverSpeculos`.
 */
export type LedgerTransportConfig =
  | { readonly kind: "hid" }
  | { readonly kind: "speculos"; readonly host: string; readonly port: number };

export interface SignWorkerRequest {
  readonly rawTransactionBody: Uint8Array;
  readonly keyIndex: number;
  readonly transport: LedgerTransportConfig;
}

export type SignWorkerResponse =
  | { readonly ok: true; readonly signature: Uint8Array }
  | { readonly ok: false; readonly error: string };
