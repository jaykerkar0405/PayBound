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
 * by re-implementation, not the app-specific JS wrapper. `device.ts`'s
 * `writeHidBlock` (the leading 0x00 HID report-ID byte prepended to every
 * write) and `index.ts`'s write-then-read exchange loop shape are likewise
 * modeled on that same file's `TransportNodeHid.js` counterpart.
 *
 * Source (verified directly, not guessed):
 *   Package:     @ledgerhq/hw-transport-node-hid-noevents
 *   Version:     6.36.0 (npm, dist-tag "latest" as of this port)
 *   Files:       lib/hid-framing.js, lib/TransportNodeHid.js (published
 *                build artifacts — these are what was actually read/ported)
 *   Repository:  https://github.com/LedgerHQ/ledger-live.git (per that
 *                package's own package.json "repository" field)
 *   gitHead:     dd0dea64b58e5a9125c8a422dcffd29e5ef6abec (recorded in the
 *                published package's own metadata as the commit it was
 *                built from; note this SHA is not currently reachable via
 *                GitHub's API on the live LedgerHQ/ledger-live repo — likely
 *                due to a later history rewrite/rebase in that monorepo —
 *                so it's cited as provenance, not as a live, browsable link)
 *
 * License note: this package's own package.json declares "Apache-2.0", but
 * the LICENSE.txt file actually bundled and published inside the package
 * (i.e. the license instrument that actually governs the distributed code)
 * is the MIT License, "Copyright (c) 2017-present Ledger
 * https://www.ledger.com/". That inconsistency is Ledger's own package
 * metadata, not something introduced here. Treating the bundled MIT text
 * as authoritative: MIT is compatible with this project's own MIT license
 * (see /LICENSE) and only requires the copyright/permission notice be
 * preserved in copies/substantial portions, which this comment does:
 *
 *   Copyright (c) 2017-present Ledger https://www.ledger.com/
 *   Permission is hereby granted, free of charge, to any person obtaining a
 *   copy of this software and associated documentation files (the
 *   "Software"), to deal in the Software without restriction, including
 *   without limitation the rights to use, copy, modify, merge, publish,
 *   distribute, sublicense, and/or sell copies of the Software, subject to
 *   the following conditions: the above copyright notice and this
 *   permission notice shall be included in all copies or substantial
 *   portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT
 *   WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
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
