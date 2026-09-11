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
   * Hedera testnet account this service controls and is paid into. In
   * .env.local this currently reuses apps/broker's operator account
   * (0.0.10421552) as a plain data value — that's just the funded testnet
   * account this task had on hand for an isolated proof, not a claim that
   * gated-content-service and the Broker share an account/operator by
   * design. Day 2 integration should not read anything architectural into
   * that reuse; give this service its own account if/when that matters.
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
