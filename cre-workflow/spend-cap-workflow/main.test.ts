// PLACEHOLDER — implemented in Phase 2 (Issue #98).
//
// Will exercise onHttpTrigger from ./workflow.ts using a fake TeeRuntime
// (the SDK's public test surface does not yet ship a TEE runtime factory —
// see workflow.ts's header comment), covering: allow, deny, fallback to the
// "default" cap, permissive allow when neither resourceId nor "default"
// exists, and malformed/missing resourceId or exactAmount.
//
// Imports from ./workflow.ts, never from ./main.ts — see main.ts's header
// comment for why.
import { describe, expect, test } from "bun:test"
import { initWorkflow, onHttpTrigger } from "./workflow"

describe("onHttpTrigger (placeholder)", () => {
  test("is exported from workflow.ts and wired for main.ts to use", () => {
    expect(typeof onHttpTrigger).toBe("function")
    expect(typeof initWorkflow).toBe("function")
  })
})
