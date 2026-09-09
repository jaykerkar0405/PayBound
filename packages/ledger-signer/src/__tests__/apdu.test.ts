import { describe, expect, it } from "vitest";
import {
  buildSignTransactionApdu,
  parseSignTransactionResponse,
  HEDERA_APP_CLA,
  INS_SIGN_TRANSACTION,
} from "../apdu.js";

describe("buildSignTransactionApdu", () => {
  it("frames CLA, INS_SIGN_TRANSACTION, P1/P2, and Lc as a standard short APDU header", () => {
    const rawTransactionBody = Buffer.from([0xaa, 0xbb, 0xcc]);
    const apdu = buildSignTransactionApdu(0, rawTransactionBody);

    expect(apdu[0]).toBe(HEDERA_APP_CLA);
    expect(apdu[1]).toBe(INS_SIGN_TRANSACTION);
    expect(apdu[2]).toBe(0x00); // P1
    expect(apdu[3]).toBe(0x00); // P2
    expect(apdu[4]).toBe(4 + rawTransactionBody.length); // Lc: key index + body
  });

  it("encodes the key index as 4 little-endian bytes before the raw transaction body", () => {
    const rawTransactionBody = Buffer.from([0x01, 0x02]);
    const apdu = buildSignTransactionApdu(0x00000102, rawTransactionBody);

    const data = apdu.subarray(5);
    expect(Array.from(data.subarray(0, 4))).toEqual([0x02, 0x01, 0x00, 0x00]);
    expect(Array.from(data.subarray(4))).toEqual([0x01, 0x02]);
  });

  it("rejects a non-uint32 key index", () => {
    expect(() => buildSignTransactionApdu(-1, Buffer.alloc(0))).toThrow();
    expect(() => buildSignTransactionApdu(1.5, Buffer.alloc(0))).toThrow();
    expect(() => buildSignTransactionApdu(0x100000000, Buffer.alloc(0))).toThrow();
  });

  it("rejects a transaction body that would exceed the single-byte Lc limit", () => {
    // 4-byte key index + 252 bytes = 256 bytes of command data, one over the limit.
    const tooLarge = Buffer.alloc(252);
    expect(() => buildSignTransactionApdu(0, tooLarge)).toThrow(/too large/);
  });

  it("accepts a transaction body right at the single-byte Lc limit", () => {
    const atLimit = Buffer.alloc(251); // 4 + 251 = 255
    expect(() => buildSignTransactionApdu(0, atLimit)).not.toThrow();
  });
});

describe("parseSignTransactionResponse", () => {
  it("strips a trailing 0x9000 status word and returns the signature bytes", () => {
    const signature = Buffer.from([0x01, 0x02, 0x03]);
    const response = Buffer.concat([signature, Buffer.from([0x90, 0x00])]);

    expect(parseSignTransactionResponse(response)).toEqual(signature);
  });

  it("throws on a non-success status word (e.g. user rejection on-device)", () => {
    const response = Buffer.from([0x01, 0x02, 0x69, 0x85]); // SW_CONDITIONS_NOT_SATISFIED
    expect(() => parseSignTransactionResponse(response)).toThrow(/0x6985/);
  });

  it("throws on a response too short to contain a status word", () => {
    expect(() => parseSignTransactionResponse(Buffer.alloc(1))).toThrow(/too short/);
  });
});
