import pg from "pg";
import { config } from "./config.js";

/**
 * Shared Postgres connection pool for the broker service (Render Postgres
 * in production, a local Postgres in dev/test — see config.ts's
 * `databaseUrl`). Migrated off better-sqlite3 because Render's free web
 * services have an ephemeral filesystem: a local SQLite file is wiped on
 * every redeploy/restart, which is exactly why the resource registry kept
 * coming up empty on the deployed broker (404 unknown_resource on
 * POST /issue).
 *
 * Deliberately does NOT create any tables — schema ownership belongs to
 * the modules that actually need tables (the resource registry, task
 * budget tracker, and payment state machine), not this bootstrap module.
 */
export const pool = new pg.Pool({ connectionString: config.databaseUrl });

/**
 * Runs `fn` inside a single Postgres transaction on one checked-out
 * client — BEGIN before, COMMIT after `fn` resolves, ROLLBACK if it
 * throws, client always released back to the pool.
 *
 * This exists specifically because a transaction (and especially a
 * `SELECT ... FOR UPDATE` row lock held across several statements) MUST
 * stay on one connection throughout: calling `pool.query()` per statement
 * can hand each call a different pooled connection, silently breaking
 * both the transaction boundary and the lock. Anything that needs
 * multiple statements to be atomic — or needs to hold a row lock between
 * a read and a later write — goes through this, not bare `pool.query()`.
 *
 * See budget.ts's `reserveBudgetWithClient` and state-machine.ts's
 * `reservePayment` for why this replaced better-sqlite3's
 * `db.transaction()` (which got this atomicity for free from Node's
 * single-threaded, non-yielding synchronous execution — a guarantee an
 * async driver like `pg` does not provide on its own; see those files'
 * doc comments for the full reasoning).
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
