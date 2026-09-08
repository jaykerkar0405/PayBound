/** Centralized Hedera Testnet configuration for the settlement package. */
export interface Config {
  readonly accountId: string | undefined;
  readonly privateKey: string | undefined;
}

export const config: Config = {
  accountId: process.env.HEDERA_TESTNET_ACCOUNT_ID,
  privateKey: process.env.HEDERA_TESTNET_PRIVATE_KEY,
};

export function requireConfig(): { readonly accountId: string; readonly privateKey: string } {
  if (config.accountId === undefined || config.privateKey === undefined) {
    throw new Error(
      "Hedera Testnet configuration is missing: set HEDERA_TESTNET_ACCOUNT_ID and HEDERA_TESTNET_PRIVATE_KEY.",
    );
  }

  return { accountId: config.accountId, privateKey: config.privateKey };
}