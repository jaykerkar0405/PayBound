import { config } from "./config.js";

/**
 * Speculos's HTTP automation API port (distinct from `config.ledgerSpeculosPort`,
 * which is the raw APDU/signing socket) — the same default `start.sh`/
 * `global-setup.speculos.ts` use.
 */
const SPECULOS_API_PORT = Number(process.env["LEDGER_SPECULOS_API_PORT"] ?? 5000);
const POLL_INTERVAL_MS = 150;
/** Matches the final "hold to approve"-style screen in app-hedera's review flow, not the intermediate field screens. */
const APPROVE_SCREEN_PATTERN = /confirm|hold to (approve|sign)/i;

export function apiBase(): string {
  return `http://${config.ledgerSpeculosHost}:${SPECULOS_API_PORT}`;
}

export async function currentScreenText(): Promise<string> {
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
    // Speculos may be between screens/transactions, or briefly unreachable
    // (e.g. still starting up) — a missed poll is caught on the next tick,
    // POLL_INTERVAL_MS later.
  }
}

/**
 * Starts polling Speculos's HTTP automation API and auto-pressing through
 * whatever on-device review flow is showing — the same "page through with
 * right, confirm with both" sequence a human does during the live demo (see
 * docs/DEMO_SIGNING_APPROACH.md and packages/ledger-signer/speculos/README.md),
 * scripted instead of manual.
 *
 * Shared by two call sites with different reasons for wanting it:
 *  - `global-setup.speculos.ts`: `pnpm --filter broker test` needs Speculos's
 *    review screens to not block the test suite on a human.
 *  - `scripts/e2e-live-demo.ts`'s "auto-approved" demo mode: keeps that mode
 *    an honest run of the real Ledger-signing path (Speculos genuinely
 *    receives and processes the signing request) without requiring a human
 *    to stand at a keyboard for an unattended/judge-facing demo — see that
 *    file's own comment on why this is preferable to bypassing Speculos
 *    entirely via `LEDGER_SIGNING_ENABLED=false`.
 *
 * Harmless to run when no transaction is pending (an idle/home screen just
 * gets paged through with `right`, same as a human idly clicking through
 * menus would). Returns a stop function; calling it more than once is safe.
 */
export function startSpeculosAutoApprove(): () => void {
  const timer = setInterval(() => void pollAndApprove(), POLL_INTERVAL_MS);
  return () => clearInterval(timer);
}
