// PLACEHOLDER — implemented in Phase 2 (Issue #98).
//
// Thin entrypoint, matching the real hello-confidential-workflows-ts
// template's main.ts shape: construct the CRE Runner and run the workflow
// defined in ./workflow.ts. Deliberately has no logic of its own — see
// ./workflow.ts for the confidential spend-cap handler, and
// ./main.test.ts for its tests (which import from ./workflow.ts, never
// from this file — Runner.newRunner() requires the real CRE WASM host and
// throws outside it, so this file cannot be imported by tests).
import { Runner } from "@chainlink/cre-sdk"
import { initWorkflow } from "./workflow"

type Config = Record<string, never>

export async function main() {
  const runner = await Runner.newRunner<Config>({})
  await runner.run(initWorkflow)
}

await main()
