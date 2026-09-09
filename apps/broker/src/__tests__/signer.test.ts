import { describe, expect, it } from "vitest";
import { stubSign, ledgerSign, hederaTransactionSigner, resolveSigner } from "../signer.js";

describe("stubSign", () => {
  it("is deterministic for the same payload", () => {
    expect(stubSign("payload")).toBe(stubSign("payload"));
  });
});

describe("ledgerSign / hederaTransactionSigner", () => {
  // `config.ledgerTransport` (config.ts) now defaults to `speculos` (task
  // 3.2), so these force the `hid` transport explicitly via the
  // `transportOverride` parameter to exercise the real-hardware
  // device-discovery failure path end to end (device.ts's
  // `openLedgerDevice`) — no physical Ledger is attached in this
  // environment, and this documented-but-untested-against-real-hardware
  // path (see the ledger-signer package README) has no default coverage
  // otherwise.

  it("rejects with a clear error when no Ledger device is connected (hid transport)", async () => {
    await expect(ledgerSign("payload", { kind: "hid" })).rejects.toThrow(/no Ledger device found/);
  });

  it("rejects with the same device-discovery error via the signWith-compatible async seam (hid transport)", async () => {
    await expect(
      hederaTransactionSigner(0, { kind: "hid" })(new Uint8Array([1, 2, 3])),
    ).rejects.toThrow(/no Ledger device found/);
  });

  it("rejects with a connection error when no Speculos instance is reachable at the given address", async () => {
    // Port 1 is a privileged port nothing in this test run is listening on
    // — proves the speculos transport's own failure path independently of
    // whether the broker test suite's own Speculos instance happens to be
    // up (see setup.speculos.ts).
    await expect(
      ledgerSign("payload", { kind: "speculos", host: "127.0.0.1", port: 1 }),
    ).rejects.toThrow();
  });
});

describe("resolveSigner", () => {
  // config.ledgerSigningEnabled (config.ts) is a one-time read of
  // LEDGER_SIGNING_ENABLED at module load; flipping it here would require
  // resetting the whole module graph, which collides with src/index.ts's
  // side effect of binding a real port on import (see health.test.ts). So
  // this only asserts the default-on branch (task 3.2 flipped the
  // default), which is what every other test in this suite relies on
  // implicitly.
  it("defaults to ledgerSign when LEDGER_SIGNING_ENABLED is unset", () => {
    expect(resolveSigner()).toBe(ledgerSign);
  });
});
