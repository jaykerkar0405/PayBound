#!/usr/bin/env node
/**
 * Optional Speculos auto-approver for solo rehearsal — NOT for the actual
 * demo recording. Polls Speculos's own HTTP API for a "review transaction"
 * screen and presses through it, the same "page through, then confirm" flow
 * a human does on real hardware.
 *
 * This is a standalone extraction of the same pattern already used by
 * apps/broker/src/__tests__/global-setup.speculos.ts for automated test
 * runs — kept here so `scripts/live-stack.sh up --auto-approve` (or this
 * file directly) can reuse it outside of vitest, without touching that
 * test-only file. See docs/WALKTHROUGH.md's "A run hangs with no error"
 * troubleshooting entry for what this replaces when you'd rather not
 * click the Speculos window yourself every rehearsal run.
 *
 * Usage:
 *   node scripts/speculos-auto-approve.mjs
 */
const SPECULOS_API_PORT = Number(process.env.LEDGER_SPECULOS_API_PORT ?? 5000);
const SPECULOS_HOST = process.env.LEDGER_SPECULOS_HOST ?? "127.0.0.1";
const API_BASE = `http://${SPECULOS_HOST}:${SPECULOS_API_PORT}`;
const POLL_INTERVAL_MS = 150;
/** Matches the final "hold to approve"-style screen in app-hedera's review flow, not the intermediate field screens. */
const APPROVE_SCREEN_PATTERN = /confirm|hold to (approve|sign)/i;

async function currentScreenText() {
  const response = await fetch(`${API_BASE}/events?currentscreenonly=true`);
  const body = await response.json();
  return body.events.map((event) => event.text).join(" | ");
}

async function pressButton(button) {
  await fetch(`${API_BASE}/button/${button}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "press-and-release" }),
  });
}

async function tick() {
  try {
    const text = await currentScreenText();
    if (APPROVE_SCREEN_PATTERN.test(text)) {
      console.log(`[speculos-auto-approve] confirming: ${text}`);
      await pressButton("both");
    } else if (text.length > 0) {
      await pressButton("right");
    }
  } catch {
    // Speculos may be between screens/transactions — retried next tick.
  }
}

setInterval(() => void tick(), POLL_INTERVAL_MS);
console.log(`[speculos-auto-approve] polling ${API_BASE} for review screens...`);
