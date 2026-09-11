/**
 * Spawns the real `pnpm --filter broker e2e:live` command (the exact
 * `apps/broker/package.json#scripts.e2e-live` command, unmodified) as a
 * fully independent child process and tails its combined output.
 *
 * INDEPENDENCE, BY CONSTRUCTION (not just by convention) — this is the part
 * of the task that most needs to actually hold up, not just be claimed:
 *
 *   1. `detached: true` puts the child in its own process group. A Ctrl+C
 *      in the terminal sends SIGINT to the *foreground process group*; a
 *      detached child is not in it, so Ctrl+C-ing this dashboard cannot
 *      SIGINT the payment run.
 *   2. The child's stdout/stderr are redirected to a real log file on disk
 *      (`fs.openSync(..., "a")`), not piped through this process. This
 *      dashboard *tails that file* by polling its length and reading new
 *      bytes — it never holds the child's own stdout/stderr pipe open. If
 *      this dashboard is killed (any signal, including SIGKILL, or a crash),
 *      there is no pipe for the child to get EPIPE on and no descriptor of
 *      the child's that closing this process could affect.
 *   3. `child.unref()` lets this process exit without waiting on the child,
 *      and no `close`/`exit` listener here ever calls `child.kill()` — the
 *      child's lifecycle is never tied to this dashboard's.
 *
 * See apps/tui-dashboard/README.md for how this was verified against a real
 * run (kill -9 the dashboard mid-run; confirm the payment/settlement still
 * completes and is independently verifiable on the mirror node afterward).
 */
import { spawn } from "node:child_process";
import { openSync, closeSync, readSync, statSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BROKER_DIR = path.resolve(HERE, "../../broker");

const TAIL_POLL_INTERVAL_MS = 150;
const REPLAY_LINE_INTERVAL_MS = 120;

export interface RunnerCallbacks {
  readonly onLine: (line: string) => void;
  readonly onExit: (code: number | null) => void;
  readonly onSpawnError: (message: string) => void;
}

export interface RunnerHandle {
  readonly logPath: string;
  readonly stopTailing: () => void;
}

function tailFile(logPath: string, onLine: (line: string) => void): () => void {
  let offset = 0;
  let buffered = "";

  const timer = setInterval(() => {
    let size: number;
    try {
      size = statSync(logPath).size;
    } catch {
      return; // not created yet
    }
    if (size <= offset) return;

    const length = size - offset;
    const buf = Buffer.alloc(length);
    const fd = openSync(logPath, "r");
    try {
      readSync(fd, buf, 0, length, offset);
    } finally {
      closeSync(fd);
    }
    offset = size;

    buffered += buf.toString("utf-8");
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  }, TAIL_POLL_INTERVAL_MS);

  return () => clearInterval(timer);
}

/** Starts a real `e2e:live` run and tails its output. See this file's top doc comment for the independence guarantees. */
export function startE2ELiveRun(callbacks: RunnerCallbacks): RunnerHandle {
  const logDir = path.join(os.tmpdir(), "paybound-tui-dashboard");
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `e2e-live-${Date.now()}-${process.pid}.log`);

  const fd = openSync(logPath, "a");
  try {
    const child = spawn(
      "node",
      [
        "--env-file=.env.local",
        "--env-file=../sandbox/.env.local",
        "--import",
        "tsx/esm",
        "scripts/e2e-live-demo.ts",
      ],
      {
        cwd: BROKER_DIR,
        env: process.env,
        detached: true,
        stdio: ["ignore", fd, fd],
      },
    );
    child.on("error", (err) => callbacks.onSpawnError(err.message));
    child.unref();
  } catch (err) {
    callbacks.onSpawnError(err instanceof Error ? err.message : String(err));
  } finally {
    closeSync(fd);
  }

  const stopTailing = tailFile(logPath, callbacks.onLine);
  return { logPath, stopTailing };
}

/**
 * Dev/testing aid: replays a previously captured log file (e.g. one written
 * by a real `e2e:live` run under `os.tmpdir()/paybound-tui-dashboard/`) at a
 * fixed pace, so the dashboard's rendering can be exercised repeatedly
 * without spending real Gemini/Hedera calls on every iteration. Never used
 * in the actual demo-recording path. See README.md.
 */
export function startReplay(filePath: string, callbacks: RunnerCallbacks): RunnerHandle {
  let lines: string[];
  try {
    lines = readFileSync(filePath, "utf-8").split("\n");
  } catch (err) {
    callbacks.onSpawnError(err instanceof Error ? err.message : String(err));
    return { logPath: filePath, stopTailing: () => {} };
  }

  let i = 0;
  const timer = setInterval(() => {
    if (i >= lines.length) {
      clearInterval(timer);
      callbacks.onExit(0);
      return;
    }
    const line = lines[i];
    i += 1;
    if (line !== undefined) callbacks.onLine(line);
  }, REPLAY_LINE_INTERVAL_MS);

  return { logPath: filePath, stopTailing: () => clearInterval(timer) };
}
