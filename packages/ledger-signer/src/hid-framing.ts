/**
 * Ledger's APDU-over-HID wire framing: wraps a raw APDU into fixed-size HID
 * report frames (and unwraps a device's response frames back into a raw
 * APDU response). This is transport plumbing, not APDU semantics — the APDU
 * itself is built/parsed in apdu.ts.
 *
 * Ported from `@ledgerhq/hw-transport-node-hid-noevents`'s `hid-framing.js`
 * (the official Ledger transport), since this project talks to the device's
 * HID interface directly (see device.ts) rather than depending on that
 * package — `hw-app-hedera` never exposes INS_SIGN_TRANSACTION (see
 * docs/LEDGER_HEDERA_RESEARCH.md), so only the framing layer is reused here,
 * by re-implementation, not the app-specific JS wrapper.
 */

const HID_PACKET_SIZE = 64;
const HID_TAG = 0x05;
const FRAME_HEADER_SIZE = 5; // channel(2) + tag(1) + sequence(2)

function uint16be(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value, 0);
  return buffer;
}

/** Splits `apdu` into one or more 64-byte HID frames addressed to `channel`. */
export function encodeApduToHidBlocks(apdu: Buffer, channel: number): Buffer[] {
  const lengthPrefixed = Buffer.concat([uint16be(apdu.length), apdu]);
  const blockSize = HID_PACKET_SIZE - FRAME_HEADER_SIZE;
  const blockCount = Math.ceil(lengthPrefixed.length / blockSize);
  const padded = Buffer.concat([
    lengthPrefixed,
    Buffer.alloc(blockCount * blockSize - lengthPrefixed.length),
  ]);

  const blocks: Buffer[] = [];
  for (let i = 0; i < blockCount; i++) {
    const head = Buffer.alloc(FRAME_HEADER_SIZE);
    head.writeUInt16BE(channel, 0);
    head.writeUInt8(HID_TAG, 2);
    head.writeUInt16BE(i, 3);
    blocks.push(Buffer.concat([head, padded.subarray(i * blockSize, (i + 1) * blockSize)]));
  }
  return blocks;
}

export interface HidDecodeAccumulator {
  readonly data: Buffer;
  readonly dataLength: number;
  readonly sequence: number;
}

/**
 * Folds one HID response frame into the running decode state. The first
 * frame carries the total response length (2 bytes) before its data;
 * subsequent frames are pure data continuations.
 */
export function decodeHidBlock(
  acc: HidDecodeAccumulator | undefined,
  block: Buffer,
  channel: number,
): HidDecodeAccumulator {
  const previous = acc ?? { data: Buffer.alloc(0), dataLength: 0, sequence: 0 };

  if (block.readUInt16BE(0) !== channel) {
    throw new Error("ledger hid-framing: response frame has an unexpected channel");
  }
  if (block.readUInt8(2) !== HID_TAG) {
    throw new Error("ledger hid-framing: response frame has an unexpected tag");
  }
  if (block.readUInt16BE(3) !== previous.sequence) {
    throw new Error("ledger hid-framing: response frame has an unexpected sequence number");
  }

  const dataLength = acc === undefined ? block.readUInt16BE(FRAME_HEADER_SIZE) : previous.dataLength;
  const chunk = block.subarray(acc === undefined ? FRAME_HEADER_SIZE + 2 : FRAME_HEADER_SIZE);
  let data = Buffer.concat([previous.data, chunk]);
  if (data.length > dataLength) {
    data = data.subarray(0, dataLength);
  }

  return { data, dataLength, sequence: previous.sequence + 1 };
}

/** True once enough frames have been folded to complete the response. */
export function isHidDecodeComplete(acc: HidDecodeAccumulator | undefined): acc is HidDecodeAccumulator {
  return acc !== undefined && acc.data.length === acc.dataLength;
}
