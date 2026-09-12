// PLACEHOLDER — implemented in Phase 2 (Issue #98).
//
// Will register a `cre.handlerInTee` confidential-workflow HTTP handler that
// fetches SPEND_CAPS_JSON inside the enclave and evaluates the spend-cap
// decision the broker's checkSpendPolicy() (apps/broker/src/cre-policy.ts)
// currently stubs. Split out from main.ts — matching the real
// hello-confidential-workflows-ts template's structure — so this logic can
// be unit tested without executing Runner.newRunner(), which requires the
// real CRE WASM host and throws outside it.
import type { HTTPPayload, TeeRuntime } from "@chainlink/cre-sdk"

type Config = Record<string, never>

export const onHttpTrigger = (
  _runtime: TeeRuntime<Config>,
  _payload: HTTPPayload,
): string => {
  throw new Error("not implemented")
}

export const initWorkflow = (_config: Config) => {
  throw new Error("not implemented")
}
