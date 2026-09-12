/**
 * Spawns a real `pnpm --filter broker e2e:live` run (the exact command
 * `apps/broker/package.json`'s own `e2e:live` script runs — see that
 * package.json and apps/tui-dashboard/src/runner.ts, which spawns the
 * identical command locally for the terminal dashboard) and buffers/
 * broadcasts its combined stdout+stderr so any number of browser tabs can
 * watch the same run over SSE.
 *
 * This is the ONLY place in this app that touches process spawning or the
 * rate limiter — routes just call into this module.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { releaseSlot } from "./rate-limiter.js";

/**
 * Deliberately computed from `process.cwd()`, NOT `import.meta.url` — this
 * module gets bundled by SvelteKit's build (adapter-node) into
 * `build/server/chunks/...`, physically relocating the file, which would
 * silently break an `import.meta.url`-relative path computed against the
 * *source* file's location (confirmed the hard way: it resolved to a
 * nonexistent directory and `spawn("node", ...)` failed with a misleading
 * ENOENT). `process.cwd()` is stable instead: both `pnpm --filter demo
 * start` (Render) and a direct `node build/index.js` run from `apps/demo/`
 * (local) execute with cwd = `apps/demo`, one level below the monorepo's
 * `apps/` directory that `apps/broker` is a sibling of.
 */
const BROKER_DIR = path.resolve(process.cwd(), "../broker");

/** Generous outer bound on top of e2e-live-demo.ts's own internal timeouts (AGENT_TIMEOUT_MS default 180s + SETTLEMENT_TIMEOUT_MS default 60s + the separate x402 stage) — a safety net against a genuinely hung child, not the expected path. */
const HARD_KILL_MS = 6 * 60 * 1000;

/** How long a finished run's buffered output is kept in memory before being dropped, so a long-lived instance doesn't accumulate unbounded history. */
const RETENTION_MS = 30 * 60 * 1000;

export type RunStatus = "running" | "done" | "failed" | "spawn_error";

interface RunRecord {
  readonly id: string;
  readonly startedAt: number;
  status: RunStatus;
  exitCode: number | null;
  readonly lines: string[];
  readonly listeners: Set<(line: string) => void>;
  readonly doneListeners: Set<() => void>;
  child?: ChildProcess;
  finishedAt?: number;
}

const runs = new Map<string, RunRecord>();

function pruneOldRuns(): void {
  const now = Date.now();
  for (const [id, run] of runs) {
    if (run.finishedAt !== undefined && now - run.finishedAt > RETENTION_MS) {
      runs.delete(id);
    }
  }
}

function appendLine(run: RunRecord, line: string): void {
  run.lines.push(line);
  for (const listener of run.listeners) listener(line);
}

function finish(run: RunRecord, status: RunStatus, exitCode: number | null): void {
  if (run.status !== "running") return; // already finished (e.g. hard-kill fired after natural exit)
  run.status = status;
  run.exitCode = exitCode;
  run.finishedAt = Date.now();
  releaseSlot();
  for (const listener of run.doneListeners) listener();
}

/**
 * Splits a stream of arbitrary chunks into complete lines, buffering any
 * trailing partial line across chunk boundaries — required because a
 * single `PB_TUI_EVENT {...}` JSON line must never be delivered split in
 * two, or `parseLine` on the client can't parse it.
 */
function makeLineSplitter(onLine: (line: string) => void): (chunk: Buffer) => void {
  let carry = "";
  return (chunk: Buffer) => {
    carry += chunk.toString("utf-8");
    const parts = carry.split("\n");
    carry = parts.pop() ?? "";
    for (const part of parts) onLine(part);
  };
}

/** Starts a new run. Caller must have already reserved a rate-limit slot (see rate-limiter.ts) — this function releases it on completion, but does not check or reserve it itself. */
export function startRun(): string {
  pruneOldRuns();

  const id = randomUUID();
  const run: RunRecord = {
    id,
    startedAt: Date.now(),
    status: "running",
    exitCode: null,
    lines: [],
    listeners: new Set(),
    doneListeners: new Set(),
  };
  runs.set(id, run);

  let child: ChildProcess;
  try {
    child = spawn(
      "node",
      ["--import", "tsx/esm", "scripts/e2e-live-demo.ts"],
      {
        cwd: BROKER_DIR,
        env: process.env,
        // No shell needed/wanted — argv is fixed, nothing here is built
        // from request input.
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendLine(run, `[demo-web] failed to start run: ${message}`);
    finish(run, "spawn_error", null);
    return id;
  }

  run.child = child;

  const onStdout = makeLineSplitter((line) => appendLine(run, line));
  const onStderr = makeLineSplitter((line) => appendLine(run, line));
  child.stdout?.on("data", onStdout);
  child.stderr?.on("data", onStderr);

  child.on("error", (err) => {
    appendLine(run, `[demo-web] run process error: ${err.message}`);
  });

  const hardKillTimer = setTimeout(() => {
    if (run.status === "running") {
      appendLine(run, `[demo-web] run exceeded ${HARD_KILL_MS / 1000}s — terminating.`);
      child.kill("SIGKILL");
    }
  }, HARD_KILL_MS);

  child.on("close", (code, signal) => {
    clearTimeout(hardKillTimer);
    // Observed empirically: e2e-live-demo.ts's process can take several
    // extra seconds after printing its final success line to actually
    // exit (likely lingering fetch()/undici keep-alive sockets from the
    // mirror-node polling), and sometimes ends via a signal (code=null)
    // rather than a clean code-0 exit even after completing all its real
    // work successfully. This "done" event's `status` is therefore only
    // a best-effort process-exit classification, NOT the source of truth
    // for whether the run actually succeeded — the browser already knows
    // that independently and correctly from the real final_result/
    // x402_purchase_result PB_TUI_EVENT lines streamed live, well before
    // this event fires. Nothing currently depends on this field being
    // exactly right; it exists mainly to close the SSE connection.
    if (signal) appendLine(run, `[demo-web] process exited via signal ${signal} (code=${code})`);
    finish(run, code === 0 ? "done" : "failed", code);
  });

  return id;
}

export interface RunSnapshot {
  readonly id: string;
  readonly status: RunStatus;
  readonly exitCode: number | null;
  readonly lines: readonly string[];
}

export function getRunSnapshot(id: string): RunSnapshot | undefined {
  const run = runs.get(id);
  if (!run) return undefined;
  return { id: run.id, status: run.status, exitCode: run.exitCode, lines: run.lines };
}

/**
 * Subscribes to a run's future lines and completion, AFTER first replaying
 * everything already buffered — so a browser tab that connects a moment
 * after the run started (or reconnects) sees the full history, not just
 * what happens to arrive after it joins. Returns an unsubscribe function.
 */
export function subscribeToRun(
  id: string,
  onLine: (line: string) => void,
  onDone: () => void,
): (() => void) | undefined {
  const run = runs.get(id);
  if (!run) return undefined;

  for (const line of run.lines) onLine(line);
  if (run.status !== "running") {
    onDone();
    return () => {};
  }

  run.listeners.add(onLine);
  run.doneListeners.add(onDone);
  return () => {
    run.listeners.delete(onLine);
    run.doneListeners.delete(onDone);
  };
}
