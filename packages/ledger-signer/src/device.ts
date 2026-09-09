import { Socket } from "node:net";
import type { HID, Device } from "node-hid";

/** Ledger's registered USB vendor ID (`@ledgerhq/devices`' `ledgerUSBVendorId`). */
const LEDGER_USB_VENDOR_ID = 0x2c97;
/** HID report ID byte node-hid's `write()` expects prefixed to every report. */
const HID_REPORT_ID = 0x00;

function isLedgerHidInterface(device: Device): boolean {
  return process.platform === "win32" || process.platform === "darwin"
    ? device.usagePage === 0xffa0
    : device.interface === 0;
}

/**
 * Opens the first connected Ledger device's HID interface, or throws.
 *
 * Dynamically imports `node-hid` here rather than at module top-level so
 * that a worker thread using the `speculos` transport (the vast majority —
 * see worker.ts) never loads node-hid's native addon at all. This isn't
 * just laziness: node-hid isn't built context-aware, so loading it into a
 * *second* `worker_threads` Worker within the same process is unsupported
 * and intermittently throws "Module did not self-register" (see
 * nodejs/node#21481) — spawning a fresh Worker per sign call (index.ts)
 * means every unrelated Speculos-transport call was needlessly loading it
 * too, multiplying how often that race could be hit. Scoping the import to
 * only the `hid` transport's actual call path leaves exactly the two real
 * `hid`-transport loads this package ever does per process.
 */
export async function openLedgerDevice(): Promise<HID> {
  const { HID: HIDDevice, devices: listHidDevices } = await import("node-hid");
  const device = listHidDevices(LEDGER_USB_VENDOR_ID, 0x0).find(isLedgerHidInterface);
  if (device?.path === undefined) {
    throw new Error(
      "ledger device: no Ledger device found. Connect it, unlock it, and open the Hedera app.",
    );
  }
  return new HIDDevice(device.path);
}

/**
 * Writes one already-framed 64-byte HID block (see hid-framing.ts). The
 * leading report-ID byte is modeled on `@ledgerhq/hw-transport-node-hid-
 * noevents`'s `TransportNodeHid.js` `writeHID` — see hid-framing.ts's top
 * comment for the exact source/version/license attribution.
 */
export function writeHidBlock(device: HID, block: Buffer): void {
  device.write(Buffer.concat([Buffer.from([HID_REPORT_ID]), block]));
}

/**
 * Blocks (genuinely — `node-hid`'s `readTimeout` is a synchronous, blocking
 * native call) until one HID block is available or `timeoutMs` elapses.
 */
export function readHidBlock(device: HID, timeoutMs: number): Buffer {
  return Buffer.from(device.readTimeout(timeoutMs));
}

/**
 * Generous default: signing pauses on-device (or in Speculos, via its
 * button/API-driven review flow) for confirmation, same rationale as
 * sign.ts's `HID_READ_TIMEOUT_MS`.
 */
const SPECULOS_EXCHANGE_TIMEOUT_MS = 60_000;

/**
 * Speculos's own TCP APDU transport (distinct from Ledger's USB HID
 * framing in hid-framing.ts — Speculos exposes a plain length-prefixed
 * socket protocol, not HID reports). Confirmed directly against Speculos
 * source (not guessed):
 *
 *   Package:  ghcr.io/ledgerhq/speculos (Docker image, tag "latest" as
 *             pulled for this port)
 *   File:     speculos/mcu/apdu.py, class `ApduClient`
 *   Protocol: request  = 4-byte big-endian length prefix + raw APDU bytes
 *                        (`ApduClient.recv_packet`: reads a 4-byte BE size,
 *                        then exactly that many bytes as the APDU).
 *             response = 4-byte big-endian prefix of (APDU response length
 *                        minus the trailing 2-byte status word), followed
 *                        by the full APDU response (data + status word)
 *                        (`ApduClient.forward_to_client`: `size = len(packet)
 *                        - 2`, then sends `size.to_bytes(4, "big") +
 *                        packet` where `packet` still includes the 2-byte
 *                        SW) — so a client must read `4 + prefixValue + 2`
 *                        bytes total, and the last 2 of those are the SW.
 *                        This matches what apdu.ts's
 *                        `parseSignTransactionResponse` already expects
 *                        (data followed by a 2-byte status word), so no
 *                        response reshaping is needed here beyond stripping
 *                        the 4-byte length prefix itself.
 *
 * This is also the same wire protocol Ledger's own
 * `@ledgerhq/hw-transport-node-speculos` package (and the "ledgercomm" TCP
 * transport more generally) implement — reimplemented directly here rather
 * than depending on that package, consistent with this module's existing
 * from-source HID transport.
 */
export function exchangeApduOverSpeculos(apdu: Buffer, host: string, port: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let buffered = Buffer.alloc(0);
    let totalExpectedLength: number | undefined;
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    const timeout = setTimeout(
      () => fail(new Error("ledger device: timed out waiting for a Speculos APDU response")),
      SPECULOS_EXCHANGE_TIMEOUT_MS,
    );

    socket.once("error", (error) => fail(error));
    socket.once("connect", () => {
      const lengthPrefix = Buffer.alloc(4);
      lengthPrefix.writeUInt32BE(apdu.length, 0);
      socket.write(Buffer.concat([lengthPrefix, apdu]));
    });

    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);

      if (totalExpectedLength === undefined && buffered.length >= 4) {
        // 4-byte prefix (data length, excluding the trailing 2-byte SW) +
        // data + SW — see this function's doc comment above.
        totalExpectedLength = 4 + buffered.readUInt32BE(0) + 2;
      }

      if (totalExpectedLength !== undefined && buffered.length >= totalExpectedLength) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.end();
        resolve(buffered.subarray(4, totalExpectedLength));
      }
    });

    socket.connect(port, host);
  });
}
