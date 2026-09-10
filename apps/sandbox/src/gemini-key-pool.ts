/**
 * PayBound Agent Sandbox — Gemini API key pool with RPM/RPD-aware
 * rotation, in front of the Gemini-primary/Groq-fallback logic PR #87
 * built (live-run.ts). This adds one layer before that fallback — it
 * does not replace or restructure it: `live-run.ts` still falls through
 * to Groq exactly as before, only now once every configured Gemini key
 * (not just the one) is unavailable.
 *
 * Distinguishing RPM from RPD (task requirement — confirmed empirically,
 * not assumed): a Gemini 429 body is a standard Google API
 * `google.rpc.QuotaFailure` error. Two real 429 responses were captured
 * live against `generativelanguage.googleapis.com` while building this:
 *
 *   RPM (per-minute window; key is fine, just cooling down):
 *     "quotaId": "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"
 *     "retryDelay": "23s"
 *
 *   RPD (per-day quota; key is genuinely done until Google's daily reset):
 *     "quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"
 *     "retryDelay": "22s"
 *
 * The `retryDelay` value is NOT a reliable discriminator between the
 * two — both came back short (~20s) in testing, contradicting the
 * intuitive assumption that an RPD violation implies a long,
 * near-24-hour retryDelay (Google's backoff hint here appears to just be
 * "try again shortly" regardless of which named quota bucket was hit).
 * `violations[].quotaId`'s literal "PerMinute"/"PerDay" text is the only
 * signal this module actually relies on; see `classifyGeminiQuotaError`.
 */
import { RetryError } from "ai";

export type GeminiQuotaKind = "rpm" | "rpd" | "other";

/** How long an RPM-limited key is treated as cooling down before being retried again (task requirement: "~60s"). */
export const RPM_COOLDOWN_MS = 60_000;

interface GoogleQuotaFailureDetail {
  readonly violations?: ReadonlyArray<{ readonly quotaId?: unknown }>;
}
interface GoogleErrorData {
  readonly error?: {
    readonly details?: ReadonlyArray<unknown> | null;
  };
}

function hasStatusCode(value: unknown): value is { statusCode?: number; data?: unknown } {
  return typeof value === "object" && value !== null && "statusCode" in value;
}

/**
 * Classifies a thrown Gemini call error. `ai`'s own internal retry loop
 * wraps the real error in a `RetryError` ("Failed after N attempts..."),
 * observed directly in PR #87/#88's live output — unwrapped via
 * `.lastError` first so the classification below inspects the actual
 * `APICallError` (from `@ai-sdk/provider`), not the wrapper. Duck-typed
 * (`hasStatusCode`) rather than `APICallError.isInstance` so this
 * doesn't break if a different error shape reaches here (e.g. a network
 * error with no `statusCode` at all) — `"other"` is the correct,
 * conservative answer in every case this can't confidently classify.
 */
export function classifyGeminiQuotaError(err: unknown): GeminiQuotaKind {
  const inner = RetryError.isInstance(err) ? err.lastError : err;
  if (!hasStatusCode(inner) || inner.statusCode !== 429) {
    return "other";
  }

  const details = (inner.data as GoogleErrorData | undefined)?.error?.details ?? [];
  for (const detail of details) {
    const violations = (detail as GoogleQuotaFailureDetail | null)?.violations;
    if (!Array.isArray(violations)) continue;
    for (const violation of violations) {
      const quotaId = violation?.quotaId;
      if (typeof quotaId !== "string") continue;
      if (quotaId.includes("PerDay")) return "rpd";
      if (quotaId.includes("PerMinute")) return "rpm";
    }
  }
  return "other";
}

export interface GeminiKeyPoolEntry {
  /** 1-based, for logging — never the key value itself. */
  readonly index: number;
  readonly key: string;
}

type KeyStatus = "available" | "cooling_down" | "exhausted_today";

interface KeyState {
  readonly index: number;
  readonly key: string;
  status: KeyStatus;
  /** Epoch ms; only meaningful while status === "cooling_down". */
  availableAt: number;
}

export interface GeminiKeyPool {
  readonly size: number;
  /**
   * Returns the next key ready to try right now (skipping exhausted-today
   * keys, and cooling-down keys whose window hasn't cleared yet), or
   * `undefined` if none are currently usable — the caller's cue to fall
   * through to Groq (requirement: never wait for a cooldown mid-run).
   */
  nextAvailable(): GeminiKeyPoolEntry | undefined;
  /** Call after a key successfully served a request. */
  reportSuccess(index: number): void;
  /** Call after a key hits an RPM 429 — cools it down for RPM_COOLDOWN_MS, not marked dead. */
  reportRpmExhausted(index: number): void;
  /** Call after a key hits an RPD 429 — marks it unavailable for the rest of this process's run. */
  reportRpdExhausted(index: number): void;
}

/**
 * Builds a rotation pool over `keys` (in the given order — callers pass
 * GEMINI_API_KEY_1/_2/_3 in that order, or a single-element array for the
 * GEMINI_API_KEY backward-compat case). All state is in-memory and
 * scoped to this pool instance / this process's lifetime — a fresh
 * `live-run.ts` invocation (e.g. each `e2e-live-demo.ts` spawn) starts
 * every key back at "available". That's a deliberate scope limit, not an
 * oversight: persisting "exhausted today" across separate process runs
 * would need a file or DB, which nothing in this project's dev/live-
 * verification tooling uses today. Within a single run, if a key is
 * still genuinely rate-limited from a previous run's burst, this pool
 * still does the right thing — it just re-discovers that via a fresh
 * 429 and rotates on, per the RPM handling above.
 */
export function createGeminiKeyPool(keys: readonly string[]): GeminiKeyPool {
  const states: KeyState[] = keys.map((key, i) => ({
    index: i + 1,
    key,
    status: "available",
    availableAt: 0,
  }));

  function findState(index: number): KeyState | undefined {
    return states.find((s) => s.index === index);
  }

  return {
    size: states.length,
    nextAvailable(): GeminiKeyPoolEntry | undefined {
      const now = Date.now();
      for (const state of states) {
        if (state.status === "exhausted_today") continue;
        if (state.status === "cooling_down") {
          if (now < state.availableAt) continue;
          state.status = "available";
        }
        return { index: state.index, key: state.key };
      }
      return undefined;
    },
    reportSuccess(index: number): void {
      const state = findState(index);
      if (state) state.status = "available";
    },
    reportRpmExhausted(index: number): void {
      const state = findState(index);
      if (state) {
        state.status = "cooling_down";
        state.availableAt = Date.now() + RPM_COOLDOWN_MS;
      }
    },
    reportRpdExhausted(index: number): void {
      const state = findState(index);
      if (state) state.status = "exhausted_today";
    },
  };
}
