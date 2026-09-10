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
  /**
   * Gates the Chainlink CRE confidential spend-policy check (task 5.2).
   * Defaults **off** — issuance works exactly as today when false.
   * This is explicitly optional and non-load-bearing: removing or
   * disabling it does not affect any of the 9 invariant clauses.
   * See docs/CHAINLINK_CRE_DESIGN.md for the policy question and
   * docs/CAPABILITY_SPEC.md §"Chainlink CRE optional policy check".
   */
  readonly creEnabled: boolean;
  /**
   * URL of the Chainlink CRE policy gateway endpoint. Only consulted
   * when `creEnabled` is true. `undefined` when not configured.
   */
  readonly creGatewayUrl: string | undefined;
  /**
   * Gates the sandbox attestation channel handshake (task 2.3,
   * docs/PROTOCOL.md §5). Defaults **off** — `/issue` and `/pay` behave
   * exactly as they do today when false, and `/attest/*` returns 404 so
   * a sandbox can detect that this Broker doesn't require a handshake.
   *
   * When true the check is fail-**closed**: an unattested session is
   * rejected. That differs deliberately from `creEnabled`'s fail-open
   * design — CRE fails open because a third-party gateway can be
   * unreachable, whereas attestation verification is a local check with
   * no external dependency, so fail-open would make this flag a no-op.
   *
   * Attestation is defense-in-depth on top of the 9 invariant clauses,
   * never a replacement for them: disabling it does not weaken anything
   * `Broker.authorize()` enforces. See
   * docs/ATTESTATION_HANDSHAKE_DESIGN.md §4 and
   * docs/CAPABILITY_SPEC.md §"Sandbox attestation handshake".
   */
  readonly attestationEnabled: boolean;
  /**
   * How long a verified attestation authenticates a session before it
   * must re-attest. Default 30 minutes — long enough for one full agent
   * run, short enough to stay consistent with PROTOCOL.md §5's freshness
   * framing.
   */
  readonly attestationTtlMs: number;
  /**
   * How long an issued, not-yet-used challenge stays valid. Default 60
   * seconds — signing and responding is effectively instantaneous, so a
   * leaked challenge stops being useful quickly.
   */
  readonly attestationChallengeTtlMs: number;
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
  creEnabled: process.env.CRE_ENABLED === "true",
  creGatewayUrl: process.env.CRE_GATEWAY_URL,
  attestationEnabled: process.env.ATTESTATION_ENABLED === "true",
  attestationTtlMs: Number(process.env.ATTESTATION_TTL_MS ?? 30 * 60 * 1000),
  attestationChallengeTtlMs: Number(process.env.ATTESTATION_CHALLENGE_TTL_MS ?? 60 * 1000),
};
