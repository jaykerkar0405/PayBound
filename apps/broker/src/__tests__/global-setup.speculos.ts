import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config } from "../config.js";

/**
 * Vitest `globalSetup` (task 1.8 fix, issue "broker tests fail on a fresh
 * checkout"): automatically provisions a Speculos instance for the life of
 * one `vitest run`, so `pnpm test` needs zero manual setup even though
 * `config.ledgerSigningEnabled`/`config.ledgerTransport` default to the real
 * Ledger-backed signer against Speculos (task 3.2, issue 45).
 *
 * Runs once, in vitest's main process, before any test file loads — unlike
 * `setupFiles`, this doesn't depend on `isolate: false` to avoid running
 * once per file. It:
 *
 *  1. Checks whether a Speculos instance is already reachable (e.g. a dev
 *     running `packages/ledger-signer/speculos/start.sh` themselves) — if
 *     so, uses it as-is and never touches its lifecycle.
 *  2. Otherwise, starts one itself via `docker run -d`, using the exact
 *     image/app/seed `start.sh` uses, and tears it down in the returned
 *     teardown — but only the instance it started.
 *  3. Runs the same on-device auto-approval poller this file's predecessor,
 *     `setup.speculos.ts`, used to run as a `setupFiles` hook (see git
 *     history) — the "page through, then confirm" flow a human does on real
 *     hardware.
 *
 * If Ledger signing is disabled (`LEDGER_SIGNING_ENABLED=false`) or pointed
 * at a non-Speculos transport (`LEDGER_TRANSPORT=hid`), this is a no-op:
 * nothing needs provisioning, and tests that still need a real device will
 * fail loudly on their own.
 */

const execFileAsync = promisify(execFile);

const CONTAINER_NAME = "paybound-speculos";
const IMAGE = "ghcr.io/ledgerhq/speculos@sha256:6ed9eefd51cddd862b746719af4cd7a3265fe43d0588c388359753cab8d46d11";
const SEED = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const SPECULOS_API_PORT = Number(process.env["LEDGER_SPECULOS_API_PORT"] ?? 5000);
const POLL_INTERVAL_MS = 150;
const READY_TIMEOUT_MS = 30_000;
/** Matches the final "hold to approve"-style screen in app-hedera's review flow, not the intermediate field screens. */
const APPROVE_SCREEN_PATTERN = /confirm|hold to (approve|sign)/i;

const speculosDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/ledger-signer/speculos",
);

function apiBase(): string {
  return `http://${config.ledgerSpeculosHost}:${SPECULOS_API_PORT}`;
}

async function currentScreenText(): Promise<string> {
  const response = await fetch(`${apiBase()}/events?currentscreenonly=true`);
  const body = (await response.json()) as { events: Array<{ text: string }> };
  return body.events.map((event) => event.text).join(" | ");
}

async function isHttpApiReachable(): Promise<boolean> {
  try {
    await currentScreenText();
    return true;
  } catch {
    return false;
  }
}

function isApduPortOpen(): Promise<boolean> {
  return new Promise((resolvePort) => {
    const socket = connect({ host: config.ledgerSpeculosHost, port: config.ledgerSpeculosPort });
    socket.once("connect", () => {
      socket.destroy();
      resolvePort(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolvePort(false);
    });
  });
}

async function isFullyReachable(): Promise<boolean> {
  return (await isHttpApiReachable()) && (await isApduPortOpen());
}

async function waitUntilReachable(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isFullyReachable()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `Speculos did not become reachable (HTTP API ${apiBase()}, APDU ${config.ledgerSpeculosHost}:` +
      `${config.ledgerSpeculosPort}) within ${timeoutMs}ms.`,
  );
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

async function dockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["version", "--format", "{{.Server.Version}}"]);
    return true;
  } catch {
    return false;
  }
}

async function startSpeculosContainer(): Promise<void> {
  await execFileAsync("docker", ["rm", "-f", CONTAINER_NAME]).catch(() => {});
  await execFileAsync("docker", [
    "run",
    "-d",
    "--name",
    CONTAINER_NAME,
    "-p",
    `${config.ledgerSpeculosPort}:9999`,
    "-p",
    `${SPECULOS_API_PORT}:5000`,
    "-v",
    `${speculosDir}:/speculos/local`,
    IMAGE,
    "--model",
    "nanox",
    "--display",
    "headless",
    "--apdu-port",
    "9999",
    "--api-port",
    "5000",
    "--seed",
    SEED,
    "/speculos/local/app-hedera.elf",
  ]);
}

export default async function setup(): Promise<(() => Promise<void>) | void> {
  if (!(config.ledgerSigningEnabled && config.ledgerTransport === "speculos")) {
    return;
  }

  let startedContainer = false;

  if (!(await isFullyReachable())) {
    if (!(await dockerAvailable())) {
      throw new Error(
        `LEDGER_SIGNING_ENABLED defaults to true and no Speculos instance is reachable at ${apiBase()}, ` +
          "and Docker isn't available to start one automatically. Either install/start Docker, or run " +
          "with LEDGER_SIGNING_ENABLED=false to use the stub signer instead.",
      );
    }

    await startSpeculosContainer();
    startedContainer = true;
    await waitUntilReachable(READY_TIMEOUT_MS);
  }

  const pollTimer = setInterval(() => void pollAndApprove(), POLL_INTERVAL_MS);

  return async () => {
    clearInterval(pollTimer);
    if (startedContainer) {
      await execFileAsync("docker", ["rm", "-f", CONTAINER_NAME]).catch(() => {});
    }
  };
}
