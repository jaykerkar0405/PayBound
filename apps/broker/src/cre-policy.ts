/**
 * Chainlink CRE confidential spend-policy check (task 5.2).
 *
 * This module implements the optional, gated pre-issuance policy check
 * defined in docs/CHAINLINK_CRE_DESIGN.md. It is DELIBERATELY non-load-
 * bearing: the check is skipped when disabled (`CRE_ENABLED !== "true"`),
 * and treated as "allowed" on any error, so issuance degrades gracefully
 * rather than becoming unavailable if the CRE gateway is unreachable.
 *
 * Removal of this entire module does not affect any of the 9 invariant
 * clauses defined in SECURITY_INVARIANT.md — see CAPABILITY_SPEC.md
 * §"Chainlink CRE optional policy check" for the explicit statement.
 */

/**
 * Result of a CRE policy check. `allowed` is the only field `issue.ts`
 * uses; `reason` is for logging/error responses only.
 */
export interface CrePolicyResult {
  readonly allowed: boolean;
  readonly reason: string;
}

export interface CrePolicyDeps {
  /**
   * Fetches a URL and returns the response. Defaults to the global
   * `fetch` — injectable so tests can assert on the exact call without
   * mocking any module or touching the network.
   */
  readonly fetchFn: typeof fetch;
  /**
   * Reads `CRE_ENABLED` lazily from `process.env` rather than the
   * frozen `config` snapshot — same pattern as `isSettlementConfigured()`
   * (settlement.ts) so tests can toggle per-case without re-importing.
   */
  readonly isEnabled: () => boolean;
  /**
   * Reads `CRE_GATEWAY_URL` lazily from `process.env`.
   */
  readonly gatewayUrl: () => string | undefined;
}

const defaultDeps: CrePolicyDeps = {
  fetchFn: fetch,
  isEnabled: () => process.env.CRE_ENABLED === "true",
  gatewayUrl: () => process.env.CRE_GATEWAY_URL,
};

/**
 * Evaluates the Chainlink CRE confidential spend-policy check for a
 * capability issuance request.
 *
 * **Gating behaviour (the critical requirement for task 5.2):**
 * - `CRE_ENABLED !== "true"` → returns `{ allowed: true }` immediately.
 *   Issuance is completely unaffected.
 * - `CRE_ENABLED=true` + gateway returns `{ allowed: true }` → passes.
 * - `CRE_ENABLED=true` + gateway returns `{ allowed: false }` → blocks
 *   issuance (caller returns 403).
 * - `CRE_ENABLED=true` + any error (network, timeout, bad JSON, missing
 *   URL) → logs the error and returns `{ allowed: true }`. The check is
 *   optional; a broken gateway must never take /issue offline.
 *
 * **Wire format** — the gateway is called as:
 *   POST `{CRE_GATEWAY_URL}`
 *   Body: `{ "resourceId": "...", "exactAmount": "..." }`
 *   Expected response: `{ "allowed": true|false, "reason": "..." }`
 *
 * `deps` defaults to real `fetch` + lazy `process.env` reads; tests pass
 * a fake object directly, with no module mocking required.
 */
export async function checkSpendPolicy(
  resourceId: string,
  exactAmount: string,
  deps: CrePolicyDeps = defaultDeps,
): Promise<CrePolicyResult> {
  // Gate 1: check disabled — skip entirely, no network call made.
  if (!deps.isEnabled()) {
    return { allowed: true, reason: "CRE check disabled (CRE_ENABLED is not 'true')" };
  }

  const gatewayUrl = deps.gatewayUrl();

  // Gate 2: enabled but misconfigured (no URL) — fail-open with a log.
  if (gatewayUrl === undefined || gatewayUrl === "") {
    console.error(
      "[CRE] CRE_ENABLED=true but CRE_GATEWAY_URL is not set — skipping check (fail-open)",
    );
    return { allowed: true, reason: "CRE_GATEWAY_URL not configured — check skipped" };
  }

  try {
    const response = await deps.fetchFn(gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceId, exactAmount }),
    });

    if (!response.ok) {
      console.error(
        `[CRE] Gateway returned HTTP ${response.status} for resource ${resourceId} — skipping check (fail-open)`,
      );
      return { allowed: true, reason: `CRE gateway error: HTTP ${response.status}` };
    }

    const data = (await response.json()) as { allowed?: boolean; reason?: string };

    if (typeof data.allowed !== "boolean") {
      console.error(
        `[CRE] Gateway response missing 'allowed' boolean for resource ${resourceId} — skipping check (fail-open)`,
      );
      return { allowed: true, reason: "CRE gateway response malformed — check skipped" };
    }

    return {
      allowed: data.allowed,
      reason: data.reason ?? (data.allowed ? "CRE policy: allowed" : "CRE policy: spend cap exceeded"),
    };
  } catch (error) {
    // Network error, timeout, DNS failure, etc. — fail-open.
    console.error(
      `[CRE] Gateway unreachable for resource ${resourceId} — skipping check (fail-open): ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      allowed: true,
      reason: `CRE gateway unreachable — check skipped: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
