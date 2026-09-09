import { describe, expect, it } from "vitest";
import {
  decodeHidBlock,
  encodeApduToHidBlocks,
  isHidDecodeComplete,
  type HidDecodeAccumulator,
} from "../hid-framing.js";

/** Feeds `frames` through decodeHidBlock in order and returns the final accumulator. */
function decodeAll(frames: Buffer[], channel: number): HidDecodeAccumulator | undefined {
  let acc: HidDecodeAccumulator | undefined;
  for (const frame of frames) {
    acc = decodeHidBlock(acc, frame, channel);
  }
  return acc;
}

describe("HID framing (encode/decode round trip)", () => {
  // Both directions of the wire protocol (device requests and responses) use
  // the same frame format, so encoding a buffer as if it were an outgoing
  // APDU and decoding it back as if it were a response exercises the real
  // protocol symmetry end to end.

  it("round-trips a payload that fits in a single 64-byte HID frame", () => {
    const channel = 0x1234;
    const payload = Buffer.from("short payload", "utf8");

    const blocks = encodeApduToHidBlocks(payload, channel);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toHaveLength(64);

    const acc = decodeAll(blocks, channel);
    expect(isHidDecodeComplete(acc)).toBe(true);
    expect(acc?.data).toEqual(payload);
  });

  it("round-trips a payload spanning multiple HID frames", () => {
    const channel = 0xbeef;
    const payload = Buffer.alloc(200, 0x42); // > 59 bytes usable per frame

    const blocks = encodeApduToHidBlocks(payload, channel);
    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.every((b) => b.length === 64)).toBe(true);

    const acc = decodeAll(blocks, channel);
    expect(isHidDecodeComplete(acc)).toBe(true);
    expect(acc?.data).toEqual(payload);
  });

  it("rejects a frame addressed to a different channel", () => {
    const blocks = encodeApduToHidBlocks(Buffer.from([0x01]), 0x0001);
    expect(() => decodeHidBlock(undefined, blocks[0]!, 0x0002)).toThrow(/channel/);
  });

  it("rejects a frame with an unexpected sequence number", () => {
    const blocks = encodeApduToHidBlocks(Buffer.alloc(200), 0x0001);
    // Skip the first frame (sequence 0), feeding sequence 1 as if it were first.
    expect(() => decodeHidBlock(undefined, blocks[1]!, 0x0001)).toThrow(/sequence/);
  });

  it("is not complete until every expected byte has arrived", () => {
    const channel = 0x0042;
    const blocks = encodeApduToHidBlocks(Buffer.alloc(200), channel);

    let acc: HidDecodeAccumulator | undefined;
    for (const block of blocks.slice(0, -1)) {
      acc = decodeHidBlock(acc, block, channel);
      expect(isHidDecodeComplete(acc)).toBe(false);
    }
    acc = decodeHidBlock(acc, blocks.at(-1)!, channel);
    expect(isHidDecodeComplete(acc)).toBe(true);
  });
});
