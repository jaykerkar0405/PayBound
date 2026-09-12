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
 * `LIVE_RUN_MODEL=real` (with at least `GEMINI_API_KEY_1` set) to drive
 * the SAME agent loop, SAME tool definitions, and SAME system/user
 * prompt with a real model instead:
 *
 *   1. Gemini key pool (this file's follow-up to PR #87): up to 3 keys
 *      (`GEMINI_API_KEY_1`/`_2`/`_3`, config.ts), rotated with RPM/RPD
 *      awareness by `gemini-key-pool.ts`. An RPM 429 (the key is fine,
 *      just cooling down for its rolling ~60s window) moves to the next
 *      key immediately; an RPD 429 (the key is genuinely done until
 *      Google's daily reset) marks that key dead for the rest of this
 *      process's run and moves on. Both are distinguished by the real
 *      Gemini error body's `violations[].quotaId` — see
 *      gemini-key-pool.ts's top doc comment for the two actual response
 *      shapes this was built against.
 *   2. Groq fallback (`@ai-sdk/groq`, PR #87, unmodified): only reached
 *      once every configured Gemini key is unavailable right now (all
 *      cooling down, all RPD-exhausted, or some mix) — same
 *      primary/fallback shape as the fiat402 project's
 *      `apps/facilitator/src/policy/ai-advisory.ts`
 *      (`getAdvisoryRecommendation`): try the primary, log and fall
 *      through to the secondary on failure, log which one actually
 *      served the request.
 *
 * No Anthropic: no funded key was available for this project when 6.1b
 * was built, hence Gemini/Groq. See `runOnce()` below. Nothing else in
 * this file, agent.ts, or the tools changes between scripted and real
 * mode, or between which key/provider ends up serving a given run — a
 * caller with only `GEMINI_API_KEY` (PR #87/#88's original single-key
 * var) set still works exactly as before, as a one-key pool (config.ts).
 *
 * Prerequisites (see apps/broker/scripts/seed-live-agent-run.ts):
 *   1. A Broker running and reachable at BROKER_HOST:BROKER_PORT
 *      (`pnpm --filter broker dev` or `dev:live`).
 *   2. That Broker's registry/budget seeded for LIVE_AGENT_RUN_RESOURCE_ID
 *      / LIVE_AGENT_RUN_TASK_DEFINITION:
 *        cd apps/broker && node --import tsx/esm scripts/seed-live-agent-run.ts
 *   3. For LIVE_RUN_MODEL=real: GEMINI_API_KEY_1 (or GEMINI_API_KEY) set
 *      (see .env.example); GEMINI_API_KEY_2/_3 for extra rotation
 *      capacity, GROQ_API_KEY for the fallback to actually work rather
 *      than fail loudly once the whole Gemini pool is exhausted.
 *
 * Usage (from apps/sandbox/):
 *   pnpm dev:live                                  # scripted model (default, free)
 *   LIVE_RUN_MODEL=real pnpm dev:live               # real model (billed) — Gemini pool, falls back to Groq
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
import { classifyGeminiQuotaError, createGeminiKeyPool, RPM_COOLDOWN_MS } from "./gemini-key-pool.js";

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

const ATTACKER_CAPABILITY_ID: CapabilityId = capabilityIdSchema.parse("11111111-1111-4111-8111-111111111111");

/**
 * Structured, display-only NDJSON events for apps/tui-dashboard. Pure logging
 * additions alongside the existing human-readable console output below — never
 * read by, or able to affect, anything in the payment flow itself. See
 * apps/tui-dashboard/README.md for the event contract.
 */
function emitEvent(event: Record<string, unknown>): void {
  console.log(`PB_TUI_EVENT ${JSON.stringify(event)}`);
}

/**
 * "scripted" (default): createScriptedDecisionModel — free, deterministic,
 * no real API call. "real": Gemini first, Groq fallback — real tokens,
 * real billing. See this file's top doc comment.
 */
const MODEL_MODE: "scripted" | "real" = process.env.LIVE_RUN_MODEL === "real" ? "real" : "scripted";
/**
 * Default per the RPM/RPD rate-limit research behind the Gemini key
 * pool: the "flash-lite" tier is the only single Gemini tier clearing
 * the required floor (15 RPM / 1,000 RPD / 250K TPM per key, per that
 * research's own gemini-2.5-flash-lite figures — confirmed live as a
 * SEPARATE per-model quota bucket from gemini-2.5-flash, whose quota
 * was already exhausted from earlier testing while a fresh
 * gemini-2.5-flash-lite call succeeded immediately).
 *
 * Actual default is "gemini-3.5-flash-lite", not "gemini-2.5-flash-lite"
 * — also confirmed live, while testing multi-key rotation: a second,
 * newer Google API key returned `404 NOT_FOUND` for
 * "gemini-2.5-flash-lite" with the message "This model
 * models/gemini-2.5-flash-lite is no longer available to new users...
 * use models/gemini-3.5-flash-lite". `gemini-3.5-flash-lite` returned
 * `200` on BOTH keys tested. Exact RPM/RPD figures for
 * gemini-3.5-flash-lite aren't published in a static table (Google's own
 * rate-limits doc points to the per-project aistudio.google.com/rate-limit
 * page instead) — this default is chosen for actual availability across
 * both old- and new-style API keys, not a re-confirmed RPM/RPD number.
 */
const GEMINI_MODEL_ID = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
/** Only consulted when MODEL_MODE === "real" and every Gemini key is exhausted. Default matches fiat402's own choice. */
const GROQ_MODEL_ID = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";

/**
 * Which provider actually served a given run. "scripted" never makes a
 * real API call; "gemini"/"groq" report which one produced the result.
 * `geminiKeyIndex` (1-based, set only when provider === "gemini")
 * reports which pool key handled it — never the key value itself.
 */
interface ProviderOutcome {
  readonly provider: "scripted" | "gemini" | "groq";
  readonly geminiKeyIndex?: number;
}

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
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
};
const GROQ_PRICING_PER_MTOK: Readonly<Record<string, { input: number; output: number }>> = {
  "openai/gpt-oss-120b": { input: 0.15, output: 0.6 },
};

/**
 * The Gemini key pool (task: RPM/RPD-aware rotation in front of PR #87's
 * Gemini/Groq fallback). Built once per process from
 * `config.geminiApiKeys` — see config.ts for how GEMINI_API_KEY_1/_2/_3
 * (or the single GEMINI_API_KEY, for backward compat) populate it.
 */
const geminiKeyPool = createGeminiKeyPool(config.geminiApiKeys);

function buildGeminiModelForKey(apiKey: string): LanguageModelArg {
  const provider = createGoogleGenerativeAI({ apiKey });
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
  outcome: ProviderOutcome,
): void {
  const inputTokens = totalUsage.inputTokens ?? 0;
  const outputTokens = totalUsage.outputTokens ?? 0;
  const label = outcome.provider === "gemini" ? `gemini #${outcome.geminiKeyIndex}` : outcome.provider;
  console.log(`\nToken usage (${label}) — input: ${inputTokens}, output: ${outputTokens}`);

  if (outcome.provider === "scripted") {
    console.log("Cost: $0.00 (scripted model — no real API call was made).");
    return;
  }

  const modelId = outcome.provider === "gemini" ? GEMINI_MODEL_ID : GROQ_MODEL_ID;
  const pricing =
    outcome.provider === "gemini" ? GEMINI_PRICING_PER_MTOK[modelId] : GROQ_PRICING_PER_MTOK[modelId];
  if (!pricing) {
    console.log(`Cost: unknown — no published pricing on record for "${modelId}" (${label}) in this script.`);
    return;
  }

  const estimatedCost = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  console.log(
    `Estimated cost: ~$${estimatedCost.toFixed(6)} (${label} "${modelId}", at published per-token rates; ` +
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
 * only the scripted path needs (the real providers read the capabilityId
 * straight out of the prompt text, like a real deployment would).
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
    performHandshake: async (attestation) => {
      console.log("Performing attestation channel handshake...");
      emitEvent({ type: "stage", stage: "attest", status: "active" });
      const outcome = await performAttestationHandshake(attestation, { brokerBaseUrl: brokerBase });
      emitEvent({
        type: "stage",
        stage: "attest",
        status: outcome.status === "rejected" ? "failed" : "done",
      });
      return outcome;
    },
    issueCapability: async (session) => {
      console.log(`Requesting capability from Broker for resource ${LIVE_AGENT_RUN_RESOURCE_ID}...`);
      emitEvent({ type: "stage", stage: "issue", status: "active" });
      const id = await issueCapabilityViaBroker(brokerBase, session);
      const isAttack =
        process.env.E2E_DEMO_SCENARIO === "hijack" ||
        process.env.E2E_DEMO_SCENARIO === "fake-capability";
      const chosenId: CapabilityId = isAttack ? ATTACKER_CAPABILITY_ID : id;
      console.log(`Capability issued: ${chosenId}`);
      emitEvent({ type: "capability_issued", capabilityId: chosenId });
      emitEvent({ type: "stage", stage: "issue", status: "done" });
      emitEvent({ type: "stage", stage: "agent", status: "active" });
      onCapabilityIssued?.(chosenId);
      return chosenId;
    },
  });
}

/**
 * Runs one full lifecycle for MODEL_MODE:
 *  - "scripted": single attempt, createScriptedDecisionModel.
 *  - "real": walks the Gemini key pool (gemini-key-pool.ts) — each
 *    `nextAvailable()` key gets one full attempt; an RPM 429 reports
 *    `reportRpmExhausted` (key cools down ~60s, tried again on a later
 *    call once its window clears) and moves to the next key
 *    immediately, no waiting; an RPD 429 reports `reportRpdExhausted`
 *    (key is dead for the rest of this process's run) and moves on; any
 *    other error is treated the same as PR #87's original "any failure"
 *    Gemini handling — logged, and this key's attempt is abandoned in
 *    favor of the next one, without changing that key's pool state
 *    (it's not a quota problem, so it isn't marked cooling/exhausted).
 *    Only once `nextAvailable()` returns undefined — every key
 *    currently cooling down or exhausted — does this fall through to
 *    Groq, preserving PR #87's fallback exactly. Each attempt (Gemini or
 *    Groq) re-runs attestation + issues a fresh capability (an unused
 *    capability from an abandoned attempt simply expires unused) —
 *    simpler and more honest than trying to resume mid-loop with a
 *    different model, and matches fiat402's own "retry the whole
 *    operation with the next provider" shape.
 * Returns the result together with which provider (and, for Gemini,
 * which pool key) actually served it.
 */
async function runOnce(brokerBase: string): Promise<{ result: RunAgentLoopResult; outcome: ProviderOutcome }> {
  if (MODEL_MODE === "scripted") {
    let issuedCapabilityId: CapabilityId | undefined;
    console.log("Model: scripted-model.ts (deterministic, no API key, no cost)");
    const model = createScriptedDecisionModel({
      contentUrl: CONTENT_URL,
      getCapabilityId: () => {
        if (process.env.E2E_DEMO_SCENARIO === "hijack" || process.env.E2E_DEMO_SCENARIO === "fake-capability") {
          return ATTACKER_CAPABILITY_ID;
        }
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
    return { result, outcome: { provider: "scripted" } };
  }

  if (geminiKeyPool.size === 0) {
    throw new Error(
      "LIVE_RUN_MODEL=real requires at least GEMINI_API_KEY_1 (or GEMINI_API_KEY) to be set " +
        '(see .env.example). Unset LIVE_RUN_MODEL (or set it to "scripted") to run without a real model.',
    );
  }

  let entry;
  while ((entry = geminiKeyPool.nextAvailable())) {
    console.log(`Model: Gemini #${entry.index} "${GEMINI_MODEL_ID}" (real API calls — billed)`);
    try {
      const result = await runLifecycleWithModel(buildGeminiModelForKey(entry.key), brokerBase);
      geminiKeyPool.reportSuccess(entry.index);
      return { result, outcome: { provider: "gemini", geminiKeyIndex: entry.index } };
    } catch (err) {
      const quotaKind = classifyGeminiQuotaError(err);
      const message = err instanceof Error ? err.message : String(err);

      if (quotaKind === "rpm") {
        geminiKeyPool.reportRpmExhausted(entry.index);
        console.error(
          `[live-run] Gemini key #${entry.index} is RPM-limited (cooling down ~${RPM_COOLDOWN_MS / 1000}s) — trying next key...`,
        );
      } else if (quotaKind === "rpd") {
        geminiKeyPool.reportRpdExhausted(entry.index);
        console.error(`[live-run] Gemini key #${entry.index} is RPD-exhausted for today — trying next key...`);
      } else {
        console.error(`[live-run] Gemini key #${entry.index} failed (non-quota error): ${message} — trying next key...`);
      }
    }
  }

  console.error("[live-run] Every configured Gemini key is currently unavailable — falling back to Groq.");
  console.log(`Model: Groq "${GROQ_MODEL_ID}" (fallback, real API calls — billed)`);
  const result = await runLifecycleWithModel(buildGroqModel(), brokerBase);
  return { result, outcome: { provider: "groq" } };
}

async function main(): Promise<void> {
  console.log("=== PayBound Agent Sandbox — Live Agent Entrypoint (Task 6.1a / 6.1b) ===");

  const brokerBase = brokerBaseUrl(config);
  console.log(`Broker: ${brokerBase}`);

  await assertBrokerReachable(brokerBase);
  console.log("Broker reachable.");

  const identity = getSandboxIdentity();
  console.log(`Workload identity (session): ${identity.publicKey.slice(0, 16)}...`);

  const { result, outcome } = await runOnce(brokerBase);
  const servedBy = outcome.provider === "gemini" ? `gemini #${outcome.geminiKeyIndex}` : outcome.provider;

  console.log(`\n--- Agent Loop Result (served by: ${servedBy}) ---`);
  console.log(`finishReason: ${result.finishReason}`);
  console.log(`steps: ${result.stepsCount}`);
  console.log(`toolCalls: ${JSON.stringify(result.toolCalls)}`);
  console.log(`readResults: ${JSON.stringify(result.readResults)}`);
  console.log(`paid: ${result.paid}`);
  console.log(`payResults: ${JSON.stringify(result.payResults, null, 2)}`);
  emitEvent({ type: "payment_result", paid: result.paid, servedBy });

  logCostAwareness(result.totalUsage, outcome);

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
  const message = err instanceof Error ? err.message : String(err);
  console.error("\n✗ live-run failed:", message);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  emitEvent({ type: "run_error", source: "sandbox", message });
  process.exitCode = 1;
});
