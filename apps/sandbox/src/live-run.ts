/**
 * PayBound Agent Sandbox — Live Agent Entrypoint (Task 6.1a / 6.1b)
 *
 * A real, runnable driver for `runSandboxLifecycle` (agent.ts) against a
 * real, running Broker (`apps/broker`) — not a test file, not
 * `MockLanguageModelV3` confined to Vitest. This is the harness gap the
 * Phase 6 live-readiness investigation flagged: `index.ts`'s `main()` only
 * ever initializes attestation and logs two lines; `runSandboxLifecycle`
 * had no caller outside `__tests__/`.
 *
 * What this wires to REAL implementations (real HTTP calls to a Broker,
 * not mocks):
 *   - `performHandshake`  -> `performAttestationHandshake` (attest-handshake.ts)
 *   - `issueCapability`   -> a real `POST /issue` call, below
 *   - `readContentTool`   -> the default tool (tools/read-content.ts), real `fetch`
 *   - `payTool`           -> the default tool (tools/pay.ts), real `fetch` to `POST /pay`
 *
 * The language model (task 6.1b): defaults to `createScriptedDecisionModel`
 * (scripted-model.ts) — a deterministic, fixed read-then-pay sequence, no
 * API key or network call needed — since it's still the fastest/free way
 * to check the plumbing before spending real tokens. Set
 * `LIVE_RUN_MODEL=real` (with `GEMINI_API_KEY` set) to drive the SAME
 * agent loop, SAME tool definitions, and SAME system/user prompt with a
 * real model instead — Gemini (`@ai-sdk/google`) first, falling back to
 * Groq (`@ai-sdk/groq`) on any Gemini failure (network error, timeout,
 * non-OK response, or any other thrown error). This is the same
 * primary/fallback shape as the fiat402 project's
 * `apps/facilitator/src/policy/ai-advisory.ts` (`getAdvisoryRecommendation`)
 * — try the primary provider, log and fall through to the secondary on
 * any failure, log which provider actually served the request. No
 * Anthropic: no funded key was available for this project when 6.1b was
 * built, hence Gemini/Groq. See `runOnce()` below. Nothing else
 * in this file, agent.ts, or the tools changes between scripted and real
 * mode, or between which real provider ends up serving a given run.
 *
 * Prerequisites (see apps/broker/scripts/seed-live-agent-run.ts):
 *   1. A Broker running and reachable at BROKER_HOST:BROKER_PORT
 *      (`pnpm --filter broker dev` or `dev:live`).
 *   2. That Broker's registry/budget seeded for LIVE_AGENT_RUN_RESOURCE_ID
 *      / LIVE_AGENT_RUN_TASK_DEFINITION:
 *        cd apps/broker && node --import tsx/esm scripts/seed-live-agent-run.ts
 *   3. For LIVE_RUN_MODEL=real: GEMINI_API_KEY set (see .env.example);
 *      GROQ_API_KEY too if you want the fallback to actually work rather
 *      than just fail loudly when Gemini fails.
 *
 * Usage (from apps/sandbox/):
 *   pnpm dev:live                                  # scripted model (default, free)
 *   LIVE_RUN_MODEL=real pnpm dev:live               # real model (billed) — Gemini, falls back to Groq
 *   (or: node --env-file=.env.local --import tsx/esm src/live-run.ts)
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { capabilityIdSchema, type CapabilityId } from "@paybound/capability-spec";
import { config, brokerBaseUrl } from "./config.js";
import { getSandboxIdentity } from "./index.js";
import { runSandboxLifecycle, type LanguageModelArg, type RunAgentLoopResult } from "./agent.js";
import { performAttestationHandshake } from "./attest-handshake.js";
import { createScriptedDecisionModel } from "./scripted-model.js";

/**
 * Must match `apps/broker/scripts/seed-live-agent-run.ts`'s
 * `LIVE_AGENT_RUN_RESOURCE_ID` — see that file's doc comment on why this
 * value is duplicated rather than imported (sandbox's tsconfig `rootDir`
 * cannot reach outside `apps/sandbox/src`, and the Docker build strips
 * workspace deps entirely — see Dockerfile / attestation.ts).
 */
const LIVE_AGENT_RUN_RESOURCE_ID =
  process.env.LIVE_RUN_RESOURCE_ID ?? "764f644e-3ffb-4dcf-9552-c46272fb82c0";
/** Must match seed-live-agent-run.ts's `LIVE_AGENT_RUN_TASK_DEFINITION` in value. */
const LIVE_AGENT_RUN_TASK_DEFINITION = {
  agentRun: "Issue 6.1a live sandbox agent entrypoint verification",
};
/** Must match seed-live-agent-run.ts's `LIVE_AGENT_RUN_PRICE`. */
const LIVE_AGENT_RUN_PRICE = process.env.LIVE_RUN_EXACT_AMOUNT ?? "0.00000001";

/** Real untrusted content to read — a genuine outbound fetch, exercising the sandbox's network egress policy. Override via LIVE_RUN_CONTENT_URL. */
const CONTENT_URL = process.env.LIVE_RUN_CONTENT_URL ?? "https://example.com";

/**
 * "scripted" (default): createScriptedDecisionModel — free, deterministic,
 * no real API call. "real": Gemini first, Groq fallback — real tokens,
 * real billing. See this file's top doc comment.
 */
const MODEL_MODE: "scripted" | "real" = process.env.LIVE_RUN_MODEL === "real" ? "real" : "scripted";
/** Only consulted when MODEL_MODE === "real". Default matches fiat402's own choice. */
const GEMINI_MODEL_ID = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
/** Only consulted when MODEL_MODE === "real" and Gemini fails. Default matches fiat402's own choice. */
const GROQ_MODEL_ID = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";

/**
 * Which provider actually served a given run. "scripted" never makes a
 * real API call; "gemini"/"groq" report which one produced the result
 * (relevant since Gemini can fail over to Groq mid-run).
 */
type ProviderLabel = "scripted" | "gemini" | "groq";

/**
 * Published per-token pricing, $ / 1M tokens (input, output). Used ONLY
 * to print an estimated cost after a real run — not a billing source of
 * truth. Sourced 2026-09: Gemini from ai.google.dev/gemini-api/docs/pricing,
 * Groq from console.groq.com/docs/model/openai/gpt-oss-120b. Extend these
 * tables if GEMINI_MODEL/GROQ_MODEL is pointed at a model not listed
 * here; an unlisted model just skips the cost estimate.
 */
const GEMINI_PRICING_PER_MTOK: Readonly<Record<string, { input: number; output: number }>> = {
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
};
const GROQ_PRICING_PER_MTOK: Readonly<Record<string, { input: number; output: number }>> = {
  "openai/gpt-oss-120b": { input: 0.15, output: 0.6 },
};

/**
 * Builds the real-model, Gemini-primary/Groq-fallback pair used by
 * `runOnce()` below. Neither needs `getCapabilityId` the way the
 * scripted model does: both read the real capabilityId directly out of
 * the prompt text `runAgentLoop` constructs (agent.ts's `userPrompt`),
 * exactly the way a real deployment would — see this file's doc comment
 * and the prior investigation into DEFAULT_SYSTEM_PROMPT/userPrompt
 * sufficiency.
 */
function buildGeminiModel(): LanguageModelArg {
  if (!config.geminiApiKey) {
    throw new Error(
      "LIVE_RUN_MODEL=real requires GEMINI_API_KEY to be set (see .env.example). " +
        'Unset LIVE_RUN_MODEL (or set it to "scripted") to run without a real model.',
    );
  }
  const provider = createGoogleGenerativeAI({ apiKey: config.geminiApiKey });
  return provider(GEMINI_MODEL_ID);
}

function buildGroqModel(): LanguageModelArg {
  if (!config.groqApiKey) {
    throw new Error("GROQ_API_KEY is not set (see .env.example) — no fallback available.");
  }
  const provider = createGroq({ apiKey: config.groqApiKey });
  return provider(GROQ_MODEL_ID);
}

/** Prints token usage and, for a real run, an estimated cost for whichever provider actually served it. */
function logCostAwareness(
  totalUsage: { inputTokens: number | undefined; outputTokens: number | undefined },
  provider: ProviderLabel,
): void {
  const inputTokens = totalUsage.inputTokens ?? 0;
  const outputTokens = totalUsage.outputTokens ?? 0;
  console.log(`\nToken usage (${provider}) — input: ${inputTokens}, output: ${outputTokens}`);

  if (provider === "scripted") {
    console.log("Cost: $0.00 (scripted model — no real API call was made).");
    return;
  }

  const modelId = provider === "gemini" ? GEMINI_MODEL_ID : GROQ_MODEL_ID;
  const pricing = provider === "gemini" ? GEMINI_PRICING_PER_MTOK[modelId] : GROQ_PRICING_PER_MTOK[modelId];
  if (!pricing) {
    console.log(`Cost: unknown — no published pricing on record for "${modelId}" (${provider}) in this script.`);
    return;
  }

  const estimatedCost = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  console.log(
    `Estimated cost: ~$${estimatedCost.toFixed(6)} (${provider} "${modelId}", at published per-token rates; ` +
      "actual billing may differ, e.g. cached-token pricing not reflected here). " +
      "Rehearsing this run repeatedly for a demo adds up — use LIVE_RUN_MODEL=scripted for free dry runs.",
  );
}

interface IssueResponseBody {
  readonly capabilityId?: unknown;
  readonly expiry?: unknown;
  readonly error?: unknown;
  readonly message?: unknown;
}

/**
 * Calls the Broker's real `POST /issue` endpoint. Throws with the full
 * response detail on any non-200 — `runSandboxLifecycle` propagates this
 * out of `issueCapability`, and `main()` below reports it as the reason
 * the run failed, rather than silently returning a fake capability.
 */
async function issueCapabilityViaBroker(brokerBase: string, session: string): Promise<CapabilityId> {
  const response = await fetch(`${brokerBase}/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      taskDefinition: LIVE_AGENT_RUN_TASK_DEFINITION,
      resourceId: LIVE_AGENT_RUN_RESOURCE_ID,
      exactAmount: LIVE_AGENT_RUN_PRICE,
      paymentRequest: { detail: "live agent entrypoint run — issue 6.1a" },
      session,
    }),
  });

  const body = (await response.json().catch(() => undefined)) as IssueResponseBody | undefined;

  if (!response.ok) {
    throw new Error(
      `POST /issue failed with HTTP ${response.status}: ${JSON.stringify(body)}. ` +
        "Has the Broker been seeded? Run apps/broker/scripts/seed-live-agent-run.ts first.",
    );
  }

  return capabilityIdSchema.parse(body?.capabilityId);
}

/**
 * Fails fast with an actionable message if the Broker isn't reachable at
 * all, rather than letting the handshake/issuance calls surface a raw,
 * confusing transport error first.
 */
async function assertBrokerReachable(brokerBase: string): Promise<void> {
  try {
    const response = await fetch(`${brokerBase}/health`);
    if (!response.ok) {
      throw new Error(`Broker /health returned HTTP ${response.status}`);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach Broker at ${brokerBase}: ${detail}\n` +
        "Start it first: pnpm --filter broker dev  (or dev:live for real Hedera credentials).",
      { cause: err },
    );
  }
}

/**
 * Runs the full lifecycle once against `model`. `onCapabilityIssued` lets
 * the scripted model's `getCapabilityId` closure (main() below) observe
 * the real, Broker-issued capabilityId the moment it's known — a seam
 * only the scripted path needs (see buildGeminiModel's doc comment for
 * why the real providers don't).
 */
async function runLifecycleWithModel(
  model: LanguageModelArg,
  brokerBase: string,
  onCapabilityIssued?: (id: CapabilityId) => void,
): Promise<RunAgentLoopResult> {
  return runSandboxLifecycle({
    model,
    contentUrl: CONTENT_URL,
    maxSteps: 5,
    performHandshake: (attestation) => {
      console.log("Performing attestation channel handshake...");
      return performAttestationHandshake(attestation, { brokerBaseUrl: brokerBase });
    },
    issueCapability: async (session) => {
      console.log(`Requesting capability from Broker for resource ${LIVE_AGENT_RUN_RESOURCE_ID}...`);
      const id = await issueCapabilityViaBroker(brokerBase, session);
      console.log(`Capability issued: ${id}`);
      onCapabilityIssued?.(id);
      return id;
    },
  });
}

/**
 * Runs one full lifecycle for MODEL_MODE:
 *  - "scripted": single attempt, createScriptedDecisionModel.
 *  - "real": Gemini first; on ANY failure (network error, timeout,
 *    non-OK response, or any other thrown error — same fiat402
 *    ai-advisory.ts shape), falls back to Groq for a second full
 *    attempt. A fallback re-runs attestation + issues a fresh
 *    capability (the Gemini attempt's capability, if unused, simply
 *    expires unused) — simpler and more honest than trying to resume
 *    mid-loop with a different model, and matches fiat402's own
 *    "retry the whole operation with the next provider" shape.
 * Returns the result together with which provider actually served it.
 */
async function runOnce(brokerBase: string): Promise<{ result: RunAgentLoopResult; provider: ProviderLabel }> {
  if (MODEL_MODE === "scripted") {
    let issuedCapabilityId: CapabilityId | undefined;
    console.log("Model: scripted-model.ts (deterministic, no API key, no cost)");
    const model = createScriptedDecisionModel({
      contentUrl: CONTENT_URL,
      getCapabilityId: () => {
        if (!issuedCapabilityId) {
          throw new Error(
            "scripted model reached the pay step before a capabilityId was issued — " +
              "this would indicate runSandboxLifecycle's ordering guarantee broke",
          );
        }
        return issuedCapabilityId;
      },
    });
    const result = await runLifecycleWithModel(model, brokerBase, (id) => {
      issuedCapabilityId = id;
    });
    return { result, provider: "scripted" };
  }

  console.log(`Model: Gemini "${GEMINI_MODEL_ID}" (primary, real API calls — billed)`);
  try {
    const result = await runLifecycleWithModel(buildGeminiModel(), brokerBase);
    return { result, provider: "gemini" };
  } catch (err) {
    console.error(
      `[live-run] Gemini failed, falling back to Groq: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  console.log(`Model: Groq "${GROQ_MODEL_ID}" (fallback, real API calls — billed)`);
  const result = await runLifecycleWithModel(buildGroqModel(), brokerBase);
  return { result, provider: "groq" };
}

async function main(): Promise<void> {
  console.log("=== PayBound Agent Sandbox — Live Agent Entrypoint (Task 6.1a / 6.1b) ===");

  const brokerBase = brokerBaseUrl(config);
  console.log(`Broker: ${brokerBase}`);

  await assertBrokerReachable(brokerBase);
  console.log("Broker reachable.");

  const identity = getSandboxIdentity();
  console.log(`Workload identity (session): ${identity.publicKey.slice(0, 16)}...`);

  const { result, provider } = await runOnce(brokerBase);

  console.log(`\n--- Agent Loop Result (served by: ${provider}) ---`);
  console.log(`finishReason: ${result.finishReason}`);
  console.log(`steps: ${result.stepsCount}`);
  console.log(`toolCalls: ${JSON.stringify(result.toolCalls)}`);
  console.log(`readResults: ${JSON.stringify(result.readResults)}`);
  console.log(`paid: ${result.paid}`);
  console.log(`payResults: ${JSON.stringify(result.payResults, null, 2)}`);

  logCostAwareness(result.totalUsage, provider);

  if (result.paid) {
    console.log(
      "\n✓ SUCCESS: live agent entrypoint verified end-to-end — attestation handshake, " +
        "real capability issuance, agent tool-calling, and a real Broker-authorized payment " +
        "all completed against a live Broker.",
    );
    process.exitCode = 0;
    return;
  }

  console.error(
    "\n✗ Payment did not succeed. See payResults above for the Broker's reason " +
      "(and this process's earlier console.warn/[AUDIT] lines from tools/pay.ts).",
  );
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error("\n✗ live-run failed:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exitCode = 1;
});
