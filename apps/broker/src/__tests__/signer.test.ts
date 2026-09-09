import { describe, expect, it } from "vitest";
import { stubSign, ledgerSign, hederaTransactionSigner, resolveSigner } from "../signer.js";

describe("stubSign", () => {
  it("is deterministic for the same payload", () => {
    expect(stubSign("payload")).toBe(stubSign("payload"));
  });
});

describe("ledgerSign / hederaTransactionSigner", () => {
  // No physical Ledger device is attached in this environment, so these
  // exercise the real device-discovery failure path end to end (device.ts's
  // openLedgerDevice) rather than the on-device signing itself.

  it("rejects with a clear error when no Ledger device is connected", async () => {
    await expect(ledgerSign("payload")).rejects.toThrow(/no Ledger device found/);
  });

  it("rejects with the same device-discovery error via the signWith-compatible async seam", async () => {
    await expect(hederaTransactionSigner(0)(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /no Ledger device found/,
    );
  });
});

describe("resolveSigner", () => {
  // config.ledgerSigningEnabled (config.ts) is a one-time read of
  // LEDGER_SIGNING_ENABLED at module load; flipping it here would require
  // resetting the whole module graph, which collides with src/index.ts's
  // side effect of binding a real port on import (see health.test.ts). So
  // this only asserts the default-off branch, which is what every other
  // test in this suite relies on implicitly.
  it("defaults to stubSign when LEDGER_SIGNING_ENABLED is unset", () => {
    expect(resolveSigner()).toBe(stubSign);
  });
});
