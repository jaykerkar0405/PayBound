/**
 * The custom APDU command this issue implements: INS_SIGN_TRANSACTION
 * (0x04), confirmed to exist in `LedgerHQ/app-hedera`'s device firmware as a
 * single-APDU exchange — see docs/LEDGER_HEDERA_RESEARCH.md. `hw-app-hedera`
 * (the JS host wrapper) never exposed a binding for it, only `getPublicKey`,
 * so this builds and parses the raw APDU directly instead of going through
 * that library.
 *
 * CLA/INS/offsets match `LedgerHQ/app-hedera`'s `src/ui/app_globals.h`
 * (CLA 0xE0) and `src/handlers.h` (INS_SIGN_TRANSACTION 0x04). The command
 * data layout (4-byte little-endian key index, then the raw transaction
 * body) matches `src/sign_transaction.c`'s `handle_sign_transaction`.
 */
export const HEDERA_APP_CLA = 0xe0;
export const INS_SIGN_TRANSACTION = 0x04;

const KEY_INDEX_LENGTH = 4;
/**
 * The device only parses a single-byte Lc (no extended-length APDU
 * support — `main.c` reads `G_io_apdu_buffer[OFFSET_LC]` as one byte), so
 * command data tops out at 255 bytes regardless of the app's own 512-byte
 * `MAX_TX_SIZE` buffer. This is the binding constraint for how large a
 * transaction body this single-exchange protocol can actually carry.
 */
const MAX_APDU_DATA_LENGTH = 255;

/** Builds the `INS_SIGN_TRANSACTION` command APDU for one raw transaction body. */
export function buildSignTransactionApdu(keyIndex: number, rawTransactionBody: Buffer): Buffer {
  if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex > 0xffffffff) {
    throw new Error(`ledger apdu: keyIndex must be a uint32, got ${keyIndex}`);
  }

  const data = Buffer.alloc(KEY_INDEX_LENGTH + rawTransactionBody.length);
  data.writeUInt32LE(keyIndex, 0);
  rawTransactionBody.copy(data, KEY_INDEX_LENGTH);

  if (data.length > MAX_APDU_DATA_LENGTH) {
    throw new Error(
      `ledger apdu: transaction body too large for a single INS_SIGN_TRANSACTION exchange ` +
        `(${data.length} bytes of command data, max ${MAX_APDU_DATA_LENGTH})`,
    );
  }

  return Buffer.concat([
    Buffer.from([HEDERA_APP_CLA, INS_SIGN_TRANSACTION, 0x00, 0x00, data.length]),
    data,
  ]);
}

/**
 * Strips and validates the trailing 2-byte status word from a device
 * response, returning the raw signature bytes. Throws on any non-success
 * status word (0x9000), including user rejection on the device.
 */
export function parseSignTransactionResponse(response: Buffer): Buffer {
  if (response.length < 2) {
    throw new Error("ledger apdu: response too short to contain a status word");
  }

  const statusWord = response.readUInt16BE(response.length - 2);
  if (statusWord !== 0x9000) {
    throw new Error(
      `ledger apdu: INS_SIGN_TRANSACTION failed with status word 0x${statusWord.toString(16).padStart(4, "0")}`,
    );
  }

  return response.subarray(0, response.length - 2);
}
