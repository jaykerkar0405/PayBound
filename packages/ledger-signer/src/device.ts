import { HID, devices as listHidDevices, type Device } from "node-hid";

/** Ledger's registered USB vendor ID (`@ledgerhq/devices`' `ledgerUSBVendorId`). */
const LEDGER_USB_VENDOR_ID = 0x2c97;
/** HID report ID byte node-hid's `write()` expects prefixed to every report. */
const HID_REPORT_ID = 0x00;

function isLedgerHidInterface(device: Device): boolean {
  return process.platform === "win32" || process.platform === "darwin"
    ? device.usagePage === 0xffa0
    : device.interface === 0;
}

/** Opens the first connected Ledger device's HID interface, or throws. */
export function openLedgerDevice(): HID {
  const device = listHidDevices(LEDGER_USB_VENDOR_ID, 0x0).find(isLedgerHidInterface);
  if (device?.path === undefined) {
    throw new Error(
      "ledger device: no Ledger device found. Connect it, unlock it, and open the Hedera app.",
    );
  }
  return new HID(device.path);
}

/** Writes one already-framed 64-byte HID block (see hid-framing.ts). */
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
