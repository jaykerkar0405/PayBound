/**
 * Environment-derived configuration. Deliberately has zero imports from
 * apps/broker, packages/settlement, or any other PayBound package — this
 * service must be provable correct entirely on its own (Day 1 of the
 * Hedera track task) before anything in the main system depends on it.
 */
export interface Config {
  readonly port: number;
  /** Base URL of the Blocky402 facilitator. Testnet by default. */
  readonly blocky402Url: string;
  /**
   * Hedera testnet account this service controls and is paid into — a
   * dedicated "data provider" account, distinct from apps/broker's own
   * operator account. Kept separate on purpose: Day 2 wired apps/broker to
   * pay this service using its own operator credentials as the client, so
   * payTo must not be that same account, or the Broker's payment would read
   * as paying itself. See README.md's "Three accounts, not two" for the
   * full reasoning. (Day 1's original version of this comment described an
   * earlier, since-replaced state where payTo reused the Broker's account —
   * see git history if that context matters.)
   */
  readonly payToAccountId: string;
  /** Price of the gated resource, in tinybars (1 HBAR = 100,000,000 tinybars). */
  readonly priceTinybars: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set — see .env.example`);
  }
  return value;
}

export const config: Config = {
  port: Number(process.env.PORT ?? 3210),
  blocky402Url: process.env.BLOCKY402_URL ?? "https://api.testnet.blocky402.com",
  payToAccountId: requireEnv("GATED_PAYTO_ACCOUNT_ID"),
  priceTinybars: process.env.GATED_PRICE_TINYBARS ?? "100000",
};
