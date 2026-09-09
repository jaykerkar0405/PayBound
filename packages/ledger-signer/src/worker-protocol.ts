/** The message shapes exchanged between index.ts (main thread) and worker.ts. */

export interface SignWorkerRequest {
  readonly rawTransactionBody: Uint8Array;
  readonly keyIndex: number;
}

export type SignWorkerResponse =
  | { readonly ok: true; readonly signature: Uint8Array }
  | { readonly ok: false; readonly error: string };
