/**
 * Centralized, environment-derived configuration for the broker service.
 * Other modules should import `config` from here rather than reading
 * `process.env` directly.
 */
export interface Config {
  readonly port: number;
  readonly dbPath: string;
  readonly nodeEnv: string;
  /**
   * Gates the real Ledger-backed signer (signer.ts's `ledgerSign`, task
   * 3.1b) on. Defaults off so the broker (and its test suite) runs without
   * a physical Ledger device attached — Ledger is an optional trust
   * service (docs/ARCHITECTURE.md), not load-bearing for the core security
   * guarantee. Task 3.2 covers actually switching the default.
   */
  readonly ledgerSigningEnabled: boolean;
  /** BIP32-style key index passed to the Ledger Hedera app; see docs/LEDGER_HEDERA_RESEARCH.md. */
  readonly ledgerKeyIndex: number;
}

export const config: Config = {
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? "./broker.db",
  nodeEnv: process.env.NODE_ENV ?? "development",
  ledgerSigningEnabled: process.env.LEDGER_SIGNING_ENABLED === "true",
  ledgerKeyIndex: Number(process.env.LEDGER_KEY_INDEX ?? 0),
};
