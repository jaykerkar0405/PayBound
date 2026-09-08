import Database from "better-sqlite3";
import { config } from "./config.js";

/**
 * Shared SQLite connection for the broker service. Opens/creates the
 * database file at `config.dbPath` and sets connection-wide pragmas.
 *
 * Deliberately does NOT create any tables — schema ownership belongs to
 * the modules that actually need tables (the resource registry, task
 * budget tracker, and payment state machine), not this bootstrap module.
 */
export const db: Database.Database = new Database(config.dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
