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

interface TaskRow {
  task_hash: string;
  max_total_spend: string;
  spent_so_far: string;
}

function rowToTask(row: TaskRow): Task {
  return {
    taskHash: row.task_hash,
    maxTotalSpend: row.max_total_spend,
    spentSoFar: row.spent_so_far,
  };
}

const insertStatement = db.prepare<[string, string, string]>(
  "INSERT INTO tasks (task_hash, max_total_spend, spent_so_far) VALUES (?, ?, ?)",
);

const selectByTaskHashStatement = db.prepare<[string], TaskRow>(
  "SELECT task_hash, max_total_spend, spent_so_far FROM tasks WHERE task_hash = ?",
);

const updateSpentSoFarStatement = db.prepare<[string, string]>(
  "UPDATE tasks SET spent_so_far = ? WHERE task_hash = ?",
);

/**
 * Creates a new Task budget record with spentSoFar initialized to "0".
 * taskHash is the table's primary key, so creating a task whose taskHash
 * already exists throws rather than silently overwriting spentSoFar.
 */
export function createTask(taskHash: Task["taskHash"], maxTotalSpend: Task["maxTotalSpend"]): void {
  const task = taskSchema.parse({ taskHash, maxTotalSpend, spentSoFar: "0" });
  insertStatement.run(task.taskHash, task.maxTotalSpend, task.spentSoFar);
}

/** Reads the current Task budget state. Returns undefined if no such task was created. */
export function getTask(taskHash: Task["taskHash"]): Task | undefined {
  const row = selectByTaskHashStatement.get(taskHash);
  return row === undefined ? undefined : rowToTask(row);
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
