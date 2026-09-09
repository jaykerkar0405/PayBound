import { openLedgerDevice, readHidBlock, writeHidBlock } from "./device.js";
import { decodeHidBlock, encodeApduToHidBlocks, isHidDecodeComplete, type HidDecodeAccumulator } from "./hid-framing.js";
import { buildSignTransactionApdu, parseSignTransactionResponse } from "./apdu.js";

/**
 * Generous read timeout: unlike the other Ledger commands, signing pauses
 * on-device for the user to review and confirm the transaction, which can
 * take much longer than a typical APDU round-trip.
 */
const HID_READ_TIMEOUT_MS = 60_000;

function exchangeApdu(apdu: Buffer): Buffer {
  const device = openLedgerDevice();
  try {
    const channel = Math.floor(Math.random() * 0x10000);
    for (const block of encodeApduToHidBlocks(apdu, channel)) {
      writeHidBlock(device, block);
    }

    let acc: HidDecodeAccumulator | undefined;
    while (!isHidDecodeComplete(acc)) {
      const block = readHidBlock(device, HID_READ_TIMEOUT_MS);
      acc = decodeHidBlock(acc, block, channel);
    }
    return acc.data;
  } finally {
    device.close();
  }
}

/**
 * Signs `rawTransactionBody` via the Ledger Hedera app's INS_SIGN_TRANSACTION
 * (0x04) — a single-APDU exchange, per docs/LEDGER_HEDERA_RESEARCH.md (issue
 * 3.1a). Requires a connected, unlocked Ledger with the Hedera app open.
 *
 * BLOCKING: `node-hid`'s underlying write/read calls genuinely block the
 * calling thread for the duration of the device I/O — including however
 * long the user takes to physically confirm on-device. This must only ever
 * be called from within the worker thread `worker.ts` spawns, never
 * directly on a server's main thread (see index.ts's `signHederaPayload`,
 * which is the non-blocking entry point everything outside this package
 * should use).
 */
export function signHederaPayloadSync(rawTransactionBody: Buffer, keyIndex = 0): Buffer {
  const apdu = buildSignTransactionApdu(keyIndex, rawTransactionBody);
  const response = exchangeApdu(apdu);
  return parseSignTransactionResponse(response);
}
