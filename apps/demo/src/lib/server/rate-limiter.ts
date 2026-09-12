/**
 * A deliberately simple, in-memory rate limiter for the public "run live
 * demo" trigger. Every click spends real money and real API quota — one
 * real Gemini call, tiny real testnet HBAR transfers, one real HCS message
 * — so this button cannot be left unthrottled on a public URL.
 *
 * In-memory is a real, intentional choice, not a shortcut: this app runs
 * as a single Render instance with no horizontal scaling, so there is
 * exactly one process for this state to live in. No Redis, no database
 * table, nothing to provision — restarting the service (a deploy, a
 * free-tier sleep/wake cycle) simply resets the window, which is fine for
 * a demo limiter.
 *
 * Two independent limits, both required to pass:
 *  - At most one run in flight at a time (a run takes minutes and spawns
 *    two real subprocesses — concurrent runs were never tested and are
 *    not assumed safe on a free-tier instance).
 *  - At most MAX_RUNS_PER_WINDOW runs per rolling window, so a burst of
 *    clicks (or a script) cannot run up real cost unboundedly.
 */

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_RUNS_PER_WINDOW = 6;

let runInProgress = false;
const recentRunTimestamps: number[] = [];

function pruneExpired(now: number): void {
  while (recentRunTimestamps.length > 0 && now - (recentRunTimestamps[0] ?? 0) > WINDOW_MS) {
    recentRunTimestamps.shift();
  }
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Present only when `allowed` is false — seconds until the caller should retry. */
  readonly retryAfterSeconds?: number;
  /** How many of the per-window budget remain, informational only. */
  readonly remainingThisWindow: number;
}

/** Checks whether a new run is currently allowed, WITHOUT reserving a slot — see `reserveSlot`. */
export function checkLimit(): RateLimitDecision {
  const now = Date.now();
  pruneExpired(now);

  if (runInProgress) {
    return { allowed: false, retryAfterSeconds: 20, remainingThisWindow: MAX_RUNS_PER_WINDOW - recentRunTimestamps.length };
  }

  if (recentRunTimestamps.length >= MAX_RUNS_PER_WINDOW) {
    const oldest = recentRunTimestamps[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSeconds, remainingThisWindow: 0 };
  }

  return { allowed: true, remainingThisWindow: MAX_RUNS_PER_WINDOW - recentRunTimestamps.length };
}

/**
 * Atomically checks and reserves a run slot — call this immediately before
 * spawning, not `checkLimit` followed by a separate reservation, or two
 * concurrent requests could both pass the check before either reserves.
 * (Node is single-threaded per request-handling tick for synchronous code
 * like this, so this function's own body cannot itself race.)
 */
export function reserveSlot(): RateLimitDecision {
  const decision = checkLimit();
  if (!decision.allowed) return decision;

  runInProgress = true;
  recentRunTimestamps.push(Date.now());
  return decision;
}

/** Must be called exactly once, whenever the run that reserved a slot finishes (success, failure, or crash) — see run-manager.ts. */
export function releaseSlot(): void {
  runInProgress = false;
}
