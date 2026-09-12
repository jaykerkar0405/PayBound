import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { reserveSlot } from "$lib/server/rate-limiter.js";
import { startRun } from "$lib/server/run-manager.js";

/**
 * Triggers one real e2e:live run against this deployment's own configured
 * broker/gated-content-service. Rate-limited (see rate-limiter.ts) since
 * every call spends real API quota and real testnet HBAR.
 */
export const POST: RequestHandler = async () => {
  const decision = reserveSlot();
  if (!decision.allowed) {
    return json(
      { error: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds ?? 60) } },
    );
  }

  const runId = startRun();
  return json({ runId });
};
