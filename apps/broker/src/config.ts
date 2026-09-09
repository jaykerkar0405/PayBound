/**
 * Centralized, environment-derived configuration for the broker service.
 * Other modules should import `config` from here rather than reading
 * `process.env` directly.
 */
/** `@paybound/ledger-signer`'s `LedgerTransportConfig`, without importing that package's types here — see this file's `ledgerTransport`/`ledgerSpeculosHost`/`ledgerSpeculosPort`. */
export type LedgerTransportKind = "hid" | "speculos";

export interface Config {
  readonly port: number;
  readonly dbPath: string;
  readonly nodeEnv: string;
  /**
   * Gates the real Ledger-backed signer (signer.ts's `ledgerSign`, task
   * 3.1b) on. Defaults **on** as of task 3.2 (issue 45): Speculos
   * (`ledgerTransport`'s default) stands in for a physical Ledger, which
   * this project doesn't have access to — see
   * docs/LEDGER_HEDERA_RESEARCH.md and the package README for how to run
   * it. Ledger remains an optional trust service (docs/ARCHITECTURE.md),
   * not load-bearing for the core security guarantee — this flag only
   * changes which signer produces the payment's signature, never what
   * `Broker.authorize` checks.
   */
  readonly ledgerSigningEnabled: boolean;
  /** BIP32-style key index passed to the Ledger Hedera app; see docs/LEDGER_HEDERA_RESEARCH.md. */
  readonly ledgerKeyIndex: number;
  /**
   * Which transport `ledgerSign`/`hederaTransactionSigner` (signer.ts) talk
   * over. Defaults to `speculos` (task 3.2, issue 45) — real hardware
   * (`hid`) is documented as a future option but has never been run
   * against real hardware here; see the package README's "known
   * limitation" note.
   */
  readonly ledgerTransport: LedgerTransportKind;
  /** Host of the Speculos instance's TCP APDU port; only used when `ledgerTransport` is `speculos`. */
  readonly ledgerSpeculosHost: string;
  /** Port of the Speculos instance's TCP APDU port; only used when `ledgerTransport` is `speculos`. */
  readonly ledgerSpeculosPort: number;
  /**
   * Hedera Testnet operator account for @paybound/settlement (task 4.1),
   * e.g. "0.0.1234". `undefined` until provisioned — see .env.example.
   * settlement.ts's `isSettlementConfigured()` (not this frozen field)
   * gates whether settlement is actually attempted, reading
   * `process.env` lazily so tests can toggle it per case; this field
   * exists for documentation/general use, matching the same
   * frozen-snapshot-plus-lazy-read split `packages/settlement/src/config.ts`
   * already uses for `hcsTopicId`/`requireTopicId`.
   */
  readonly hederaTestnetAccountId: string | undefined;
  /** Hedera Testnet operator private key (DER-encoded), paired with `hederaTestnetAccountId`. `undefined` until provisioned — see .env.example. */
  readonly hederaTestnetPrivateKey: string | undefined;
  /** HCS topic ID for the audit trail (task 4.2), created once via `packages/settlement`'s `createAuditTopic()`. `undefined` until provisioned — see .env.example. */
  readonly hederaHcsTopicId: string | undefined;
}

function parseLedgerTransport(value: string | undefined): LedgerTransportKind {
  if (value === "hid") return "hid";
  if (value !== undefined && value !== "speculos") {
    throw new Error(`config: LEDGER_TRANSPORT must be "hid" or "speculos", got "${value}"`);
  }
  return "speculos";
}

export const config: Config = {
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? "./broker.db",
  nodeEnv: process.env.NODE_ENV ?? "development",
  ledgerSigningEnabled: process.env.LEDGER_SIGNING_ENABLED !== "false",
  ledgerKeyIndex: Number(process.env.LEDGER_KEY_INDEX ?? 0),
  ledgerTransport: parseLedgerTransport(process.env.LEDGER_TRANSPORT),
  ledgerSpeculosHost: process.env.LEDGER_SPECULOS_HOST ?? "127.0.0.1",
  ledgerSpeculosPort: Number(process.env.LEDGER_SPECULOS_PORT ?? 9999),
  hederaTestnetAccountId: process.env.HEDERA_TESTNET_ACCOUNT_ID,
  hederaTestnetPrivateKey: process.env.HEDERA_TESTNET_PRIVATE_KEY,
  hederaHcsTopicId: process.env.HEDERA_HCS_TOPIC_ID,
};
