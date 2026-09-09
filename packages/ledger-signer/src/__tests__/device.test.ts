import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { exchangeApduOverSpeculos } from "../device.js";

/**
 * Exercises `exchangeApduOverSpeculos`'s framing against a fake server that
 * speaks Speculos's own wire protocol (device.ts's doc comment on that
 * function cites the exact source: `speculos/mcu/apdu.py`'s `ApduClient`)
 * — not a real Speculos instance, so this covers the client-side framing
 * logic in isolation from anything device/app-specific.
 */
describe("exchangeApduOverSpeculos", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server !== undefined) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  function listen(
    onApdu: (apdu: Buffer, socket: import("node:net").Socket) => void,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      server = createServer((socket) => {
        let buffered = Buffer.alloc(0);
        let expectedLength: number | undefined;

        socket.on("data", (chunk: Buffer) => {
          buffered = Buffer.concat([buffered, chunk]);
          if (expectedLength === undefined && buffered.length >= 4) {
            expectedLength = 4 + buffered.readUInt32BE(0);
          }
          if (expectedLength !== undefined && buffered.length >= expectedLength) {
            onApdu(buffered.subarray(4, expectedLength), socket);
          }
        });
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server?.address();
        if (address === null || address === undefined || typeof address === "string") {
          reject(new Error("expected a bound TCP address"));
          return;
        }
        resolve(address.port);
      });
    });
  }

  it("sends a 4-byte length-prefixed APDU and parses a length-prefixed data+SW response", async () => {
    const requestApdu = Buffer.from([0xe0, 0x04, 0x00, 0x00, 0x02, 0xaa, 0xbb]);
    const signatureAndSw = Buffer.from([0x01, 0x02, 0x03, 0x90, 0x00]);

    const port = await listen((receivedApdu, socket) => {
      expect(receivedApdu).toEqual(requestApdu);

      const sizePrefix = Buffer.alloc(4);
      // Speculos's own quirk: the length prefix excludes the trailing
      // 2-byte status word even though the SW is still sent as part of the
      // same packet — see device.ts's doc comment.
      sizePrefix.writeUInt32BE(signatureAndSw.length - 2, 0);
      socket.write(Buffer.concat([sizePrefix, signatureAndSw]));
    });

    const response = await exchangeApduOverSpeculos(requestApdu, "127.0.0.1", port);
    expect(response).toEqual(signatureAndSw);
  });

  it("rejects when the connection fails (e.g. no Speculos instance listening)", async () => {
    await expect(exchangeApduOverSpeculos(Buffer.from([0x00]), "127.0.0.1", 1)).rejects.toThrow();
  });
});
