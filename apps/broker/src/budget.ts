import { taskSchema, type Task } from "@paybound/capability-spec";
import { db } from "./db.js";
import { addDecimalStrings, compareDecimalStrings } from "./decimal.js";

/**
 * Broker-maintained Task budgets, keyed by taskHash. spentSoFar starts at
 * "0" and is only ever advanced through tryReserveBudget's atomic
 * check-then-update transaction below.
 */
db.exec(`
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
// treated. Safe ALTER TABLE ADD COLUMN migration, same pattern as
// state-machine.ts's hedera_transaction_id — a no-op on subsequent
// startups, since SQLite throws (caught below) on a column that already
// exists.
try {
  db.exec("ALTER TABLE tasks ADD COLUMN resource_id TEXT");
} catch {
  // Column already exists — safe to ignore.
}

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

const insertStatement = db.prepare<[string, string, string, string | null]>(
  "INSERT INTO tasks (task_hash, max_total_spend, spent_so_far, resource_id) VALUES (?, ?, ?, ?)",
);

const selectByTaskHashStatement = db.prepare<[string], TaskRow>(
  "SELECT task_hash, max_total_spend, spent_so_far FROM tasks WHERE task_hash = ?",
);

const selectResourceIdByTaskHashStatement = db.prepare<[string], TaskResourceRow>(
  "SELECT resource_id FROM tasks WHERE task_hash = ?",
);

const updateSpentSoFarStatement = db.prepare<[string, string]>(
  "UPDATE tasks SET spent_so_far = ? WHERE task_hash = ?",
);

const updateMaxTotalSpendStatement = db.prepare<[string, string]>(
  "UPDATE tasks SET max_total_spend = ? WHERE task_hash = ?",
);

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
export function createTask(
  taskHash: Task["taskHash"],
  maxTotalSpend: Task["maxTotalSpend"],
  resourceId?: string,
): void {
  const task = taskSchema.parse({ taskHash, maxTotalSpend, spentSoFar: "0" });
  insertStatement.run(task.taskHash, task.maxTotalSpend, task.spentSoFar, resourceId ?? null);
}

/** Reads the current Task budget state. Returns undefined if no such task was created. */
export function getTask(taskHash: Task["taskHash"]): Task | undefined {
  const row = selectByTaskHashStatement.get(taskHash);
  return row === undefined ? undefined : rowToTask(row);
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
export function getTaskResourceId(taskHash: Task["taskHash"]): string | null | undefined {
  const row = selectResourceIdByTaskHashStatement.get(taskHash);
  return row === undefined ? undefined : row.resource_id;
}

/**
 * Atomically checks and, if it fits, reserves `amount` against a task's
 * remaining budget: (spentSoFar + amount) <= maxTotalSpend
 * (SECURITY_INVARIANT.md clause 9, "Over-budget"). The read, the exact
 * decimal comparison, and the write all happen inside a single
 * better-sqlite3 transaction, so two calls against the same taskHash can
 * never both observe the same starting spentSoFar and both succeed —
 * better-sqlite3's synchronous, single-connection transaction model
 * provides this atomicity without any additional manual locking.
 *
 * Returns true and updates spentSoFar if the reservation fits; returns
 * false and makes no change otherwise. Throws if no task with `taskHash`
 * exists.
 */
const reserveBudgetTransaction = db.transaction(
  (taskHash: Task["taskHash"], amount: Task["maxTotalSpend"]): boolean => {
    const row = selectByTaskHashStatement.get(taskHash);
    if (row === undefined) {
      throw new Error(`tryReserveBudget: no task with taskHash "${taskHash}"`);
    }

    const newSpentSoFar = addDecimalStrings(row.spent_so_far, amount);
    if (compareDecimalStrings(newSpentSoFar, row.max_total_spend) > 0) {
      return false;
    }

    updateSpentSoFarStatement.run(newSpentSoFar, taskHash);
    return true;
  },
);

export function tryReserveBudget(taskHash: Task["taskHash"], amount: Task["maxTotalSpend"]): boolean {
  return reserveBudgetTransaction(taskHash, amount);
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
 * task's budget once created.
 *
 * Throws if no task with `taskHash` exists.
 */
export function increaseTaskBudget(taskHash: Task["taskHash"], newMaxTotalSpend: Task["maxTotalSpend"]): void {
  const row = selectByTaskHashStatement.get(taskHash);
  if (row === undefined) {
    throw new Error(`increaseTaskBudget: no task with taskHash "${taskHash}"`);
  }
  if (compareDecimalStrings(newMaxTotalSpend, row.max_total_spend) <= 0) {
    return;
  }
  updateMaxTotalSpendStatement.run(newMaxTotalSpend, taskHash);
}
