/**
 * PayBound Agent Sandbox — deterministic scripted decision model (task 6.1a).
 *
 * `live-run.ts` needs *something* to pass as `runSandboxLifecycle`'s `model`
 * to prove the live entrypoint's plumbing — attestation handshake, real
 * capability issuance, tool-calling through the agent loop, and a real
 * payment call against a real Broker — end to end. A real LLM provider is
 * task 6.1b's job (`apps/sandbox` has no provider package yet).
 *
 * This is NOT a test mock: `live-run.ts` uses it to drive real tool
 * execution (`readContent` genuinely fetches, `pay` genuinely calls the
 * Broker) against a live server. It is built on `MockLanguageModelV3`
 * (`ai/test`) purely because that is the fixed-tool-call-sequence shape
 * `generateText` needs from *any* LanguageModelV3, and this is already the
 * project's own established pattern for driving `runAgentLoop` /
 * `runSandboxLifecycle` deterministically (see `__tests__/agent.test.ts`'s
 * `createMockModel`).
 *
 * The scripted decision is intentionally trivial and fixed — read the
 * content, then pay — rather than reasoning about what was read. That
 * unpredictability (a real model choosing whether/what to do based on
 * actual content) is exactly what 6.1b adds; this exists to prove
 * everything downstream of "the model decided to call a tool" already
 * works before that variable is introduced.
 */
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelArg } from "./agent.js";

export interface ScriptedDecisionModelOptions {
  /** URL to pass to the `readContent` tool call (mutually exclusive with `contentText`). */
  readonly contentUrl?: string | undefined;
  /** Direct text to pass to the `readContent` tool call. */
  readonly contentText?: string | undefined;
  /**
   * Resolves the real, Broker-issued capabilityId for the `pay` tool call.
   * Called lazily — only once the scripted model reaches its second step —
   * so it can close over a value that is only known after
   * `runSandboxLifecycle`'s Step 2 (capability issuance) has completed.
   */
  readonly getCapabilityId: () => string;
}

const USAGE_STUB = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 0, reasoning: 0 },
} as const;

/**
 * Creates a `LanguageModelArg` that deterministically calls `readContent`
 * on its first step, `pay` on its second, then stops.
 */
export function createScriptedDecisionModel(
  options: ScriptedDecisionModelOptions,
): LanguageModelArg {
  let step = 0;

  return new MockLanguageModelV3({
    doGenerate: async () => {
      const current = step;
      step += 1;

      if (current === 0) {
        const input = options.contentUrl
          ? { url: options.contentUrl }
          : { content: options.contentText ?? "" };
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
          usage: USAGE_STUB,
          content: [
            {
              type: "tool-call" as const,
              toolCallId: "scripted-read-1",
              toolName: "readContent",
              input: JSON.stringify(input),
            },
          ],
          warnings: [],
        };
      }

      if (current === 1) {
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
          usage: USAGE_STUB,
          content: [
            {
              type: "tool-call" as const,
              toolCallId: "scripted-pay-1",
              toolName: "pay",
              input: JSON.stringify({ capabilityId: options.getCapabilityId() }),
            },
          ],
          warnings: [],
        };
      }

      return {
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: { ...USAGE_STUB, outputTokens: { total: 10, text: 10, reasoning: 0 } },
        content: [{ type: "text" as const, text: "Scripted live run complete." }],
        warnings: [],
      };
    },
  });
}
