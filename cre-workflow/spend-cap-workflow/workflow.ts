import { cre, decodeJson, type HTTPPayload, type TeeRuntime } from "@chainlink/cre-sdk"
import { z } from "zod"

// ─── Config Schema ──────────────────────────────────────────
// This workflow has no build-time config — the spend caps themselves live
// in the SPEND_CAPS secret (see ../secrets.yaml), fetched inside the
// enclave. The minimal schema Runner.newRunner({ configSchema }) actually
// requires is an empty object, matching config.staging.json.
export const configSchema = z.object({})
type Config = z.infer<typeof configSchema>

interface SpendCheckRequest {
  resourceId: string
  exactAmount: string
}

// ─── TEE HTTP Callback ──────────────────────────────────────
// Receives a `TeeRuntime`, not a `Runtime`. Everything here runs inside the
// enclave — matches the wire format the broker's checkSpendPolicy() sends
// and expects (apps/broker/src/cre-policy.ts L91-96 request, L105-117
// response).
export const onHttpTrigger = (runtime: TeeRuntime<Config>, payload: HTTPPayload): string => {
  const request = decodeJson(payload.input) as SpendCheckRequest
  if (!request.resourceId || !request.exactAmount) {
    return JSON.stringify({
      allowed: false,
      reason: "Missing resourceId or exactAmount",
    })
  }

  // ── Fetch the spend-caps secret inside the enclave ──
  // The Vault DON releases this secret only into an attested enclave, and
  // it is decrypted at the moment `getSecret()` runs. Never logged in full.
  const capsSecret = runtime.getSecret({ id: "SPEND_CAPS" }).result()
  const caps: Record<string, string> = JSON.parse(capsSecret.value)

  // Three-tier fallback: exact resourceId match -> "default" key -> if
  // neither exists, permissively allow (no cap configured for this resource).
  const capStr = caps[request.resourceId] ?? caps["default"]
  if (!capStr) {
    return JSON.stringify({
      allowed: true,
      reason: "No spend cap defined for resource",
    })
  }

  const amount = parseFloat(request.exactAmount)
  const cap = parseFloat(capStr)

  // Explicit lower-bound check — genuine defense in depth, not incidental.
  // Without this, a negative exactAmount (e.g. "-5") satisfies `amount <=
  // cap` for any positive cap and would be ALLOWed here, relying entirely
  // on apps/broker's own /issue schema to have already rejected it
  // upstream. This workflow shouldn't depend on that: a negative spend
  // amount is never valid on its own terms, regardless of what called it.
  // (A non-numeric exactAmount already denies safely via `NaN <= cap` /
  // `amount < 0` both being false/true respectively for NaN in the
  // expected direction — Number.isNaN below makes that explicit too,
  // rather than leaving it as an accidental side effect of NaN comparison
  // semantics.)
  if (Number.isNaN(amount) || amount < 0) {
    return JSON.stringify({
      allowed: false,
      reason: `Invalid exactAmount "${request.exactAmount}" — must be a non-negative number`,
    })
  }

  const allowed = amount <= cap

  // ⚠️ Logs are for simulation only and MUST be removed before deploying to
  // production to preserve the confidentiality offered by enclaves. Note
  // this never logs the caps table or the secret value itself.
  runtime.log(
    `Spend check: resource=${request.resourceId} amount=${amount} cap=${cap} → ${allowed ? "ALLOW" : "DENY"}`,
  )

  return JSON.stringify({
    allowed,
    reason: allowed
      ? "CRE policy: allowed"
      : `CRE policy: spend cap exceeded (requested ${request.exactAmount}, cap ${capStr})`,
  })
}

// ─── Workflow Init ──────────────────────────────────────────
export const initWorkflow = (_config: Config) => {
  const http = new cre.capabilities.HTTPCapability()

  return [
    // ── Register a TEE handler ──
    // `cre.handlerInTee` instead of `cre.handler` — this is the literal
    // prize requirement. `{}` as the TeeConstraint means any registered
    // TEE, any region (AWS Nitro in us-west-2 is currently the only one).
    cre.handlerInTee(http.trigger({}), onHttpTrigger, {}),
  ]
}
