import { taskSchema, type Task } from "@paybound/capability-spec";
import type { PoolClient } from "pg";
import { pool, withTransaction } from "./db.js";
import { addDecimalStrings, compareDecimalStrings } from "./decimal.js";

/**
 * Broker-maintained Task budgets, keyed by taskHash. spentSoFar starts at
 * "0" and is only ever advanced through tryReserveBudget's atomic
 * check-then-update transaction below.
 */
await pool.query(`
  CREATE TABLE IF NOT EXISTS tasks (
    task_hash       TEXT PRIMARY KEY,
    max_total_spend TEXT NOT NULL,
    spent_so_far    TEXT NOT NULL
  )
`);

// task-resource binding (task 6.x follow-up, closing the multi-resource-
// per-task gap): which resourceId a task's maxTotalSpend was derived from
// and is bound to. Nullable — internal bookkeeping, not part of the
// CAPABILITY_SPEC.md `Task` object (packages/types' `Task`/`taskSchema`,
// which `authorize()` consumes, is deliberately left unchanged; this is
// budget.ts/issue.ts-only state). NULL for tasks created directly (e.g.
// existing test helpers that call createTask() without going through
// POST /issue) — see getTaskResourceId()'s doc comment for how that's
// treated. `ADD COLUMN IF NOT EXISTS` is native, idempotent Postgres DDL —
// unlike SQLite, which has no such clause and required a try/catch around
// a plain ADD COLUMN to tolerate a second startup finding the column
// already there.
await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS resource_id TEXT");

interface TaskRow {
  task_hash: string;
  max_total_spend: string;
  spent_so_far: string;
}

interface TaskResourceRow {
  resource_id: string | null;
}

function rowToTask(row: TaskRow): Task {
  return {
    taskHash: row.task_hash,
    maxTotalSpend: row.max_total_spend,
    spentSoFar: row.spent_so_far,
  };
}

/**
 * Creates a new Task budget record with spentSoFar initialized to "0".
 * taskHash is the table's primary key, so creating a task whose taskHash
 * already exists throws rather than silently overwriting spentSoFar.
 *
 * `resourceId` is optional: production issuance (`POST /issue`,
 * issue.ts) always passes it, binding the task's budget to the specific
 * resource it was derived from (task 6.x follow-up). Left unset by
 * existing test helpers that create a task directly for unit-testing
 * budget/authorize logic unrelated to /issue's resource-binding check —
 * see getTaskResourceId()'s doc comment for how an unset binding is
 * treated by that check.
 */
export async function createTask(
  taskHash: Task["taskHash"],
  maxTotalSpend: Task["maxTotalSpend"],
  resourceId?: string,
): Promise<void> {
  const task = taskSchema.parse({ taskHash, maxTotalSpend, spentSoFar: "0" });
  await pool.query(
    "INSERT INTO tasks (task_hash, max_total_spend, spent_so_far, resource_id) VALUES ($1, $2, $3, $4)",
    [task.taskHash, task.maxTotalSpend, task.spentSoFar, resourceId ?? null],
  );
}

/** Reads the current Task budget state. Returns undefined if no such task was created. */
export async function getTask(taskHash: Task["taskHash"]): Promise<Task | undefined> {
  const result = await pool.query<TaskRow>(
    "SELECT task_hash, max_total_spend, spent_so_far FROM tasks WHERE task_hash = $1",
    [taskHash],
  );
  return result.rows[0] === undefined ? undefined : rowToTask(result.rows[0]);
}

/**
 * Reads the resourceId a task's budget is bound to (task 6.x follow-up —
 * see issue.ts's TASK_RESOURCE_MISMATCH check, the actual consumer of
 * this). Three distinct outcomes, all meaningful:
 *
 *  - `undefined` — no task exists yet for this `taskHash`. issue.ts
 *    treats this as "nothing to conflict with," and creates a new,
 *    resource-bound task.
 *  - `null` — a task exists but has no recorded resource binding (created
 *    directly via `createTask()` without a `resourceId`, bypassing
 *    `POST /issue` — true of every existing test helper that seeds a
 *    task for unit-testing budget/authorize logic). Treated permissively:
 *    issue.ts does not reject against an unbound task, since there is
 *    nothing on record to conflict with.
 *  - a real resourceId string — the task was created (via `POST /issue`)
 *    bound to that specific resource. issue.ts rejects any further
 *    `/issue` call for the same `taskHash` naming a *different*
 *    resourceId (`TASK_RESOURCE_MISMATCH`), and allows the same one.
 */
export async function getTaskResourceId(taskHash: Task["taskHash"]): Promise<string | null | undefined> {
  const result = await pool.query<TaskResourceRow>("SELECT resource_id FROM tasks WHERE task_hash = $1", [
    taskHash,
  ]);
  return result.rows[0] === undefined ? undefined : result.rows[0].resource_id;
}

/**
 * Locks the task row (`SELECT ... FOR UPDATE`), checks whether `amount`
 * fits within the remaining budget, and if so applies the update — all on
 * the CALLER's already-open transaction/client, so this composes inside a
 * larger atomic operation. state-machine.ts's `reservePayment` does
 * exactly this: it locks the `capabilities` row and this `tasks` row
 * together in ONE transaction, so nonce-burn and budget-reservation still
 * take effect atomically, matching the pre-migration guarantee.
 *
 * MUST be called from within an active `withTransaction` block on
 * `client` — the lock is only meaningful (and only released) as part of
 * that surrounding transaction. `tryReserveBudget` below is the
 * self-contained version for standalone callers.
 *
 * Why `FOR UPDATE` and not the check-then-write shape the SQLite version
 * used: on `better-sqlite3`, the read, the JS-side decimal comparison, and
 * the write happened inside one synchronous, non-yielding function call —
 * Node's single-threaded execution meant no other request's code could
 * ever run in between, so two concurrent reservations against the same
 * taskHash could never both observe the same starting spentSoFar. Postgres
 * (and any async driver) has no such guarantee: `await`ing the SELECT
 * yields control back to the event loop, so a second "concurrent" call
 * could run its own SELECT against the same still-unmodified row before
 * either commits — both would compute "this fits" and both would write,
 * a real double-spend. `FOR UPDATE` locks the row at the SELECT itself, so
 * a second transaction's own `SELECT ... FOR UPDATE` on the same row
 * blocks until this one commits or rolls back, then reads the
 * already-updated value — restoring the same "exactly one winner"
 * property, now via Postgres's row lock instead of Node's single-threaded
 * execution. Covered by property.test.ts's concurrent double-spend test.
 */
export async function reserveBudgetWithClient(
  client: PoolClient,
  taskHash: Task["taskHash"],
  amount: Task["maxTotalSpend"],
): Promise<boolean> {
  const result = await client.query<TaskRow>(
    "SELECT task_hash, max_total_spend, spent_so_far FROM tasks WHERE task_hash = $1 FOR UPDATE",
    [taskHash],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`tryReserveBudget: no task with taskHash "${taskHash}"`);
  }

  const newSpentSoFar = addDecimalStrings(row.spent_so_far, amount);
  if (compareDecimalStrings(newSpentSoFar, row.max_total_spend) > 0) {
    return false;
  }

  await client.query("UPDATE tasks SET spent_so_far = $1 WHERE task_hash = $2", [newSpentSoFar, taskHash]);
  return true;
}

/**
 * Atomically checks and, if it fits, reserves `amount` against a task's
 * remaining budget: (spentSoFar + amount) <= maxTotalSpend
 * (SECURITY_INVARIANT.md clause 9, "Over-budget"). Self-contained version
 * of `reserveBudgetWithClient` for callers that only need the budget
 * check on its own, in its own transaction — see that function's doc
 * comment for how state-machine.ts composes the client-taking version
 * into a larger atomic operation instead.
 *
 * Returns true and updates spentSoFar if the reservation fits; returns
 * false and makes no change otherwise. Throws if no task with `taskHash`
 * exists.
 */
export async function tryReserveBudget(taskHash: Task["taskHash"], amount: Task["maxTotalSpend"]): Promise<boolean> {
  return withTransaction((client) => reserveBudgetWithClient(client, taskHash, amount));
}

/**
 * Raises an existing task's maxTotalSpend to `newMaxTotalSpend` — never
 * lowers it; a no-op if `newMaxTotalSpend` is not strictly greater than
 * the task's current maxTotalSpend. Never touches spentSoFar.
 *
 * Exists for dev/verification scripts that reuse one fixed, idempotently-
 * seeded task across many live runs (e.g.
 * apps/broker/scripts/seed-live-agent-run.ts, whose `createTask()` call
 * only runs once — re-running the seed script afterward is a no-op per
 * its own idempotency guarantee, so a task's budget would otherwise stay
 * frozen at whatever it was first seeded with). Not used by any
 * request-handling code path — `POST /issue` never changes an existing
 * task's budget once created. Locks the row for consistency with
 * `reserveBudgetWithClient` even though this path isn't concurrently
 * contended in practice (dev/seed scripts only, never a concurrent
 * request-handling caller).
 *
 * Throws if no task with `taskHash` exists.
 */
export async function increaseTaskBudget(taskHash: Task["taskHash"], newMaxTotalSpend: Task["maxTotalSpend"]): Promise<void> {
  await withTransaction(async (client) => {
    const result = await client.query<TaskRow>(
      "SELECT task_hash, max_total_spend, spent_so_far FROM tasks WHERE task_hash = $1 FOR UPDATE",
      [taskHash],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(`increaseTaskBudget: no task with taskHash "${taskHash}"`);
    }
    if (compareDecimalStrings(newMaxTotalSpend, row.max_total_spend) <= 0) {
      return;
    }
    await client.query("UPDATE tasks SET max_total_spend = $1 WHERE task_hash = $2", [
      newMaxTotalSpend,
      taskHash,
    ]);
  });
}
