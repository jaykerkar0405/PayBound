import { describe, expect } from "bun:test"
import type { TeeRuntime } from "@chainlink/cre-sdk"
import { test } from "@chainlink/cre-sdk/test"
import { initWorkflow, onHttpTrigger } from "./workflow"

const SPEND_CAPS_JSON = JSON.stringify({
  "api-call-gpt4": "0.50",
  "api-call-claude": "1.00",
  default: "0.25",
})

// The public test surface does not yet ship a TEE runtime factory
// (`newTestRuntime` returns a DON `Runtime`), so we stand up the small slice
// of `TeeRuntime` the handler actually uses: getSecret and log. Matches the
// hello-confidential-workflows-ts template's own workflow.test.ts pattern.
const makeFakeTeeRuntime = (secretValue: string = SPEND_CAPS_JSON) => {
  const logs: string[] = []

  const runtime = {
    config: {},
    getSecret: (request: { id?: string }) => ({
      result: () => ({ id: request.id, value: secretValue }),
    }),
    log: (message: string) => logs.push(message),
  }

  return { runtime: runtime as unknown as TeeRuntime<Record<string, never>>, logs }
}

const makePayload = (body: unknown) => ({
  input: new TextEncoder().encode(JSON.stringify(body)),
})

describe("onHttpTrigger", () => {
  test("allows when the amount is under the resource-specific cap", () => {
    const { runtime } = makeFakeTeeRuntime()

    const result = JSON.parse(
      onHttpTrigger(runtime, makePayload({ resourceId: "api-call-gpt4", exactAmount: "0.30" }) as never),
    )

    expect(result).toEqual({ allowed: true, reason: "CRE policy: allowed" })
  })

  test("denies when the amount is over the resource-specific cap", () => {
    const { runtime } = makeFakeTeeRuntime()

    const result = JSON.parse(
      onHttpTrigger(runtime, makePayload({ resourceId: "api-call-gpt4", exactAmount: "0.75" }) as never),
    )

    expect(result).toEqual({
      allowed: false,
      reason: "CRE policy: spend cap exceeded (requested 0.75, cap 0.50)",
    })
  })

  test("denies a negative exactAmount, even though it is numerically <= any positive cap", () => {
    const { runtime } = makeFakeTeeRuntime()

    const result = JSON.parse(
      onHttpTrigger(runtime, makePayload({ resourceId: "api-call-gpt4", exactAmount: "-5" }) as never),
    )

    expect(result).toEqual({
      allowed: false,
      reason: 'Invalid exactAmount "-5" — must be a non-negative number',
    })
  })

  test("denies a non-numeric exactAmount explicitly, not just via NaN comparison semantics", () => {
    const { runtime } = makeFakeTeeRuntime()

    const result = JSON.parse(
      onHttpTrigger(runtime, makePayload({ resourceId: "api-call-gpt4", exactAmount: "not-a-number" }) as never),
    )

    expect(result).toEqual({
      allowed: false,
      reason: 'Invalid exactAmount "not-a-number" — must be a non-negative number',
    })
  })

  test("allows a zero exactAmount (zero is a valid, non-negative spend)", () => {
    const { runtime } = makeFakeTeeRuntime()

    const result = JSON.parse(
      onHttpTrigger(runtime, makePayload({ resourceId: "api-call-gpt4", exactAmount: "0" }) as never),
    )

    expect(result).toEqual({ allowed: true, reason: "CRE policy: allowed" })
  })

  test('falls back to the "default" cap when resourceId is not in the table', () => {
    const { runtime } = makeFakeTeeRuntime()

    const result = JSON.parse(
      onHttpTrigger(runtime, makePayload({ resourceId: "unknown-resource", exactAmount: "0.20" }) as never),
    )

    expect(result).toEqual({ allowed: true, reason: "CRE policy: allowed" })

    const denied = JSON.parse(
      onHttpTrigger(runtime, makePayload({ resourceId: "unknown-resource", exactAmount: "0.30" }) as never),
    )

    expect(denied).toEqual({
      allowed: false,
      reason: "CRE policy: spend cap exceeded (requested 0.30, cap 0.25)",
    })
  })

  test('permissively allows when neither resourceId nor "default" exists in the table', () => {
    const { runtime } = makeFakeTeeRuntime(JSON.stringify({ "api-call-gpt4": "0.50" }))

    const result = JSON.parse(
      onHttpTrigger(runtime, makePayload({ resourceId: "unknown-resource", exactAmount: "999.00" }) as never),
    )

    expect(result).toEqual({ allowed: true, reason: "No spend cap defined for resource" })
  })

  test("rejects a request missing resourceId", () => {
    const { runtime } = makeFakeTeeRuntime()

    const result = JSON.parse(onHttpTrigger(runtime, makePayload({ exactAmount: "0.10" }) as never))

    expect(result).toEqual({ allowed: false, reason: "Missing resourceId or exactAmount" })
  })

  test("rejects a request missing exactAmount", () => {
    const { runtime } = makeFakeTeeRuntime()

    const result = JSON.parse(onHttpTrigger(runtime, makePayload({ resourceId: "api-call-gpt4" }) as never))

    expect(result).toEqual({ allowed: false, reason: "Missing resourceId or exactAmount" })
  })

  test("rejects a request with an empty-string resourceId", () => {
    const { runtime } = makeFakeTeeRuntime()

    const result = JSON.parse(
      onHttpTrigger(runtime, makePayload({ resourceId: "", exactAmount: "0.10" }) as never),
    )

    expect(result).toEqual({ allowed: false, reason: "Missing resourceId or exactAmount" })
  })

  test("logs the allow/deny decision without logging the caps table", () => {
    const { runtime, logs } = makeFakeTeeRuntime()

    onHttpTrigger(runtime, makePayload({ resourceId: "api-call-gpt4", exactAmount: "0.30" }) as never)

    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain("ALLOW")
    expect(logs[0]).not.toContain(SPEND_CAPS_JSON)
  })
})

describe("initWorkflow", () => {
  test("registers the HTTP handler with a TEE constraint", () => {
    const handlers = initWorkflow({})

    expect(handlers).toHaveLength(1)
    expect(handlers[0].fn).toBe(onHttpTrigger)

    // handlerInTee attaches TEE requirements; cre.handler does not.
    expect(handlers[0].requirements).toBeDefined()
  })
})
