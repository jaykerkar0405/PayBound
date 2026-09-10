/**
 * PayBound Agent Sandbox — Live Agent Entrypoint (Task 6.1a)
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
 * What this does NOT yet wire to a real implementation: the language
 * model. `apps/sandbox` has no LLM provider package (task 6.1b). Rather
 * than block 6.1a on 6.1b, this uses `createScriptedDecisionModel`
 * (scripted-model.ts) — a deterministic, fixed read-then-pay sequence —
 * as an intermediate milestone: it proves every real seam (attestation,
 * issuance, tool execution, payment) works end to end against a live
 * Broker before adding a real model's unpredictability on top. Swapping
 * in a real provider is a one-line change here once 6.1b lands (see the
 * `model` construction below).
 *
 * Prerequisites (see apps/broker/scripts/seed-live-agent-run.ts):
 *   1. A Broker running and reachable at BROKER_HOST:BROKER_PORT
 *      (`pnpm --filter broker dev` or `dev:live`).
 *   2. That Broker's registry/budget seeded for LIVE_AGENT_RUN_RESOURCE_ID
 *      / LIVE_AGENT_RUN_TASK_DEFINITION:
 *        cd apps/broker && node --import tsx/esm scripts/seed-live-agent-run.ts
 *
 * Usage (from apps/sandbox/):
 *   pnpm dev:live
 *   (or: node --env-file=.env.local --import tsx/esm src/live-run.ts)
 */
import { capabilityIdSchema, type CapabilityId } from "@paybound/capability-spec";
import { config, brokerBaseUrl } from "./config.js";
import { getSandboxIdentity } from "./index.js";
import { runSandboxLifecycle } from "./agent.js";
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

async function main(): Promise<void> {
  console.log("=== PayBound Agent Sandbox — Live Agent Entrypoint (Task 6.1a) ===");

  const brokerBase = brokerBaseUrl(config);
  console.log(`Broker: ${brokerBase}`);

  await assertBrokerReachable(brokerBase);
  console.log("Broker reachable.");

  const identity = getSandboxIdentity();
  console.log(`Workload identity (session): ${identity.publicKey.slice(0, 16)}...`);

  let issuedCapabilityId: CapabilityId | undefined;
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

  const result = await runSandboxLifecycle({
    model,
    contentUrl: CONTENT_URL,
    maxSteps: 5,
    performHandshake: (attestation) => {
      console.log("Performing attestation channel handshake...");
      return performAttestationHandshake(attestation, { brokerBaseUrl: brokerBase });
    },
    issueCapability: async (session) => {
      console.log(`Requesting capability from Broker for resource ${LIVE_AGENT_RUN_RESOURCE_ID}...`);
      issuedCapabilityId = await issueCapabilityViaBroker(brokerBase, session);
      console.log(`Capability issued: ${issuedCapabilityId}`);
      return issuedCapabilityId;
    },
  });

  console.log("\n--- Agent Loop Result ---");
  console.log(`finishReason: ${result.finishReason}`);
  console.log(`steps: ${result.stepsCount}`);
  console.log(`toolCalls: ${JSON.stringify(result.toolCalls)}`);
  console.log(`readResults: ${JSON.stringify(result.readResults)}`);
  console.log(`paid: ${result.paid}`);
  console.log(`payResults: ${JSON.stringify(result.payResults, null, 2)}`);

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
