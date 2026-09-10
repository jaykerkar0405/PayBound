/**
 * One-off dev/verification script — NOT production code, NOT part of the
 * broker's runtime. Seeds one resource-registry entry and one task budget
 * directly against whatever `broker.db` is on `config.dbPath` (default
 * "./broker.db"), so `apps/sandbox/src/live-run.ts` (task 6.1a) has a real
 * resource + task to issue a capability against when run against a live
 * `pnpm --filter broker dev` (or `dev:live`) server.
 *
 * Modeled directly on `seed-live-verification.ts` (PR #64) — same
 * idempotency guarantees, same self-transfer convention — kept as a
 * separate script rather than reused as-is so 6.1a's live agent run has
 * its own resourceId/taskDefinition, distinct from PR #64's pure
 * settlement-check fixture. The registry/budget-seeding LOGIC (via
 * `seedRegistry`/`createTask`) is not duplicated — this only supplies
 * different data to it.
 *
 * IMPORTANT — working directory matters: registry.ts/budget.ts resolve
 * `config.dbPath` relative to the CURRENT WORKING DIRECTORY, not this
 * file's location. Run this from `apps/broker/` (or with `DB_PATH` set to
 * match) so it writes to the exact same `broker.db` the live server has
 * open.
 *
 * Idempotent: `resourceId` and the derived `taskHash` are both PRIMARY
 * KEYs in their tables; this script checks `getResourceById`/`getTask`
 * first and skips anything already seeded.
 *
 * Usage (from apps/broker/):
 *   node --import tsx/esm scripts/seed-live-agent-run.ts
 *   (or: pnpm --filter broker exec tsx scripts/seed-live-agent-run.ts)
 *
 * Requires HEDERA_TESTNET_ACCOUNT_ID to already be set in the environment
 * (the same account settlement.ts's operator uses) — the seeded resource's
 * `recipient` is that same account, so the live settlement transfer is a
 * self-transfer, same convention as seed-live-verification.ts.
 *
 * `apps/sandbox/src/live-run.ts` hardcodes the same
 * `LIVE_AGENT_RUN_RESOURCE_ID` / `LIVE_AGENT_RUN_TASK_DEFINITION` /
 * `LIVE_AGENT_RUN_PRICE` values below (sandbox's tsconfig `rootDir`
 * prevents it importing this file directly — see apps/sandbox's Dockerfile
 * doc comments on the same constraint). If either changes, the other must
 * change to match.
 *
 * `apps/broker/scripts/e2e-live-demo.ts` (task 6.1c) imports and calls
 * `ensureSeeded()` directly — same app, no `rootDir`/Docker constraint —
 * rather than shelling out to this file as a separate process.
 */
import { seedRegistry, getResourceById } from "../src/registry.js";
import { createTask, getTask, increaseTaskBudget } from "../src/budget.js";
import { hashCanonical } from "../src/hash.js";

/** Fixed, not randomly generated per run — required for idempotency. Must match `apps/sandbox/src/live-run.ts`. */
export const LIVE_AGENT_RUN_RESOURCE_ID = "764f644e-3ffb-4dcf-9552-c46272fb82c0";
/** Must match `apps/sandbox/src/live-run.ts`'s `LIVE_AGENT_RUN_TASK_DEFINITION` byte-for-byte in *meaning* — `hashCanonical` is deterministic over JSON value, key order doesn't matter. */
export const LIVE_AGENT_RUN_TASK_DEFINITION = { agentRun: "Issue 6.1a live sandbox agent entrypoint verification" };
/** 1 tinybar — the smallest meaningful HBAR transfer, same convention as seed-live-verification.ts. */
export const LIVE_AGENT_RUN_PRICE = "0.00000001";
/**
 * 1000 tinybars — enough headroom for many repeated live/demo runs
 * against this one task (task 6.1c: rehearsal reliability matters more
 * here than in PR #64's original single-shot verification fixture,
 * where the budget was set to exactly one payment's worth). Applied via
 * `increaseTaskBudget()` below on every run of this script, not just at
 * first creation — `createTask()` itself is only ever called once
 * (idempotency guard), so without this a task seeded before this budget
 * was raised would otherwise stay frozen at its original, much smaller
 * amount forever.
 */
export const LIVE_AGENT_RUN_BUDGET = "0.00001000";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `seed-live-agent-run: ${name} is not set in this process's environment — export it (or load ` +
        `.env.local) before running this script.`,
    );
  }
  return value;
}

/**
 * Idempotently seeds the registry entry + task budget, and tops up the
 * task's budget to `LIVE_AGENT_RUN_BUDGET` on every call regardless of
 * whether the task already existed (see that constant's doc comment for
 * why the top-up can't just live inside the one-time `createTask()`
 * branch). Exported so `apps/broker/scripts/e2e-live-demo.ts` (task
 * 6.1c) can call this directly — reusing this exact logic — instead of
 * shelling out to run this file as a separate process.
 *
 * Returns the taskHash, since callers that go on to look up settlement
 * outcomes by taskHash (6.1c) would otherwise have to recompute it.
 */
export function ensureSeeded(): { readonly taskHash: string } {
  const recipient = requireEnv("HEDERA_TESTNET_ACCOUNT_ID");
  const taskHash = hashCanonical(LIVE_AGENT_RUN_TASK_DEFINITION);

  if (getResourceById(LIVE_AGENT_RUN_RESOURCE_ID) === undefined) {
    seedRegistry([
      { resourceId: LIVE_AGENT_RUN_RESOURCE_ID, recipient, price: LIVE_AGENT_RUN_PRICE },
    ]);
    console.log(
      `Seeded resource registry entry ${LIVE_AGENT_RUN_RESOURCE_ID} -> ${recipient} @ ${LIVE_AGENT_RUN_PRICE}`,
    );
  } else {
    console.log(`Resource registry entry ${LIVE_AGENT_RUN_RESOURCE_ID} already exists — skipping.`);
  }

  if (getTask(taskHash) === undefined) {
    createTask(taskHash, LIVE_AGENT_RUN_BUDGET, LIVE_AGENT_RUN_RESOURCE_ID);
    console.log(`Created task budget ${taskHash} (maxTotalSpend=${LIVE_AGENT_RUN_BUDGET})`);
  } else {
    increaseTaskBudget(taskHash, LIVE_AGENT_RUN_BUDGET);
    console.log(`Task budget ${taskHash} already exists — ensured maxTotalSpend >= ${LIVE_AGENT_RUN_BUDGET}.`);
  }

  return { taskHash };
}

function main(): void {
  ensureSeeded();
  console.log(
    "\nSeeding complete. Run the live agent entrypoint from apps/sandbox/:\n" +
      "  pnpm --filter sandbox dev:live\n" +
      "(or the full end-to-end demo from apps/broker/: pnpm e2e:live)\n",
  );
}

// Only run as a CLI entrypoint — importing `ensureSeeded` from
// e2e-live-demo.ts must not also trigger this file's own standalone
// output.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
