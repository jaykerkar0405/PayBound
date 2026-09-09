import { afterAll } from "vitest";
import { config } from "../config.js";

/**
 * Test-only Speculos wiring for the broker test suite (task 3.2, issue 45):
 * `config.ledgerSigningEnabled` now defaults to true and
 * `config.ledgerTransport` to `speculos` (config.ts), so every test that
 * exercises the real `/pay` HTTP endpoint (property.test.ts,
 * pay-route.test.ts, ...) goes through the real Ledger-backed signer
 * against a running Speculos instance by default — see
 * packages/ledger-signer/speculos/README.md for what that is and how to
 * start it.
 *
 * This file does two things, for the lifetime of one `vitest run`:
 *
 *  1. Fails fast, with instructions, if Speculos isn't reachable — a
 *     silent hang, or a wall of unrelated-looking `ledgerSign` rejections
 *     across every property test, would be much harder to diagnose than
 *     one clear error up front.
 *  2. Auto-approves the on-device transaction review screen Speculos
 *     renders for every real sign — the same "page through, then confirm"
 *     flow a human does on real hardware (LedgerHQ/app-hedera's own
 *     ragger test suite drives it identically; see
 *     tests/standalone/test_hedera.py's NavInsID.RIGHT_CLICK /
 *     NavInsID.BOTH_CLICK sequences for a Nano-family device).
 *
 * This lives here, not in `@paybound/ledger-signer`, because it's
 * test/dev tooling specific to unattended Speculos runs — it has nothing
 * to do with the actual APDU transport (device.ts's
 * `exchangeApduOverSpeculos`), which is exactly as "dumb" as the real HID
 * transport and has no concept of a UI to drive; a real user (or nothing,
 * on real hardware run unattended) would normally do this instead.
 */

const SPECULOS_API_PORT = Number(process.env["LEDGER_SPECULOS_API_PORT"] ?? 5000);
const POLL_INTERVAL_MS = 150;
/** Matches the final "hold to approve"-style screen in app-hedera's review flow, not the intermediate field screens. */
const APPROVE_SCREEN_PATTERN = /confirm|hold to (approve|sign)/i;

function apiBase(): string {
  return `http://${config.ledgerSpeculosHost}:${SPECULOS_API_PORT}`;
}

async function currentScreenText(): Promise<string> {
  const response = await fetch(`${apiBase()}/events?currentscreenonly=true`);
  const body = (await response.json()) as { events: Array<{ text: string }> };
  return body.events.map((event) => event.text).join(" | ");
}

async function pressButton(button: "left" | "right" | "both"): Promise<void> {
  await fetch(`${apiBase()}/button/${button}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "press-and-release" }),
  });
}

async function pollAndApprove(): Promise<void> {
  try {
    const text = await currentScreenText();
    if (APPROVE_SCREEN_PATTERN.test(text)) {
      await pressButton("both");
    } else if (text.length > 0) {
      await pressButton("right");
    }
  } catch {
    // Speculos may be between screens/transactions; a missed poll is
    // caught on the next tick, POLL_INTERVAL_MS later.
  }
}

async function assertSpeculosReachable(): Promise<void> {
  try {
    await currentScreenText();
  } catch (error) {
    throw new Error(
      `Speculos not reachable at ${config.ledgerSpeculosHost}:${config.ledgerSpeculosPort} ` +
        `(API port ${SPECULOS_API_PORT}). LEDGER_SIGNING_ENABLED now defaults to true, so the ` +
        "broker test suite needs a running Speculos instance — start it with " +
        "`packages/ledger-signer/speculos/start.sh`, or set LEDGER_SIGNING_ENABLED=false to fall " +
        "back to the stub signer.",
      { cause: error },
    );
  }
}

let pollTimer: NodeJS.Timeout | undefined;

if (config.ledgerSigningEnabled && config.ledgerTransport === "speculos" && pollTimer === undefined) {
  await assertSpeculosReachable();
  pollTimer = setInterval(() => void pollAndApprove(), POLL_INTERVAL_MS);

  afterAll(() => {
    clearInterval(pollTimer);
    pollTimer = undefined;
  });
}
