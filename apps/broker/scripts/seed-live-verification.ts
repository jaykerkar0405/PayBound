/**
 * One-off dev/verification script — NOT production code, NOT part of the
 * broker's runtime. Seeds one resource-registry entry and one task budget
 * directly against whatever `broker.db` is on `config.dbPath` (default
 * "./broker.db"), so a live `POST /issue` + `POST /pay` run against a real
 * `pnpm --filter broker dev` server has something real to authorize
 * against.
 *
 * Why this exists: no production code path seeds the registry or creates
 * tasks (routes/issue.ts's own doc comment confirms `/issue` deliberately
 * never calls `createTask()` — that wiring is task 6.1's job). Every
 * existing seed call in this repo is inside a test file. This script fills
 * that gap for manual/live verification only (e.g. PR #64's real Hedera
 * Testnet settlement check) — it is not a substitute for task 6.1's real
 * end-to-end integration.
 *
 * IMPORTANT — working directory matters: registry.ts/budget.ts resolve
 * `config.dbPath` relative to the CURRENT WORKING DIRECTORY, not this
 * file's location. Run this from `apps/broker/` (or with `DB_PATH` set to
 * match) so it writes to the exact same `broker.db` the live server has
 * open — running it from the repo root would silently create/use a
 * different file.
 *
 * Idempotent: `resourceId` and the derived `taskHash` are both PRIMARY
 * KEYs in their tables; this script checks `getResourceById`/`getTask`
 * first and skips anything already seeded, so re-running it against an
 * already-seeded broker.db is a safe no-op rather than a thrown
 * UNIQUE-constraint error or a silent duplicate.
 *
 * Usage (from apps/broker/):
 *   node --import tsx/esm scripts/seed-live-verification.ts
 *   (or: pnpm --filter broker exec tsx scripts/seed-live-verification.ts)
 *
 * Requires HEDERA_TESTNET_ACCOUNT_ID to already be set in the environment
 * (the same account settlement.ts's operator uses) — the seeded resource's
 * `recipient` is that same account, so the live settlement transfer is a
 * self-transfer. Same convention as
 * packages/settlement/src/__tests__/submit.test.ts's own fixture, chosen
 * for the same reason: valid on Testnet, no second funded account needed.
 */
import { seedRegistry, getResourceById } from "../src/registry.js";
import { createTask, getTask } from "../src/budget.js";
import { hashCanonical } from "../src/hash.js";

/** Fixed, not randomly generated per run — required for idempotency (see doc comment above). */
export const LIVE_VERIFICATION_RESOURCE_ID = "8f14e45f-ceea-4b90-b0a1-51e97a3e6b2f";
/** The exact object `POST /issue`'s `taskDefinition` field must send — hashCanonical is deterministic over its JSON value (key order doesn't matter), so this must match byte-for-byte in *meaning*, not literal formatting. */
export const LIVE_VERIFICATION_TASK_DEFINITION = { verification: "PR #64 live end-to-end settlement check" };
/** 1 tinybar — the smallest meaningful HBAR transfer, same convention as submit.test.ts. */
export const LIVE_VERIFICATION_PRICE = "0.00000001";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `seed-live-verification: ${name} is not set in this process's environment — export it (or load ` +
        `.env.local) before running this script.`,
    );
  }
  return value;
}

function main(): void {
  const recipient = requireEnv("HEDERA_TESTNET_ACCOUNT_ID");
  const taskHash = hashCanonical(LIVE_VERIFICATION_TASK_DEFINITION);

  if (getResourceById(LIVE_VERIFICATION_RESOURCE_ID) === undefined) {
    seedRegistry([
      { resourceId: LIVE_VERIFICATION_RESOURCE_ID, recipient, price: LIVE_VERIFICATION_PRICE },
    ]);
    console.log(
      `Seeded resource registry entry ${LIVE_VERIFICATION_RESOURCE_ID} -> ${recipient} @ ${LIVE_VERIFICATION_PRICE}`,
    );
  } else {
    console.log(`Resource registry entry ${LIVE_VERIFICATION_RESOURCE_ID} already exists — skipping.`);
  }

  if (getTask(taskHash) === undefined) {
    createTask(taskHash, LIVE_VERIFICATION_PRICE);
    console.log(`Created task budget ${taskHash} (maxTotalSpend=${LIVE_VERIFICATION_PRICE})`);
  } else {
    console.log(`Task budget ${taskHash} already exists — skipping.`);
  }

  console.log("\nPOST this to /issue (taskDefinition must match exactly, in value, not necessarily formatting):");
  console.log(
    JSON.stringify(
      {
        taskDefinition: LIVE_VERIFICATION_TASK_DEFINITION,
        resourceId: LIVE_VERIFICATION_RESOURCE_ID,
        exactAmount: LIVE_VERIFICATION_PRICE,
        paymentRequest: { detail: "live end-to-end verification, PR #64" },
        session: "live-verification-session",
      },
      null,
      2,
    ),
  );
}

main();
